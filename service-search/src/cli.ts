import * as readline from "node:readline";
import pc from "picocolors";
import { classifyIntent } from "./classifier.js";
import { extractParams } from "./extractor.js";
import { dispatchAction } from "./dispatcher.js";
import { printSearchProcess } from "./visualizer.js";
import { getActiveRoutes, resolveEntities } from "./routes-sync.js";

async function main() {
  console.clear();
  console.log(pc.bold(pc.cyan("=================================================================")));
  console.log(pc.bold(pc.white("   🎓 SMART SEARCH CLI RUNNER (Entity Resolver & Multi-Options)")));
  console.log(pc.dim("   Standardized JSON Output Array with DETAIL vs LIST Ranking"));
  console.log(pc.bold(pc.cyan("=================================================================")));
  console.log(pc.dim("Perintah kontrol:"));
  console.log(pc.yellow("  • :jev   → Paksa TypeSafe JEV Cloud (System One)"));
  console.log(pc.magenta("  • :laya  → Paksa Laya Local MLX (:4141)"));
  console.log(pc.green("  • :auto  → Otomatis (JEV default / Laya fallback)"));
  console.log(pc.cyan("  • :t=0.3 → Atur threshold probabilitas (cth: :t=0.2, :t=0.5)"));
  console.log(pc.dim("Ketik 'exit' atau 'q' untuk keluar.\n"));

  let currentEngine: "auto" | "jev" | "laya" = "auto";
  let currentThreshold = 0.2;

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
    return `${badge} ${pc.dim(`(t=${currentThreshold})`)} ${pc.bold("smart-search> ")}`;
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

      // Commands
      if (q === ":jev") {
        currentEngine = "jev";
        console.log(pc.cyan("✓ Engine diset ke: TypeSafe JEV Cloud\n"));
        promptUser();
        return;
      }
      if (q === ":laya") {
        currentEngine = "laya";
        console.log(pc.magenta("✓ Engine diset ke: Laya Local MLX\n"));
        promptUser();
        return;
      }
      if (q === ":auto") {
        currentEngine = "auto";
        console.log(pc.green("✓ Engine diset ke: Auto-detect\n"));
        promptUser();
        return;
      }
      if (q.startsWith(":t=")) {
        currentThreshold = parseFloat(q.replace(":t=", "")) || 0.2;
        console.log(pc.cyan(`✓ Threshold diset ke: ${currentThreshold * 100}%\n`));
        promptUser();
        return;
      }

      try {
        const [classification, routes, entities] = await Promise.all([
          classifyIntent(q, currentEngine),
          getActiveRoutes("1", "SUPERADMIN"),
          resolveEntities(q, "1"),
        ]);
        const params = extractParams(q);
        const response = dispatchAction(q, classification, params, routes, entities, currentThreshold);
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
