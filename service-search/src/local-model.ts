// ---------------------------------------------------------------------------
// LOCAL IN-PROCESS SEMANTIC MODEL (@huggingface/transformers, ONNX q8)
// Pengganti daemon Python Laya. Dipakai untuk:
//   1) Fallback classification (cosine antara query dan route descriptions)
//   2) Semantic similarity antar teks (sinonim Bahasa Indonesia, mis. "sains"
//      ↔ "Ilmu Pengetahuan Alam (Sains)")
// Model: Xenova/multilingual-e5-small (q8) — ~120MB disk, ~220MB RAM, ~12-25ms CPU.
// Semua failure di-degrade graceful (tanpa crash): return null/0.
// ---------------------------------------------------------------------------
import { env } from "@huggingface/transformers";

// Konfigurasi model:
// 1. LOCAL_MODEL_PATH (default ./models) — model di BAKE ke image saat docker build
//    (prebake-model.ts menyalin snapshot ONNX ke folder ini) -> offline & cold-start 0.
// 2. Aktif read-local SELALU; remote hanya dipakai browser/dev (bukan production image)
//    dikontrol HF_ALLOW_REMOTE (default: aktif agar dev tanpa prebake tetap bisa download).
env.localModelPath = process.env.LOCAL_MODEL_PATH || "./models";
env.allowLocalModels = true;
env.allowRemoteModels = process.env.HF_ALLOW_REMOTE !== "false";
if (env.allowRemoteModels) env.cacheDir = process.env.HF_HOME || "./.cache";

type Pipeline = (texts: string[], opts?: any) => Promise<{ data: any }>;

let extractorPromise: Promise<Pipeline> | null = null;
const MODEL_ID = process.env.LOCAL_MODEL_ID || "Xenova/multilingual-e5-small";
const DTYPE = process.env.LOCAL_MODEL_DTYPE || "q8";

// Lazy init pipeline (sekali per proses; thread-safe via singleton promise)
function getExtractor(): Promise<Pipeline> {
  if (extractorPromise) return extractorPromise;
  extractorPromise = (async () => {
    const { pipeline } = await import("@huggingface/transformers");
    return await pipeline("feature-extraction", MODEL_ID, { dtype: DTYPE as any }) as unknown as Pipeline;
  })();
  return extractorPromise;
}

// embedding hasil model (L2-normalized)
export async function embed(texts: string[]): Promise<number[][] | null> {
  try {
    const extractor = await getExtractor();
    // e5 requires query prefix untuk best result
    const out: any = await extractor(texts.map((t) => `query: ${t}`), { pooling: "mean", normalize: true });
    const flat: number[] = Array.from(out.data as Float32Array);
    // dims = [batch, hidden_size]
    const dims = out.dims?.[out.dims.length - 1];
    if (!dims) return null;
    const result: number[][] = [];
    for (let i = 0; i + dims <= flat.length; i += dims) {
      result.push(flat.slice(i, i + dims));
    }
    return result;
  } catch (err) {
    console.warn(`[local-model] embed failed: ${(err as Error).message}`);
    return null;
  }
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // already normalized
}

// Semantic similarity antara 2 teks (sinonim Indonesia)
export async function semanticSimilarity(a: string, b: string): Promise<number> {
  const vecs = await embed([a, b]);
  if (!vecs || vecs.length < 2) return 0;
  const [ea, eb] = vecs;
  return cosine(ea, eb);
}

// ---------------------------------------------------------------------------
// Local Classification Fallback (saat JEV Cloud gagal / tanpa API key)
// Sama seperti semantic routing: embed tiap route description + keywords,
// cosine ke query, softmax T=0.05.
// ---------------------------------------------------------------------------
export interface LocalCandidate {
  id: string;
  label: string;
  text: string;
}

export interface LocalMatch {
  id: string;
  score: number;
  label: string;
}

export interface LocalCandidatesCache {
  embeddings: (number[] | null)[];
}

const candidatesCache = new Map<string, (number[] | null)[]>();

export async function classifyLocal(
  query: string,
  candidates: LocalCandidate[]
): Promise<{ matched: LocalMatch[]; error?: string }> {
  if (candidates.length === 0) return { matched: [] };
  const signature = candidates.map((c) => c.id).join(",");
  let embeddings = candidatesCache.get(signature);
  if (!embeddings) {
    const fresh = await embed(candidates.map((c) => c.text));
    if (!fresh) return { matched: [], error: "local model unavailable" };
    embeddings = fresh;
    candidatesCache.set(signature, embeddings);
  }

  const [queryVec] = (await embed([query])) || [null];
  if (!queryVec) return { matched: [], error: "local model unavailable" };

  const scores = embeddings.map((emb) => (emb ? cosine(queryVec, emb) : 0));
  // softmax T=0.05 di cosine similarity
  const T = 0.05;
  const maxVal = Math.max(...scores);
  const exps = scores.map((s) => Math.exp((s - maxVal) / T));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  const matched: LocalMatch[] = candidates.map((c, i) => ({
    id: c.id,
    label: c.label,
    score: Math.round((exps[i] / sum) * 1000) / 1000,
  }));
  matched.sort((a, b) => b.score - a.score);
  return { matched };
}

// Semantic enum fallback: pilih valueKey enum yang paling mirip dengan kalimat user
// (transformers.js e5 — lapisan ke-2 setelah regex DB gagal / tidak punya alternatif colloquial).
// Anchor deskriptif diekstrak langsung dari values DB (membersihkan simbol regex),
// sehingga tidak ada dictionary hardcode di file TypeScript.
function anchorTextFromRegex(key: string, regexStr: string): string {
  // Pisahkan branch OR agar negasi "belum lunas" tidak meninggalkan kata "lunas" terisolasi
  const rawBranches = regexStr.split("|");
  const filtered: string[] = [];
  for (const b of rawBranches) {
    let clean = b
      .replace(/\\[bBwWsSdD]/g, " ")
      .replace(/[^a-zA-Z0-9_\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!clean) continue;
    if (key === "nunggak" && clean.includes("lunas")) {
      clean = clean.replace(/\blunas\b/g, "belum lunas");
    }
    filtered.push(clean);
  }
  const words = filtered.join(" ");
  return words ? `${key.replace(/_/g, " ")}: ${words}` : key.replace(/_/g, " ");
}

export interface SemanticMatchDetail {
  matchedKey: string | null;
  bestScore?: number;
  margin?: number;
  scores: Array<{ key: string; score: number }>;
}

// Passage embeddings keyed by passage text: anchors rarely change, so embed them once.
const passageVecCache = new Map<string, number[]>();

// Query embedding shared across all enum/date_range specs of one request.
export async function embedQuery(query: string): Promise<number[] | null> {
  const vecs = await embed([`query: ${query}`]);
  return vecs ? vecs[0] : null;
}

export async function semanticEnumMatch(
  query: string,
  values: Record<string, string>, // valueKey -> regex dari DB
  onDetail?: (detail: SemanticMatchDetail) => void,
  queryVec?: number[] | null
): Promise<string | null> {
  const keys = Object.keys(values);
  if (keys.length === 0) return null;

  // Passage dibentuk dinamis dari key + pola di DB, zero-hardcode!
  const passages = keys.map((k) => `passage: ${anchorTextFromRegex(k, values[k] || "")}`);
  const missing = passages.filter((p) => !passageVecCache.has(p));
  const toEmbed = [...(queryVec ? [] : [`query: ${query}`]), ...missing];
  if (toEmbed.length > 0) {
    const fresh = await embed(toEmbed);
    if (!fresh) return null;
    const own = queryVec ? fresh : fresh.slice(1);
    missing.forEach((p, i) => passageVecCache.set(p, own[i]));
    if (!queryVec) queryVec = fresh[0];
  }
  const qv = queryVec as number[];
  const avv = passages.map((p) => passageVecCache.get(p) as number[]);
  const scored = keys
    .map((key, i) => ({ key, score: cosine(qv, avv[i]) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  const second = scored[1];
  const margin = best && second ? best.score - second.score : best ? best.score : 0;
  // Threshold absolut + katup margin: kalau top-1 & top-2 dikenali nyaris sama kuat,
  // jangan nebak (risiko arah salah periode besar. quantifikasikan threshold 0.65 / margin 0.04).
  const matchedKey =
    best && best.score >= 0.65 && (!second || best.score - second.score >= 0.04) ? best.key : null;

  if (onDetail) {
    onDetail({
      matchedKey,
      bestScore: best?.score,
      margin,
      scores: scored,
    });
  }

  return matchedKey;
}

const VALUE_SIM_THRESHOLD = 0.45;

// Last-resort semantic match of free tokens against master list names (e.g. "hitung-hitungan" -> Matematika).
// Strict score + margin gates: wrong guess is worse than no filter. Names embed once (cached).
const LIST_SEM_MIN = Number(process.env.LIST_SEMANTIC_MIN ?? 0.85);
const LIST_SEM_MARGIN = Number(process.env.LIST_SEMANTIC_MARGIN ?? 0.04);

export async function semanticListMatch(
  tokens: string[],
  items: Array<{ id: string; name: string }>
): Promise<{ id: string; score: number } | null> {
  if (tokens.length === 0 || items.length < 2) return null;
  const passages = items.map((i) => `passage: ${i.name}`);
  const missing = passages.filter((p) => !passageVecCache.has(p));
  const fresh = await embed([...missing, ...tokens.map((t) => `query: ${t}`)]);
  if (!fresh) return null;
  missing.forEach((p, i) => passageVecCache.set(p, fresh[i]));
  const qvs = fresh.slice(missing.length);

  let best: { id: string; score: number } | null = null;
  for (const qv of qvs) {
    const scored = items
      .map((it, i) => ({ id: it.id, score: cosine(qv, passageVecCache.get(passages[i]) as number[]) }))
      .sort((a, b) => b.score - a.score);
    if (scored[0].score >= LIST_SEM_MIN && scored[0].score - scored[1].score >= LIST_SEM_MARGIN) {
      if (!best || scored[0].score > best.score) best = scored[0];
    }
  }
  return best;
}
