import pc from "picocolors";
import type { ClassificationResult } from "./classifier.js";
import type { ExtractedParams } from "./extractor.js";
import type { SmartSearchResponse } from "./dispatcher.js";

function getProgressBar(prob: number, width = 16): string {
  const filled = Math.round(prob * width);
  const empty = width - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
}

export function printSearchProcess(
  query: string,
  classification: ClassificationResult,
  params: ExtractedParams,
  response: SmartSearchResponse
) {
  const { intent, engine, latency_ms, probabilities } = classification;

  const engineBadge =
    engine === "JEV_CLOUD"
      ? pc.bold(pc.cyan("⚡ TYPE-SAFE JEV (Cloud System One)"))
      : pc.bold(pc.magenta("⚡ LAYA-MLX (Local Daemon :4141)"));

  console.log("\n" + pc.dim("━".repeat(70)));
  console.log(`${pc.bold(pc.white("🔍 SMART SEARCH QUERY:"))} "${pc.yellow(query)}"`);
  console.log(`⚙️  ENGINE: ${engineBadge} | LATENCY: ${pc.green(latency_ms + "ms")}`);
  console.log(pc.dim("─".repeat(70)));

  console.log(pc.bold("📊 INTENT PROBABILITIES:"));
  const sortedIntents = Object.entries(probabilities).sort(([, a], [, b]) => b - a);

  for (const [it, prob] of sortedIntents) {
    const isTop = it === intent;
    const bar = getProgressBar(prob);
    const pct = `${Math.round(prob * 100)}%`.padStart(4);
    const label = it.padEnd(14);
    const line = `${bar} ${pct} ${label}`;

    if (isTop) {
      console.log(`▸ ${pc.bold(pc.green(line))}`);
    } else {
      console.log(`  ${pc.dim(line)}`);
    }
  }

  console.log(pc.dim("─".repeat(70)));

  const paramEntries = Object.entries(params).filter(([, v]) => !!v);
  if (paramEntries.length > 0) {
    const paramStr = paramEntries
      .map(([k, v]) => `${pc.cyan(k)}: ${pc.bold(pc.yellow(v))}`)
      .join(" | ");
    console.log(`🎯 EXTRACTED PARAMETERS: ${paramStr}`);
  } else {
    console.log(`🎯 EXTRACTED PARAMETERS: ${pc.dim("(none / general)")}`);
  }

  console.log(pc.dim("─".repeat(70)));
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
    if (opt.entity) {
      console.log(`      ↳ Entity: ${pc.yellow(opt.entity.type)} [${opt.entity.id}] ${opt.entity.name}`);
    }
  });

  console.log(pc.dim("━".repeat(70)) + "\n");
}
