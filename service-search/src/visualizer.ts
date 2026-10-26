import pc from "picocolors";
import type { ClassificationResult } from "./classifier.js";
import type { SmartSearchResponse } from "./dispatcher.js";
import type { ParamSpec } from "./routes-sync.js";
import type { ResolvedParam } from "./lazy-resolver.js";

interface PipelineDebug extends Record<string, any> {
  query?: string;
  tokens?: string[];
  enumValues?: Record<string, string>;
  allowed_params?: ParamSpec[];
  resolved?: ResolvedParam[];
}

function getProgressBar(prob: number, width = 16): string {
  const filled = Math.round(prob * width);
  const empty = width - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
}

export function printSearchProcess(
  query: string,
  classification: ClassificationResult,
  debug: PipelineDebug,
  response: SmartSearchResponse
) {
  const { intent, engine, latency_ms, probabilities } = classification;

  const engineBadge =
    engine === "JEV_CLOUD"
      ? pc.bold(pc.cyan("⚡ TYPE-SAFE JEV (Cloud System One)"))
      : pc.bold(pc.magenta("⚡ TRANSFORMERS.JS (In-Process Local)"));

  console.log("\n" + pc.dim("━".repeat(78)));
  console.log(`${pc.bold(pc.white("🔍 SMART SEARCH QUERY:"))} "${pc.yellow(query)}"`);
  console.log(`⚙️  ENGINE: ${engineBadge} | LATENCY: ${pc.green(latency_ms + "ms")} | ROUTE: ${pc.bold(pc.yellow(response.target_route || "-"))}`);
  console.log(pc.dim("─".repeat(78)));

  console.log(pc.bold("📊 INTENT PROBABILITIES:"));
  for (const [it, prob] of Object.entries(probabilities).sort(([, a], [, b]) => b - a) as [string, number][]) {
    const isTop = it === intent;
    const line = getProgressBar(prob) + ` ${(`${Math.round(prob * 100)}%`).padStart(4)} ${it.padEnd(16)}`;
    console.log(isTop ? `▸ ${pc.bold(pc.green(line))}` : `  ${pc.dim(line)}`);
  }

  console.log(pc.dim("─".repeat(78)));

  // Scoped allowed_params (from DB config)
  console.log(pc.bold(`🔧 ALLOWED PARAMS (route-scoped): ${debug.allowed_params?.map((p) => p.key).join(", ") || "-"}`));

  // Lazy-resolved params (API fetch + Redis)
  if (debug.resolved?.length) {
    console.log(pc.bold(`✅ RESOLVED PARAMS:`));
    for (const r of debug.resolved) {
      const src = pc.dim(`[${r.source}]`);
      const vals = r.values.map((v) => `${v.id}(${v.name})`).join(", ") || pc.bold(pc.yellow(debug.enumValues?.[r.spec.key] || ""));
      console.log(`   • ${pc.cyan(r.spec.key)} ${src} ${vals}`);
    }
  } else {
    console.log(pc.dim(`✅ RESOLVED PARAMS: (none)`));
  }

  console.log(pc.dim("─".repeat(78)));
  console.log(`🚀 STANDARDIZED OPTIONS (Threshold: ${response.threshold * 100}% | Total: ${response.total_options})`);

  response.options.forEach((opt) => {
    const targetBadge =
      opt.target_type === "DETAIL"
        ? pc.bgBlue(pc.white(" DETAIL "))
        : opt.target_type === "ACTION"
        ? pc.bgMagenta(pc.white(" ACTION "))
        : pc.bgGreen(pc.black(" LIST "));

    console.log(
      `  [#${opt.rank}] ${targetBadge} ${pc.bold(opt.title)} ${pc.dim(`(Score: ${Math.round(opt.score * 100)}%)`)}`
    );
    console.log(`      ↳ Dest: ${pc.cyan(opt.destination)}`);
    if (opt.data) {
      const dataStr = JSON.stringify(opt.data);
      console.log(`      ↳ Data: ${pc.dim(dataStr.length > 160 ? dataStr.slice(0, 160) + "..." : dataStr)}`);
    }
  });

  console.log(pc.dim("━".repeat(78)) + "\n");
}
