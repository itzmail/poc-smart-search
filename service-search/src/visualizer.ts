import pc from "picocolors";
import type { ClassificationResult } from "./classifier.js";
import type { ExtractedParams } from "./extractor.js";
import type { SmartSearchResponse } from "./dispatcher.js";

function renderBar(ratio: number, width = 20): string {
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
}

export function printSearchProcess(
  query: string,
  classification: ClassificationResult,
  params: ExtractedParams,
  response: SmartSearchResponse
) {
  const { intent, confidence, probabilities, engine, latency_ms } = classification;

  const engineLabel =
    engine === "JEV_CLOUD"
      ? pc.cyan(pc.bold("⚡ TYPE-SAFE JEV (Cloud System One)"))
      : pc.magenta(pc.bold("⚡ LAYA-MLX (Local Daemon :4141)"));

  const intentColor =
    intent === "REPORT_ACTION"
      ? pc.green(pc.bold(intent))
      : intent === "DIRECT_LINK"
      ? pc.blue(pc.bold(intent))
      : pc.yellow(pc.bold(intent));

  console.log("\n" + pc.dim("━".repeat(70)));
  console.log(`${pc.bold(pc.white("🔍 SMART SEARCH QUERY:"))} "${pc.bold(pc.yellow(query))}"`);
  console.log(`${pc.bold("⚙️  ENGINE:")} ${engineLabel} | ${pc.bold("LATENCY:")} ${pc.green(latency_ms + "ms")}`);
  console.log(pc.dim("─".repeat(70)));

  // Probabilities breakdown
  console.log(pc.bold("📊 INTENT PROBABILITIES:"));
  for (const [key, prob] of Object.entries(probabilities)) {
    const isTop = key === intent;
    const bar = renderBar(prob, 16);
    const pct = `${Math.round(prob * 100)}%`.padStart(4);
    const line = `  ${bar} ${pct} ${key}`;
    if (isTop) {
      console.log(pc.bold(pc.green(`▸ ${line}`)));
    } else {
      console.log(pc.dim(`  ${line}`));
    }
  }

  // Parameters extracted
  console.log(pc.dim("─".repeat(70)));
  const paramEntries = Object.entries(params).filter(([_, v]) => Boolean(v));
  if (paramEntries.length > 0) {
    const paramStr = paramEntries.map(([k, v]) => `${pc.cyan(k)}: ${pc.bold(v)}`).join(" | ");
    console.log(`${pc.bold("🎯 EXTRACTED PARAMETERS:")} ${paramStr}`);
  } else {
    console.log(pc.dim("🎯 EXTRACTED PARAMETERS: (none / general)"));
  }

  // Final Action Dispatch
  console.log(pc.dim("─".repeat(70)));
  console.log(`${pc.bold("🚀 DISPATCHED OUTPUT:")} ${intentColor} (Confidence: ${pc.bold(Math.round(confidence * 100) + "%")})`);

  if (response.result.mode === "LIST_MENU") {
    console.log(pc.yellow(`  Menu Type: List Navigation (${response.result.matched_menus.length} menus)`));
    response.result.matched_menus.forEach((m) => {
      console.log(`   • ${pc.bold(m.title)} → ${pc.dim(m.path)}`);
    });
  } else if (response.result.mode === "DIRECT_LINK") {
    console.log(pc.blue(`  Direct URL: ${pc.bold(pc.underline(response.result.target_url))}`));
    console.log(`  Title: ${response.result.title}`);
  } else if (response.result.mode === "REPORT_ACTION") {
    console.log(pc.green(`  Action: ${pc.bold(response.result.action)}`));
    console.log(`  Download URL: ${pc.bold(pc.underline(response.result.download_url))}`);
    console.log(`  Document: ${response.result.title}`);
  }

  console.log(pc.dim("━".repeat(70)) + "\n");
}
