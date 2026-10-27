import * as fs from "node:fs";
import { classifyLocal, type LocalCandidate } from "./local-model.js";
import { jevBreaker } from "./breaker.js";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type IntentType = "LIST_MENU" | "DIRECT_LINK" | "REPORT_ACTION";

export interface ClassificationResult {
  intent: IntentType;
  confidence: number;
  probabilities: Record<IntentType, number>;
  engine: "JEV_CLOUD" | "LOCAL_TRANSFORMERS";
  latency_ms: number;
  raw_scores?: Record<string, number>;
  // Route terpilih AI berdasarkan daftar route + description (hanya dari JEV)
  target_route?: string;
}

// Cache anchors.json sekali di module-level agar tidak membaca file secara synchronous di hot-path
const ANCHORS_DATA: Record<IntentType, string[]> = JSON.parse(
  fs.readFileSync(path.join(__dirname, "anchors.json"), "utf-8")
);

// 1b. Klasifikasi Local Fallback menggunakan transformers.js (In-Process)
// Pengganti daemon Python Laya — tanpa dependensi eksternal, tanpa port tambahan.
async function classifyWithLocal(
  query: string,
  routeHints?: { id: string; title: string; description: string; path: string }[]
): Promise<ClassificationResult> {
  const t0 = performance.now();
  const anchors = ANCHORS_DATA;

  const items: LocalCandidate[] = [];
  (Object.keys(anchors) as IntentType[]).forEach((intent) => {
    anchors[intent].forEach((text, i) => items.push({ id: `${intent}#${i}`, label: intent, text }));
  });

  const { matched, error } = await classifyLocal(query, items);
  const now = Math.round((performance.now() - t0) * 100) / 100;

  if (error || matched.length === 0) {
    throw new Error(`Local classifier unavailable: ${error || "no candidates"}`);
  }

  const probs: Record<IntentType, number> = { LIST_MENU: 0, DIRECT_LINK: 0, REPORT_ACTION: 0 };
  for (const m of matched) {
    const [intent] = m.id.split("#");
    probs[intent as IntentType] += m.score;
  }
  // Normalisasi hasil agregasi per intent (softmax sudah mendekati sum 1 before aggregation)
  const total = Object.values(probs).reduce((a, b) => a + b, 0) || 1;
  (Object.keys(probs) as IntentType[]).forEach((k) => {
    probs[k] = Math.round((probs[k] / total) * 1000) / 1000;
  });
  const topIntent = (Object.keys(probs) as IntentType[]).reduce((a, b) => (probs[a] >= probs[b] ? a : b));

  // target_route lokal: pilih route dengan deskripsi paling mirip (cosine)
  let targetRoute: string | undefined;
  if (routeHints && routeHints.length > 0) {
    const routeMatches = await classifyLocal(
      query,
      routeHints.map((r) => ({ id: r.id, label: r.id, text: `${r.title}. ${r.description}` }))
    );
    const best = routeMatches.matched[0];
    if (best && best.score > 0.05) targetRoute = best.id;
  }

  return {
    intent: topIntent,
    confidence: probs[topIntent],
    probabilities: probs,
    engine: "LOCAL_TRANSFORMERS",
    latency_ms: now,
    raw_scores: undefined,
    target_route: targetRoute,
  };
}

// 2. Klasifikasi menggunakan TypeSafe JEV Cloud API
// JEV menerima multi-question: (1) intent, (2) target_route pilihan dari
// daftar route dinamis + description (semantic criteria, zero-anchor)
async function classifyWithJev(
  query: string,
  apiKey: string,
  routes?: { id: string; title: string; description: string; path: string; keywords?: string[] }[]
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
    signal: AbortSignal.timeout(parseInt(process.env.JEV_TIMEOUT_MS || "1500", 10)),
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
  preferredEngine: "auto" | "jev" | "local" = "auto",
  routes?: { id: string; title: string; description: string; path: string; keywords?: string[] }[]
): Promise<ClassificationResult> {
  const apiKey = process.env.TYPESAFE_API_KEY;

  if (preferredEngine === "jev" && apiKey) {
    return await classifyWithJev(query, apiKey, routes);
  }

  if (preferredEngine === "local") {
    return await classifyWithLocal(query, routes);
  }

  // Mode Auto: Coba JEV Cloud dulu, jika tidak ada key atau gagal, fallback ke Local Laya
  if (apiKey && jevBreaker.allow()) {
    try {
      const result = await classifyWithJev(query, apiKey, routes);
      jevBreaker.success();
      return result;
    } catch {
      jevBreaker.failure();
      // Fallback ke transformers.js in-process (pengganti daemon Python Laya)
      return await classifyWithLocal(query, routes);
    }
  }

  return await classifyWithLocal(query, routes);
}
