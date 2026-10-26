// Pre-bake transformers.js model ke image (dipanggil saat docker build).
// Hasil: ./models/<repo>/ berisi layout repo (config.json, tokenizer.json, onnx/*.onnx)
// sehingga runtime cukup baca LOKAL (env.allowLocalModels=true) — cold-start & offline 0ms fetch.
import * as fs from "node:fs";
import * as path from "node:path";

const MODEL_ID = process.env.LOCAL_MODEL_ID || "Xenova/multilingual-e5-small";
const DTYPE = (process.env.LOCAL_MODEL_DTYPE as any) || "q8";
const LOCAL_DIR = process.env.LOCAL_MODEL_PATH || "./models";
const CACHE_DIR = process.env.HF_HOME || "/app/.cache";

try {
  const { pipeline, env } = await import("@huggingface/transformers");
  env.allowRemoteModels = true;
  env.cacheDir = CACHE_DIR;
  console.log(`[prebake] Downloading ${MODEL_ID} (${DTYPE}) ...`);
  const extractor = await pipeline("feature-extraction", MODEL_ID, { dtype: DTYPE });
  const out = await extractor(["query: warmup"], { pooling: "mean", normalize: true });
  console.log(`[prebake] OK dims=${JSON.stringify(out.dims)}`);

  // Salin cache download -> ./models/<repo_id>/ (layout diharapkan localModelPath).
  // transformers.js menyimpan repo di <cacheDir>/<org>/<name>/ (bukan layout hub man-conf).
  const snapshotDir = path.join(CACHE_DIR, MODEL_ID);
  if (!fs.existsSync(snapshotDir)) throw new Error(`model cache not found: ${snapshotDir}`);
  const modelDir = path.join(LOCAL_DIR, MODEL_ID);
  fs.rmSync(modelDir, { recursive: true, force: true });
  fs.cpSync(snapshotDir, modelDir, { recursive: true, dereference: true });
  console.log(`[prebake] Copied snapshot -> ${modelDir}`);
  console.log("[prebake] local files:", fs.readdirSync(modelDir).join(", "));
  process.exit(0);
} catch (err) {
  console.error("[prebake] FAILED:", (err as Error).message);
  process.exit(1);
}
