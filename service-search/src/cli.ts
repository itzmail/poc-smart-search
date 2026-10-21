import * as readline from "node:readline";
import pc from "picocolors";
import { classifyIntent } from "./classifier.js";
import { extractParams } from "./extractor.js";
import { dispatchAction } from "./dispatcher.js";
import { printSearchProcess } from "./visualizer.js";
import { getActiveRoutes } from "./routes-sync.js";

async function main() {
  console.clear();
  console.log(pc.bold(pc.cyan("=================================================================")));
  console.log(pc.bold(pc.white("   🎓 SMART SEARCH CLI RUNNER (TypeSafe JEV & Laya MLX)")));
  console.log(pc.dim("   Demo POC: Natural Language → Typed Intent + SQLite Backend"));
  console.log(pc.bold(pc.cyan("=================================================================")));
  console.log(pc.dim("Perintah toggle engine:"));
  console.log(pc.yellow("  • :jev   → Paksa gunakan TypeSafe JEV Cloud (System One)"));
  console.log(pc.magenta("  • :laya  → Paksa gunakan Laya Local MLX (:4141)"));
  console.log(pc.green("  • :auto  → Otomatis (JEV default / Laya fallback)"));
  console.log(pc.dim("Ketik 'exit' atau 'q' untuk keluar.\n"));

  let currentEngine: "auto" | "jev" | "laya" = "auto";

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const getPrompt = () => {
    const badge =
      currentEngine === "jev"
        ? pc.cyan("[JEV]")
        : currentEngine === "laya"
        ? pc.magenta("[LAYA]")
        : pc.green("[AUTO]");
    return `${badge} ${pc.bold("smart-search> ")}`;
  };

  const promptUser = () => {
    rl.question(getPrompt(), async (input) => {
      const q = input.trim();
      if (!q) {
        promptUser();
        return;
      }
      if (q.toLowerCase() === "exit" || q.toLowerCase() === "q") {
        console.log(pc.dim("\nSampai jumpa!\n"));
        rl.close();
        process.exit(0);
      }

      // Engine switch commands
      if (q === ":jev") {
        currentEngine = "jev";
        console.log(pc.cyan("✓ Engine diset ke: TypeSafe JEV Cloud (Zero-Anchor)\n"));
        promptUser();
        return;
      }
      if (q === ":laya") {
        currentEngine = "laya";
        console.log(pc.magenta("✓ Engine diset ke: Laya Local MLX (:4141 Anchor Embedding)\n"));
        promptUser();
        return;
      }
      if (q === ":auto") {
        currentEngine = "auto";
        console.log(pc.green("✓ Engine diset ke: Auto-detect\n"));
        promptUser();
        return;
      }

      try {
        const [classification, routes] = await Promise.all([
          classifyIntent(q, currentEngine),
          getActiveRoutes(),
        ]);
        const params = extractParams(q);
        const response = dispatchAction(q, classification, params, routes);
        printSearchProcess(q, classification, params, response);
      } catch (err: any) {
        console.error(pc.red(`Error: ${err.message}`));
      }

      promptUser();
    });
  };

  promptUser();
}

main().catch(console.error);
