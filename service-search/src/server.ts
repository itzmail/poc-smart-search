import * as http from "node:http";
import pc from "picocolors";
import { classifyIntent } from "./classifier.js";
import { extractRawParams } from "./extractor.js";
import { resolveParams } from "./lazy-resolver.js";
import { dispatchAction, type SmartSearchResponse } from "./dispatcher.js";
import { printSearchProcess } from "./visualizer.js";
import { cacheGet, cacheSet, DEFAULT_TTL_SECONDS, getCacheStatus } from "./cache/redis.js";
import { getRoutesManifest, type AppRoute } from "./routes-sync.js";

const PORT = parseInt(process.env.SEARCH_PORT || "4000", 10);

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
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
    const clientId = (req.headers["x-client-id"] || "1").toString();
    const role = (req.headers["x-user-role"] || "SUPERADMIN").toString();
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
    let query = "";
    let engine: "auto" | "jev" | "local" = "auto";
    let clientId = (req.headers["x-client-id"] || "1").toString();
    let userRole = (req.headers["x-user-role"] || "SUPERADMIN").toString().toUpperCase();
    let auth: string | undefined = (req.headers["authorization"] || "").toString() || undefined;
    let threshold = 0.2;

    if (req.method === "GET") {
      const rawQ = parsedUrl.searchParams.get("q") || "";
      query = rawQ.replace(/\+/g, " ");
      engine = (parsedUrl.searchParams.get("engine") as any) || "auto";
      if (parsedUrl.searchParams.has("client_id")) {
        clientId = parsedUrl.searchParams.get("client_id")!;
      }
      if (parsedUrl.searchParams.has("role")) {
        userRole = parsedUrl.searchParams.get("role")!.toUpperCase();
      }
      if (parsedUrl.searchParams.has("threshold")) {
        threshold = parseFloat(parsedUrl.searchParams.get("threshold")!) || 0.2;
      }
    } else if (req.method === "POST") {
      const buffers: Buffer[] = [];
      for await (const chunk of req) {
        buffers.push(chunk);
      }
      try {
        const body = JSON.parse(Buffer.concat(buffers).toString("utf-8"));
        query = body.q || body.query || "";
        engine = body.engine || "auto";
        if (body.client_id) clientId = body.client_id;
        if (body.role) userRole = body.role.toUpperCase();
        if (body.threshold != null) threshold = parseFloat(body.threshold);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
        return;
      }
    }

    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Parameter 'q' or 'query' is required" }));
      return;
    }

    // MULTI-TENANT & ROLE-ISOLATED CACHE KEY DI REDIS
    const normalizedKey = `smartsearch:q:v3:${clientId}:${userRole}:${engine}:${threshold}:${trimmedQuery.toLowerCase()}`;

    // 1. CEK QUERY RESULT CACHE DI REDIS
    const cachedResultStr = await cacheGet(normalizedKey);
    if (cachedResultStr) {
      try {
        const cachedResponse: SmartSearchResponse = JSON.parse(cachedResultStr);
        cachedResponse.cached = true;
        cachedResponse.latency_ms = 0.8; // Instant hit from cache

        console.log(
          pc.green(
            `⚡ [REDIS CACHE HIT (TTL 30m)] [Tenant: ${clientId} | Role: ${userRole}] "${trimmedQuery}" -> Latency < 1ms`
          )
        );

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

      // (a) Routes manifest — dikirim ke JEV agar AI memilih target_route semantik
      const manifest = await getRoutesManifest(clientId, userRole, false, auth);
      const dynamicRoutes = manifest.routes;

      // (b) Klasifikasi AI: JEV Cloud primary, fallback transformers.js in-process
      const routeCandidates = dynamicRoutes.map((r) => ({
        id: r.id, title: r.title, description: r.description, path: r.path,
      }));
      const classification = await classifyIntent(trimmedQuery, engine, routeCandidates);

      // (c) Route terpilih dari AI, fallback scoring keyword lokal
      let selectedRoute: AppRoute | undefined = classification.target_route
        ? dynamicRoutes.find((r) => r.id === classification.target_route) || dynamicRoutes.find((r) => r.path === `/${classification.target_route}`)
        : undefined;
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
      }

      // (d) Scoped extraction hanya untuk allowed_params route terpilih
      const extraction = extractRawParams(trimmedQuery, selectedRoute?.allowed_params || []);

      // (e) Lazy resolve param ke app-education (dengan X-Client-Id, Redis TTL 30m)
      const resolved = selectedRoute
        ? await resolveParams(extraction, selectedRoute.allowed_params || [], {
            clientId,
            role: userRole,
            auth,
            activeContext: manifest.active_context,
          })
        : [];

      // (f) Dispatch multi-entity
      const response = dispatchAction(
        trimmedQuery, classification, extraction, selectedRoute, dynamicRoutes, resolved, threshold
      );
      response.latency_ms = Math.round((performance.now() - startTime) * 100) / 100;
      response.cached = false;
      response.client_id = clientId;
      response.user_role = userRole;

      // Simpan hasil ke Redis (TTL 30 Menit)
      await cacheSet(normalizedKey, JSON.stringify(response), DEFAULT_TTL_SECONDS);

      // Print visualizer log in terminal
      printSearchProcess(trimmedQuery, classification, { ...extraction, allowed_params: selectedRoute?.allowed_params, resolved }, response);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response, null, 2));
    } catch (err: any) {
      console.error("[Search Service Error]", err.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
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
  console.log(`   • POST /resolve (body: { q, engine, client_id, role, threshold })`);
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
