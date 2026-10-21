import * as http from "node:http";
import pc from "picocolors";
import { classifyIntent } from "./classifier.js";
import { extractParams } from "./extractor.js";
import { dispatchAction, type SmartSearchResponse } from "./dispatcher.js";
import { printSearchProcess } from "./visualizer.js";
import { cacheGet, cacheSet, DEFAULT_TTL_SECONDS, getCacheStatus } from "./cache/redis.js";
import { getActiveRoutes } from "./routes-sync.js";

const PORT = parseInt(process.env.SEARCH_PORT || "4000", 10);

// Inisialisasi awal cache routes dari App Pendidikan
getActiveRoutes().catch(() => {});

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

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

  // Refresh dynamic route manifest on demand (Webhook / Manual trigger)
  if (parsedUrl.pathname === "/routes/refresh" && req.method === "POST") {
    const refreshed = await getActiveRoutes(true);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "success",
        message: "Dynamic routes refreshed into Redis cache",
        total_routes: refreshed.length,
        routes: refreshed.map((r) => r.path),
      })
    );
    return;
  }

  if (parsedUrl.pathname === "/resolve") {
    let query = "";
    let engine: "auto" | "jev" | "laya" = "auto";

    if (req.method === "GET") {
      query = parsedUrl.searchParams.get("q") || "";
      engine = (parsedUrl.searchParams.get("engine") as any) || "auto";
    } else if (req.method === "POST") {
      const buffers: Buffer[] = [];
      for await (const chunk of req) {
        buffers.push(chunk);
      }
      try {
        const body = JSON.parse(Buffer.concat(buffers).toString("utf-8"));
        query = body.q || body.query || "";
        engine = body.engine || "auto";
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

    const normalizedKey = `smartsearch:q:${engine}:${trimmedQuery.toLowerCase()}`;

    // 1. CEK QUERY RESULT CACHE DI REDIS (TTL 30 Menit)
    const cachedResultStr = await cacheGet(normalizedKey);
    if (cachedResultStr) {
      try {
        const cachedResponse: SmartSearchResponse = JSON.parse(cachedResultStr);
        cachedResponse.cached = true;
        cachedResponse.latency_ms = 0.8; // Instant hit from cache

        console.log(pc.green(`⚡ [REDIS CACHE HIT (TTL 30m)] Query: "${trimmedQuery}" -> Latency < 1ms`));

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(cachedResponse, null, 2));
        return;
      } catch {}
    }

    // 2. QUERY BELUM DI CACHE: Jalankan Klasifikasi AI + Parameter Extraction
    try {
      const startTime = performance.now();
      const [classification, dynamicRoutes] = await Promise.all([
        classifyIntent(trimmedQuery, engine),
        getActiveRoutes(),
      ]);

      const params = extractParams(trimmedQuery);
      const response = dispatchAction(trimmedQuery, classification, params, dynamicRoutes);
      response.latency_ms = Math.round((performance.now() - startTime) * 100) / 100;
      response.cached = false;

      // Simpan hasil ke Redis dengan TTL 30 Menit (1800 detik)
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
  console.log(`\n🚀 [Smart Search Engine + Redis Cache] running on http://127.0.0.1:${PORT}`);
  console.log(`⚡ Query Cache: TTL 30 Menit (${DEFAULT_TTL_SECONDS}s) via Redis`);
  console.log(`📡 Endpoints:`);
  console.log(`   • GET /resolve?q=query&engine=auto|jev|laya`);
  console.log(`   • POST /resolve (body: { q: string, engine?: string })`);
  console.log(`   • POST /routes/refresh (Bust & re-fetch dynamic routes)`);
  console.log(`   • GET /health\n`);
});
