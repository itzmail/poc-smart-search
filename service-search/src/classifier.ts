import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type IntentType = "LIST_MENU" | "DIRECT_LINK" | "REPORT_ACTION";

export interface ClassificationResult {
  intent: IntentType;
  confidence: number;
  probabilities: Record<IntentType, number>;
  engine: "JEV_CLOUD" | "LAYA_LOCAL";
  latency_ms: number;
  raw_scores?: Record<string, number>;
  // Route terpilih AI berdasarkan daftar route + description (hanya dari JEV)
  target_route?: string;
}

// Memory cache untuk anchor matrix Laya
let anchorEmbeddingsCache: Record<IntentType, number[][]> | null = null;
let isInitializingAnchors = false;

function loadAnchors(): Record<IntentType, string[]> {
  const anchorsPath = path.join(__dirname, "anchors.json");
  return JSON.parse(fs.readFileSync(anchorsPath, "utf-8"));
}

function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

// Inisialisasi embedding anchors via local Laya daemon :4141
async function getOrInitAnchorEmbeddings(layaEndpoint: string): Promise<Record<IntentType, number[][]>> {
  if (anchorEmbeddingsCache) return anchorEmbeddingsCache;
  if (isInitializingAnchors) {
    while (isInitializingAnchors) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (anchorEmbeddingsCache) return anchorEmbeddingsCache;
  }

  isInitializingAnchors = true;
  const anchors = loadAnchors();
  const result: Record<IntentType, number[][]> = {
    LIST_MENU: [],
    DIRECT_LINK: [],
    REPORT_ACTION: [],
  };

  try {
    const embedUrl = new URL(layaEndpoint);
    embedUrl.pathname = "/embed";

    for (const [intent, texts] of Object.entries(anchors) as [IntentType, string[]][]) {
      const res = await fetch(embedUrl.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts }),
      });
      if (!res.ok) throw new Error(`Laya embed failed with status ${res.status}`);
      const data = (await res.json()) as { embeddings: number[][] };
      result[intent] = data.embeddings;
    }

    anchorEmbeddingsCache = result;
    return result;
  } finally {
    isInitializingAnchors = false;
  }
}

// 1. Klasifikasi menggunakan Local Laya Daemon (:4141) via Semantic Exemplar KNN
async function classifyWithLaya(
  query: string,
  layaEndpoint: string = "http://127.0.0.1:4141"
): Promise<ClassificationResult> {
  const t0 = performance.now();
  const anchorMats = await getOrInitAnchorEmbeddings(layaEndpoint);

  const embedUrl = new URL(layaEndpoint);
  embedUrl.pathname = "/embed";
  const queryRes = await fetch(embedUrl.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts: [query] }),
  });

  if (!queryRes.ok) throw new Error(`Laya query embedding failed (${queryRes.status})`);
  const queryData = (await queryRes.json()) as { embeddings: number[][] };
  const queryVec = queryData.embeddings[0];

  // Hitung cosine similarity ke tiap exemplar, ambil rata-rata top-3
  const catScores: Record<IntentType, number> = {
    LIST_MENU: 0,
    DIRECT_LINK: 0,
    REPORT_ACTION: 0,
  };

  for (const [intent, mat] of Object.entries(anchorMats) as [IntentType, number[][]][]) {
    if (mat.length === 0) continue;
    const sims = mat.map((exemplarVec) => dotProduct(exemplarVec, queryVec));
    sims.sort((a, b) => b - a);
    const top3 = sims.slice(0, 3);
    const meanTop3 = top3.reduce((acc, v) => acc + v, 0) / top3.length;
    catScores[intent] = meanTop3;
  }

  // Softmax normalization dengan temperature scaling T = 0.05
  const T = 0.05;
  const values = Object.values(catScores);
  const maxVal = Math.max(...values);
  const expVals = values.map((v) => Math.exp((v - maxVal) / T));
  const sumExp = expVals.reduce((acc, v) => acc + v, 0);

  const probs: Record<IntentType, number> = {
    LIST_MENU: 0,
    DIRECT_LINK: 0,
    REPORT_ACTION: 0,
  };

  const keys = Object.keys(catScores) as IntentType[];
  let topIntent: IntentType = "LIST_MENU";
  let maxProb = -1;

  keys.forEach((key, idx) => {
    const p = Math.round((expVals[idx] / sumExp) * 1000) / 1000;
    probs[key] = p;
    if (p > maxProb) {
      maxProb = p;
      topIntent = key;
    }
  });

  const latency = Math.round((performance.now() - t0) * 100) / 100;
  return {
    intent: topIntent,
    confidence: maxProb,
    probabilities: probs,
    engine: "LAYA_LOCAL",
    latency_ms: latency,
    raw_scores: catScores,
  };
}

// 2. Klasifikasi menggunakan TypeSafe JEV Cloud API
// JEV menerima multi-question: (1) intent, (2) target_route pilihan dari
// daftar route dinamis + description (semantic criteria, zero-anchor)
async function classifyWithJev(
  query: string,
  apiKey: string,
  routes?: { id: string; title: string; description: string; path: string }[]
): Promise<ClassificationResult> {
  const t0 = performance.now();
  const endpoint = "https://api.typesafe.ai/v1/systemone";

  const questions: Record<string, any> = {
    intent: {
      type: "choice",
      instructions: "Determine the user's intended smart search action in an education school management system.",
      criteria: {
        LIST_MENU: "User is looking for static navigation menus or settings (e.g. 'ke menu spp', 'menu profil').",
        DIRECT_LINK: "User wants to view a specific filtered data table or deep link (e.g. 'lihat siswa nunggak kelas 8B', 'data nilai matematika', 'siapa yang belum bayar bulan ini').",
        REPORT_ACTION: "User wants to generate, print, or download a report card / rapot document (e.g. 'cetak rapot kelas 8B', 'unduh rapot budi format pdf').",
      },
    },
  };

  // Kirim daftar route dinamis agar JEV langsung menunjuk route terbaik
  if (routes && routes.length > 0) {
    const routeCriteria: Record<string, string> = {};
    for (const r of routes) {
      routeCriteria[r.id] = `Menu "${r.title}" di path ${r.path}: ${r.description}`;
    }
    questions.target_route = {
      type: "choice",
      instructions: "Which application route/module best matches the user's query? Choose based on the module descriptions.",
      criteria: routeCriteria,
    };
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "jev-latest",
      state: query,
      questions,
    }),
  });

  if (!res.ok) throw new Error(`JEV request failed with HTTP ${res.status}`);
  const data = (await res.json()) as any;
  const answer = data?.answers?.intent;
  const chosen = (answer?.choice || answer?.value || "LIST_MENU") as IntentType;
  const probs = answer?.probabilities || { [chosen]: answer?.confidence || 1 };
  const confidence = answer?.confidence ?? probs[chosen] ?? 1;

  const routeAnswer = data?.answers?.target_route;
  const targetRoute = (routeAnswer?.choice || routeAnswer?.value || undefined) as string | undefined;

  const latency = Math.round((performance.now() - t0) * 100) / 100;
  return {
    intent: chosen,
    confidence,
    probabilities: {
      LIST_MENU: probs.LIST_MENU || 0,
      DIRECT_LINK: probs.DIRECT_LINK || 0,
      REPORT_ACTION: probs.REPORT_ACTION || 0,
    },
    engine: "JEV_CLOUD",
    latency_ms: latency,
    target_route: targetRoute,
  };
}

// Main Orchestrator: Auto-switch antara JEV Cloud & Laya Local
export async function classifyIntent(
  query: string,
  preferredEngine: "auto" | "jev" | "laya" = "auto",
  routes?: { id: string; title: string; description: string; path: string }[]
): Promise<ClassificationResult> {
  const apiKey = process.env.TYPESAFE_API_KEY;

  if (preferredEngine === "jev" && apiKey) {
    return await classifyWithJev(query, apiKey, routes);
  }

  if (preferredEngine === "laya") {
    return await classifyWithLaya(query);
  }

  // Mode Auto: Coba JEV Cloud dulu, jika tidak ada key atau gagal, fallback ke Local Laya
  if (apiKey) {
    try {
      return await classifyWithJev(query, apiKey, routes);
    } catch {
      // Fallback ke Laya
      return await classifyWithLaya(query);
    }
  }

  return await classifyWithLaya(query);
}
