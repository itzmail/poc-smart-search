import * as http from "node:http";
import { classifyIntent } from "./classifier.js";
import { extractParams } from "./extractor.js";
import { dispatchAction } from "./dispatcher.js";
import { printSearchProcess } from "./visualizer.js";

const PORT = parseInt(process.env.SEARCH_PORT || "4000", 10);

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

  if (parsedUrl.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "smart-search-engine" }));
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

    if (!query.trim()) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Parameter 'q' or 'query' is required" }));
      return;
    }

    try {
      const classification = await classifyIntent(query, engine);
      const params = extractParams(query);
      const response = dispatchAction(query, classification, params);

      // Print visualizer log in terminal
      printSearchProcess(query, classification, params, response);

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
  console.log(`\n🚀 [Smart Search Engine] running on http://127.0.0.1:${PORT}`);
  console.log(`📡 Endpoints:`);
  console.log(`   • GET /resolve?q=query&engine=auto|jev|laya`);
  console.log(`   • POST /resolve (body: { q: string, engine?: string })`);
  console.log(`   • GET /health\n`);
});
