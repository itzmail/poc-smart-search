import * as readline from "node:readline";
import pc from "picocolors";
import { classifyIntent } from "./classifier.js";
import { extractRawParams } from "./extractor.js";
import { dispatchAction } from "./dispatcher.js";
import { printSearchProcess } from "./visualizer.js";
import { getRoutesManifest } from "./routes-sync.js";
import { resolveParams } from "./lazy-resolver.js";

async function main() {
  console.clear();
  console.log(pc.bold(pc.cyan("=================================================================")));
  console.log(pc.bold(pc.white("   🎓 SMART SEARCH CLI RUNNER (Entity Resolver & Multi-Options)")));
  console.log(pc.dim("   Standardized JSON Output Array with DETAIL vs LIST Ranking"));
  console.log(pc.bold(pc.cyan("=================================================================")));
  console.log(pc.dim("Perintah kontrol:"));
  console.log(pc.yellow("  • :jev   → Paksa TypeSafe JEV Cloud (System One)"));
  console.log(pc.magenta("  • :local → Paksa Local transformers.js (in-process)"));
  console.log(pc.green("  • :auto  → Otomatis (JEV default / Laya fallback)"));
  console.log(pc.cyan("  • :t=0.3 → Atur threshold probabilitas (cth: :t=0.2, :t=0.5)"));
  console.log(pc.dim("Ketik 'exit' atau 'q' untuk keluar.\n"));

  let currentEngine: "auto" | "jev" | "local" = "auto";
  let currentThreshold = 0.2;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const getPrompt = () => {
    const badge =
      currentEngine === "jev"
        ? pc.cyan("[JEV]")
        : currentEngine === "local"
        ? pc.magenta("[LOCAL]")
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
      if (q === ":local") {
        currentEngine = "local";
        console.log(pc.magenta("✓ Engine diset ke: Transformers.js Local\n"));
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
        const manifest = await getRoutesManifest("1", "SUPERADMIN", false);
        const routes = manifest.routes;
        const classification = await classifyIntent(q, currentEngine as any, routes.map((r) => ({ id: r.id, title: r.title, description: r.description, path: r.path })));
        const route = classification.target_route ? routes.find((r) => r.id === classification.target_route) : undefined;
        const extraction = extractRawParams(q, route?.allowed_params || [], undefined, { routes, referenceDate: manifest.active_context?.today });
        const resolved = route
          ? await resolveParams(extraction, route.allowed_params || [], {
              clientId: "1",
              role: "SUPERADMIN",
              activeContext: manifest.active_context,
            })
          : [];
        const response = dispatchAction(q, classification, extraction, route, routes, resolved, currentThreshold);
        printSearchProcess(q, classification, { ...extraction, allowed_params: route?.allowed_params, resolved }, response);
      } catch (err: any) {
        console.error(pc.red(`Error: ${err.message}`));
      }

      promptUser();
    });
  };

  promptUser();
}

main().catch(console.error);
