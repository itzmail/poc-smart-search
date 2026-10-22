import * as http from "node:http";
import pc from "picocolors";
import { classifyIntent } from "./classifier.js";
import { extractParams } from "./extractor.js";
import { dispatchAction, type SmartSearchResponse } from "./dispatcher.js";
import { printSearchProcess } from "./visualizer.js";
import { cacheGet, cacheSet, DEFAULT_TTL_SECONDS, getCacheStatus } from "./cache/redis.js";
import { getRoutesManifest, resolveEntities } from "./routes-sync.js";

const PORT = parseInt(process.env.SEARCH_PORT || "4000", 10);

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Client-Id, X-User-Role");

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
    const manifest = await getRoutesManifest(clientId, role, true);
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
    let engine: "auto" | "jev" | "laya" = "auto";
    let clientId = (req.headers["x-client-id"] || "1").toString();
    let userRole = (req.headers["x-user-role"] || "SUPERADMIN").toString().toUpperCase();
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
    const normalizedKey = `smartsearch:q:${clientId}:${userRole}:${engine}:${threshold}:${trimmedQuery.toLowerCase()}`;

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

    // 2. QUERY BELUM DI CACHE: Routes + Entity Lookup (paralel), lalu Klasifikasi AI
    try {
      const startTime = performance.now();
      const [manifest, resolvedEntities] = await Promise.all([
        getRoutesManifest(clientId, userRole),
        resolveEntities(trimmedQuery, clientId),
      ]);
      const dynamicRoutes = manifest.routes;

      // Kirim daftar route + description ke JEV agar AI memilih target_route semantik
      const classification = await classifyIntent(
        trimmedQuery,
        engine,
        dynamicRoutes.map((r) => ({ id: r.id, title: r.title, description: r.description, path: r.path }))
      );

      // Route-Scoped Lazy Extraction: hanya jalankan regex utk allowed_params route terpilih
      const selectedRoute = classification.target_route
        ? dynamicRoutes.find((r) => r.id === classification.target_route)
        : undefined;
      const params = extractParams(trimmedQuery, {
        allowedParams: selectedRoute?.allowed_params || selectedRoute?.filter_keys,
        activeContext: manifest.active_context,
      });

      const response = dispatchAction(
        trimmedQuery,
        classification,
        params,
        dynamicRoutes,
        resolvedEntities,
        threshold
      );
      response.latency_ms = Math.round((performance.now() - startTime) * 100) / 100;
      response.cached = false;
      response.client_id = clientId;
      response.user_role = userRole;

      // Simpan hasil ke Redis (TTL 30 Menit)
      await cacheSet(normalizedKey, JSON.stringify(response), DEFAULT_TTL_SECONDS);

      // Print visualizer log in terminal
      printSearchProcess(trimmedQuery, classification, params, response);

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
  console.log(`\n🚀 [Smart Search Engine (Entity Resolver & Multi-Options)] running on http://127.0.0.1:${PORT}`);
  console.log(`⚡ Query Cache: Isolated by X-Client-Id & X-User-Role in Redis (TTL 30m)`);
  console.log(`📡 Endpoints:`);
  console.log(`   • GET /resolve?q=query&threshold=0.2 (Multi-Option Response Array)`);
  console.log(`   • POST /resolve (body: { q, engine, client_id, role, threshold })`);
  console.log(`   • GET /health\n`);
});
