import pc from "picocolors";
import type { LogLevel, PipelineTrace } from "./tracer";

export function getLogLevel(): LogLevel {
  const envLevel = (process.env.SMART_SEARCH_LOG_LEVEL || "normal").toLowerCase();
  if (envLevel === "dev" || envLevel === "deep") return "dev";
  if (envLevel === "off") return "off";
  return "normal";
}

export function logPipelineTrace(trace: PipelineTrace) {
  const level = getLogLevel();
  if (level === "off") return;

  if (level === "normal") {
    logNormalSummary(trace);
    return;
  }

  logDevDeepInspection(trace);
}

function logNormalSummary(trace: PipelineTrace) {
  const engine = trace.step1_classifier?.engine || "UNKNOWN";
  const route = trace.step1_classifier?.target_route || "none";
  const conf = trace.step4_dispatcher?.composite_confidence ?? 0;
  const optionsCount = trace.step4_dispatcher?.total_options ?? 0;
  const latency = trace.timings_ms.total.toFixed(1);

  console.log(
    pc.cyan(`[SmartSearch] `) +
    pc.bold(`"${trace.query}"`) +
    pc.dim(` (Client: ${trace.client_id}, Role: ${trace.user_role}) `) +
    pc.yellow(`-> Route: ${route}`) +
    pc.green(` [${optionsCount} opts | ${(conf * 100).toFixed(0)}% conf | ${engine} | ${latency}ms]`)
  );
}

function logDevDeepInspection(trace: PipelineTrace) {
  const sep = pc.cyan("=".repeat(80));
  const subSep = pc.dim("-".repeat(80));

  console.log("\n" + sep);
  console.log(
    pc.bold(pc.cyan(`🔍 [SMART SEARCH DEV TRACE] `)) +
    pc.bold(pc.white(`Query: "${trace.query}"`))
  );
  console.log(
    pc.dim(`   Tenant Context: Client=${trace.client_id}, Role=${trace.user_role} | Engine Target=${trace.step1_classifier?.engine || "N/A"}`)
  );
  console.log(sep);

  // STEP 1: ROUTE CLASSIFIER
  const c = trace.step1_classifier;
  console.log(`\n${pc.bold(pc.blue("[STEP 1: ROUTE CLASSIFIER]"))} 🧠`);
  if (c) {
    console.log(pc.dim("  ▶ Process:"));
    console.log(`    • Evaluator   : ${pc.bold(c.engine === "JEV_CLOUD" ? "TypeSafe JEV System One (Cloud Primary)" : "In-Process Transformers.js (Local Fallback)")}`);
    console.log(`    • Latency API : ${c.latency_ms.toFixed(1)} ms`);
    if (c.raw_scores && Object.keys(c.raw_scores).length > 0) {
      const topScores = Object.entries(c.raw_scores)
        .slice(0, 4)
        .map(([k, v]) => `${k}: ${(v * 100).toFixed(1)}%`)
        .join(", ");
      console.log(`    • Raw Scores  : { ${topScores} }`);
    }
    console.log(
      pc.green(`  ✔ Verdict Step 1: Locked target route to `) +
      pc.bold(pc.yellow(`"${c.target_route || "none"}"`)) +
      pc.green(` (Intent: ${c.intent || "DIRECT_LINK"} | Confidence: ${(c.confidence_score * 100).toFixed(0)}% [${c.confidence_level}])`)
    );
  } else {
    console.log(pc.red("  ✘ Step 1 was not executed or failed"));
  }

  console.log(subSep);

  // STEP 2: SCOPED EXTRACTOR
  const e = trace.step2_extractor;
  console.log(`${pc.bold(pc.magenta("[STEP 2: SCOPED EXTRACTOR]"))} 🔎`);
  if (e) {
    console.log(pc.dim("  ▶ Process:"));
    console.log(`    • Tokens Parsed     : [${e.tokens_parsed.map((t) => pc.white(`"${t}"`)).join(", ")}]`);
    if (e.stopwords_removed.length > 0) {
      console.log(`    • Stopwords Filtered: [${e.stopwords_removed.map((t) => pc.dim(`"${t}"`)).join(", ")}]`);
    }
    
    // Regex matches
    if (e.regex_matches.length > 0) {
      console.log(pc.dim("    • Regex DB Matches (Layer 1):"));
      for (const m of e.regex_matches) {
        console.log(`        - Param ${pc.cyan(m.param)} = ${pc.green(`"${m.matched_value}"`)} (Matched phrase: "${m.matched_phrase || ""}")`);
      }
    } else {
      console.log(pc.dim("    • Regex DB Matches (Layer 1): No direct pattern match"));
    }

    // Transformers matches
    if (e.transformers_status.length > 0) {
      console.log(pc.dim("    • Transformers.js Semantic Evaluator (Layer 2):"));
      for (const t of e.transformers_status) {
        if (t.status === "ENGAGED") {
          console.log(
            `        - Param ${pc.cyan(t.param)}: ${pc.bold(pc.green("ENGAGED"))} ➔ Cosine Match to "${pc.green(t.matched_value || "")}" (Score: ${t.score?.toFixed(3)}, Margin: ${t.margin?.toFixed(3)})`
          );
        } else if (t.status === "STANDBY") {
          console.log(
            `        - Param ${pc.cyan(t.param)}: ${pc.yellow("STANDBY")} (L1 Regex already resolved this slot, no ONNX inference needed)`
          );
        } else {
          console.log(`        - Param ${pc.cyan(t.param)}: ${pc.dim(`SKIPPED (${t.reason || "no keyword cue"})`)}`);
        }
      }
    }

    console.log(
      pc.green(`  ✔ Verdict Step 2: Extracted Slots = `) +
      pc.bold(JSON.stringify(e.output_slots))
    );
  } else {
    console.log(pc.red("  ✘ Step 2 was not executed"));
  }

  console.log(subSep);

  // STEP 3: LAZY MASTER RESOLUTION
  const r = trace.step3_resolver;
  console.log(`${pc.bold(pc.yellow("[STEP 3: LAZY MASTER RESOLUTION]"))} 🗄️`);
  if (r) {
    console.log(pc.dim("  ▶ Process:"));
    console.log(`    • Evaluated Param Specs: [${r.param_specs_evaluated.join(", ")}]`);

    // Redis ops
    if (r.redis_operations.length > 0) {
      console.log(pc.dim("    • Redis Master Cache:"));
      for (const op of r.redis_operations) {
        const color = op.status === "HIT" ? pc.green : pc.yellow;
        console.log(`        - [${color(op.status)}] ${op.key}`);
      }
    }

    // HTTP calls
    if (r.http_calls.length > 0) {
      console.log(pc.dim("    • HTTP Backend API Calls (Cache Miss / Token Search):"));
      for (const h of r.http_calls) {
        console.log(`        - ${pc.cyan(h.endpoint)} (Param: ${h.param}, Token: "${h.query_token || ""}") ➔ Found ${h.results_count} records`);
      }
    } else {
      console.log(pc.dim("    • HTTP Backend API Calls: 0 calls (Fully satisfied via Cache / Enums)"));
    }

    // Token exclusion
    console.log(pc.dim("    • Token Exclusion Status:"));
    console.log(`        - Consumed Tokens : [${r.token_exclusion.consumed.map((t) => pc.green(`"${t}"`)).join(", ")}]`);
    if (r.token_exclusion.skipped_calls.length > 0) {
      console.log(`        - Skipped Calls   : [${r.token_exclusion.skipped_calls.map((s) => pc.yellow(s)).join(", ")}]`);
    }

    console.log(
      pc.green(`  ✔ Verdict Step 3: Resolved Param Values = `) +
      pc.bold(
        JSON.stringify(
          Object.fromEntries(
            Object.entries(r.resolved_params).map(([k, vals]) => [k, vals.map((v) => `${v.id}#${v.name}`)])
          )
        )
      )
    );
  } else {
    console.log(pc.red("  ✘ Step 3 was not executed"));
  }

  console.log(subSep);

  // STEP 4: DISPATCHER & RANKING
  const d = trace.step4_dispatcher;
  console.log(`${pc.bold(pc.green("[STEP 4: DISPATCHER & OPTION BUILDER]"))} 🎯`);
  if (d) {
    console.log(pc.dim("  ▶ Process:"));
    console.log(`    • Base Route Destination : ${pc.cyan(d.base_url)}`);
    console.log(`    • Composite Confidence   : ${pc.bold(pc.green(`${(d.composite_confidence * 100).toFixed(0)}% [${d.confidence_level}]`))}`);
    console.log(pc.dim(`    • Generated Options (${d.total_options} options total):`));
    d.final_urls.forEach((url, i) => {
      console.log(`        [#${i + 1}] ${pc.bold(pc.white(url))}`);
    });
    console.log(pc.green(`  ✔ Verdict Step 4: Dispatcher delivered ${d.total_options} ranked search options`));
  } else {
    console.log(pc.red("  ✘ Step 4 was not executed"));
  }

  console.log(sep);
  const t = trace.timings_ms;
  console.log(
    pc.bold(
      `⏱️ TOTAL LATENCY: ${pc.cyan(t.total.toFixed(1) + "ms")} ` +
      pc.dim(`[Classify: ${t.classifier.toFixed(1)}ms | Extract: ${t.extractor.toFixed(1)}ms | Resolve: ${t.resolver.toFixed(1)}ms | Dispatch: ${t.dispatcher.toFixed(1)}ms]`)
    )
  );
  console.log(sep + "\n");
}
