import * as http from "node:http";
import * as path from "node:path";
import * as fs from "node:fs";
import pc from "picocolors";

// Auto-load .env from current directory or root repo if not already set
const candidateEnvPaths = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "../.env"),
];
const envPath = candidateEnvPaths.find((p) => fs.existsSync(p));
if (envPath) {
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

import { classifyIntent } from "./classifier.js";
import { extractRawParams, type ExtractionAudit } from "./extractor.js";
import { resolveParams } from "./lazy-resolver.js";
import { normalizeQuery } from "./normalize.js";
import { dispatchAction, type SmartSearchResponse } from "./dispatcher.js";
import { printSearchProcess } from "./visualizer.js";
import { cacheGet, cacheSet, DEFAULT_TTL_SECONDS, getCacheStatus } from "./cache/redis.js";
import { getRoutesManifest, type AppRoute } from "./routes-sync.js";
import { createPipelineTrace, type PipelineTrace } from "./tracer.js";
import { logPipelineTrace, getLogLevel } from "./logger.js";
import { resolveIdentity } from "./auth.js";
import { rateLimit } from "./rate-limit.js";
import { randomUUID } from "node:crypto";

const PORT = parseInt(process.env.SEARCH_PORT || "4000", 10);
const MAX_BODY_BYTES = 4096;
const MAX_QUERY_CHARS = 200;
const DEGRADED_TTL_SECONDS = parseInt(process.env.SMARTSEARCH_DEGRADED_TTL || "20", 10);
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
// Engine tidak lagi dikendalikan klien; hanya lewat env
const ENGINE = (["auto", "jev", "local"].includes(process.env.SMARTSEARCH_ENGINE || "")
  ? process.env.SMARTSEARCH_ENGINE
  : "auto") as "auto" | "jev" | "local";

function sendJson(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

// Baca body dengan batas ukuran; null bila melebihi batas
async function readBody(req: http.IncomingMessage, max: number): Promise<Buffer | null> {
  const buffers: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) return null;
    buffers.push(chunk);
  }
  return Buffer.concat(buffers);
}

// TTL normal dengan jitter ±10% agar entri tidak kedaluwarsa serentak
const jitteredTtl = () => Math.round(DEFAULT_TTL_SECONDS * (0.9 + Math.random() * 0.2));

const server = http.createServer(async (req, res) => {
  // CORS: hanya origin yang diizinkan via CORS_ORIGINS
  const origin = (req.headers.origin || "").toString();
  if (origin && CORS_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Client-Id, X-User-Role, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url || "/", `http://localhost:${PORT}`);

  // Health check & cache diagnostics
  if (parsedUrl.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        service: "smart-search-engine",
        cache: getCacheStatus(),
      })
    );
    return;
  }

  // Refresh dynamic route manifest on demand
  if (parsedUrl.pathname === "/routes/refresh" && req.method === "POST") {
    const identity = resolveIdentity(req);
    if (!identity) return sendJson(res, 401, { error: "Missing or invalid X-Client-Id / X-User-Role" });
    const { clientId, role } = identity;
    const auth = (req.headers["authorization"] || "").toString() || undefined;
    const manifest = await getRoutesManifest(clientId, role, true, auth);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "success",
        message: "Dynamic routes refreshed into Redis cache",
        client_id: clientId,
        role,
        active_context: manifest.active_context || null,
        total_routes: manifest.routes.length,
        routes: manifest.routes.map((r) => r.path),
      })
    );
    return;
  }

  if (parsedUrl.pathname === "/resolve") {
    const requestId = randomUUID();
    const identity = resolveIdentity(req);
    if (!identity) return sendJson(res, 401, { error: "Missing or invalid X-Client-Id / X-User-Role" });
    const { clientId, role: userRole } = identity;
    const auth: string | undefined = (req.headers["authorization"] || "").toString() || undefined;

    const retryAfter = rateLimit(`${clientId}:${req.socket.remoteAddress || ""}`);
    if (retryAfter > 0) {
      return sendJson(res, 429, { error: "Too many requests" }, { "Retry-After": String(retryAfter) });
    }

    let query = "";
    const engine = ENGINE;
    let rawThreshold: unknown;

    if (req.method === "GET") {
      query = (parsedUrl.searchParams.get("q") || "").replace(/\+/g, " ");
      rawThreshold = parsedUrl.searchParams.get("threshold");
    } else if (req.method === "POST") {
      const raw = await readBody(req, MAX_BODY_BYTES);
      if (raw === null) return sendJson(res, 413, { error: "Request body too large" }, { Connection: "close" });
      try {
        const body = JSON.parse(raw.toString("utf-8"));
        query = String(body.q || body.query || "");
        rawThreshold = body.threshold;
      } catch {
        return sendJson(res, 400, { error: "Invalid JSON body" });
      }
    }

    // threshold: harus finite, dijepit ke 0..1, default 0.2
    const parsedThreshold = rawThreshold == null || rawThreshold === "" ? NaN : Number(rawThreshold);
    const threshold = Number.isFinite(parsedThreshold)
      ? Math.round(Math.min(1, Math.max(0, parsedThreshold)) * 100) / 100
      : 0.2;

    // Normalized (lowercase, "VIII B" -> "8b") before classification so the classifier,
    // extractor and cache key all see one canonical form.
    const trimmedQuery = normalizeQuery(query.trim());
    if (!trimmedQuery) {
      return sendJson(res, 400, { error: "Parameter 'q' or 'query' is required" });
    }
    if (trimmedQuery.length > MAX_QUERY_CHARS) {
      return sendJson(res, 400, { error: `Query exceeds ${MAX_QUERY_CHARS} characters` });
    }

    // MULTI-TENANT & ROLE-ISOLATED CACHE KEY DI REDIS
    const normalizedKey = `smartsearch:q:v3:${clientId}:${userRole}:${engine}:${threshold}:${trimmedQuery.toLowerCase()}`;

    // 1. CEK QUERY RESULT CACHE DI REDIS
    const tCache0 = performance.now();
    const cachedResultStr = await cacheGet(normalizedKey);
    if (cachedResultStr) {
      try {
        const cachedResponse: SmartSearchResponse = JSON.parse(cachedResultStr);
        if (cachedResponse.meta) {
          cachedResponse.meta.cached = true;
          cachedResponse.meta.latency_ms = Math.round((performance.now() - tCache0) * 100) / 100;
        }

        const logLevel = getLogLevel();
        if (logLevel !== "off") {
          console.log(
            pc.green(
              `⚡ [REDIS CACHE HIT (TTL 30m)] [Tenant: ${clientId} | Role: ${userRole}] "${trimmedQuery}" -> Route: ${cachedResponse.target_route || "auto"} (${cachedResponse.total_options} options) [Latency < 1ms]`
            )
          );
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(cachedResponse, null, 2));
        return;
      } catch {}
    }

    // 2. SEQ PIPELINE (Zero full-table scan):
    //    a) Fetch manifest per (client, role)          [Redis cached]
    //    b) Classify intent + target_route              [JEV / transformers.js]
    //    c) Ekstraksi scope allowed_params route        [Regex 0ms]
    //    d) Lazy resolve param ke app-education         [Redis master TTL 30m]
    //    e) Dispatch multi-entity options               [Regex + skor]
    try {
      const startTime = performance.now();
      const trace = createPipelineTrace(trimmedQuery, clientId, userRole);

      // (a) Routes manifest — dikirim ke JEV agar AI memilih target_route semantik
      const manifest = await getRoutesManifest(clientId, userRole, false, auth);
      const dynamicRoutes = manifest.routes;

      // (b) Klasifikasi AI: JEV Cloud primary, fallback transformers.js in-process
      const tClassify0 = performance.now();
      const routeCandidates = dynamicRoutes.map((r) => ({
        id: r.id, title: r.title, description: r.description, path: r.path,
      }));
      const classification = await classifyIntent(trimmedQuery, engine, routeCandidates);
      trace.timings_ms.classifier = Math.round((performance.now() - tClassify0) * 100) / 100;

      // (c) Route terpilih dari AI, fallback scoring keyword lokal
      let selectedRoute: AppRoute | undefined = classification.target_route
        ? dynamicRoutes.find((r) => r.id === classification.target_route) || dynamicRoutes.find((r) => r.path === `/${classification.target_route}`)
        : undefined;
      let decisionReason = classification.target_route
        ? `Matched via semantic classification to route "${classification.target_route}"`
        : "";
      if (!selectedRoute) {
        // Keyword fallback scoring dari DB config (zero-hardcode)
        let best = 0;
        for (const r of dynamicRoutes) {
          let score = 0;
          for (const k of r.keywords) {
            if (trimmedQuery.toLowerCase().includes(k.toLowerCase())) score += 1;
          }
          if (score > best) { best = score; selectedRoute = r; }
        }
        decisionReason = `Fallback keyword scoring matched route "${selectedRoute?.id || "none"}"`;
      }

      // Step 1 trace
      const topProb = classification.raw_scores
        ? Math.max(...Object.values(classification.raw_scores))
        : 0.95;
      trace.step1_classifier = {
        engine: classification.engine,
        latency_ms: classification.latency_ms,
        target_route: selectedRoute?.id,
        intent: classification.intent,
        raw_scores: classification.raw_scores,
        confidence_score: topProb,
        confidence_level: topProb >= 0.8 ? "HIGH" : topProb >= 0.5 ? "MEDIUM" : "LOW",
        decision_reason: decisionReason,
      };

      // (d) Scoped extraction hanya untuk allowed_params route terpilih
      const tExtract0 = performance.now();
      const extractionAudit: ExtractionAudit = { regexMatches: [], stopwordsFiltered: [] };
      const extraction = extractRawParams(trimmedQuery, selectedRoute?.allowed_params || [], extractionAudit);
      trace.timings_ms.extractor = Math.round((performance.now() - tExtract0) * 100) / 100;

      trace.step2_extractor = {
        tokens_parsed: extraction.tokens,
        stopwords_removed: extractionAudit.stopwordsFiltered,
        time_hints: extraction.timeHints,
        regex_matches: extractionAudit.regexMatches,
        transformers_status: [],
        output_slots: { ...extraction.enumValues },
      };

      // (e) Lazy resolve param ke app-education (dengan X-Client-Id, Redis TTL 30m)
      const tResolve0 = performance.now();
      const resolverTrace = {
        target_route: selectedRoute?.id || "none",
        param_specs_evaluated: [],
        redis_operations: [],
        http_calls: [],
        token_exclusion: { consumed: [], remaining: [], skipped_calls: [] },
        resolved_params: {},
      };

      const resolveState = { degraded: false };
      const resolved = selectedRoute
        ? await resolveParams(extraction, selectedRoute.allowed_params || [], {
            clientId,
            role: userRole,
            auth,
            activeContext: manifest.active_context,
          }, {
            resolverTrace,
            extractorTrace: trace.step2_extractor,
            state: resolveState,
          })
        : [];
      trace.timings_ms.resolver = Math.round((performance.now() - tResolve0) * 100) / 100;
      trace.step3_resolver = resolverTrace;

      // (f) Dispatch multi-entity
      const tDispatch0 = performance.now();
      const response = dispatchAction(
        trimmedQuery,
        classification,
        extraction,
        selectedRoute,
        dynamicRoutes,
        resolved,
        threshold,
        manifest.active_context?.today
      );
      trace.timings_ms.dispatcher = Math.round((performance.now() - tDispatch0) * 100) / 100;
      trace.timings_ms.total = Math.round((performance.now() - startTime) * 100) / 100;

      const topOption = response.options[0];
      trace.step4_dispatcher = {
        base_url: selectedRoute?.path || "/resolve",
        final_urls: response.options.map((o) => o.destination),
        total_options: response.total_options,
        composite_confidence: topOption?.score ?? 0.5,
        confidence_level: (topOption?.score ?? 0.5) >= 0.8 ? "HIGH" : (topOption?.score ?? 0.5) >= 0.5 ? "MEDIUM" : "LOW",
      };

      response.meta.latency_ms = trace.timings_ms.total;
      response.meta.cached = false;

      // Hasil terdegradasi (manifest fallback / fetch upstream gagal) hanya di-cache singkat
      const degraded = Boolean(manifest.degraded) || resolveState.degraded;
      if (degraded) response.meta.degraded = true;
      await cacheSet(normalizedKey, JSON.stringify(response), degraded ? DEGRADED_TTL_SECONDS : jitteredTtl());

      // Print structured Dev Trace / Normal Trace in terminal (Server Console only)
      logPipelineTrace(trace);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response, null, 2));
    } catch (err: any) {
      console.error(`[Search Service Error] ${requestId}`, err.message);
      sendJson(res, 500, { error: "internal_error", request_id: requestId });
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Endpoint not found. Use /resolve?q=..." }));
});

server.listen(PORT, () => {
  console.log(`\n🚀 [Smart Search Engine (Sequential Lazy Pipeline)] running on http://127.0.0.1:${PORT}`);
  console.log(`⚡ Zero full-table scan: classify -> allowed_params -> lazy master resolve -> dispatch`);
  console.log(`📡 Endpoints:`);
  console.log(`   • GET /resolve?q=query&threshold=0.2 (Multi-Option Response Array)`);
  console.log(`   • POST /resolve (body: { q, threshold }; identity via X-Client-Id / X-User-Role)`);
  console.log(`   • POST /routes/refresh (Refresh manifest)`);
  console.log(`   • GET /health\n`);

  // Warmup opsional: env SMARTSEARCH_WARMUP="1:SUPERADMIN,1:GURU" —
  // fetch manifest saat startup agar request pertama user tidak menanggung cold start
  const warmupList = (process.env.SMARTSEARCH_WARMUP || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const pair of warmupList) {
    const [cid, r] = pair.split(":");
    if (!cid || !r) continue;
    getRoutesManifest(cid, r)
      .then((m) => console.log(pc.green(`🔥 [WARMUP] Manifest tenant ${cid}/${r} siap (${m.routes.length} routes)`)))
      .catch((e) => console.log(pc.yellow(`🔥 [WARMUP] Gagal tenant ${cid}/${r}: ${e.message}`)));
  }
});

// Graceful shutdown: tutup port saat Ctrl+C (SIGINT) atau SIGTERM
const shutdown = () => {
  console.log(pc.yellow("\n🛑 [Smart Search Engine] Menghentikan server dan melepas port..."));
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 1000).unref();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
