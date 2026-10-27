import pc from "picocolors";
import { dispatchAction } from "./service-search/src/dispatcher.js";
import type { AppRoute } from "./service-search/src/routes-sync.js";
import type { ResolvedParam } from "./service-search/src/lazy-resolver.js";

// Pure unit test of dispatchAction with hand-built inputs (no servers needed):
//   bun run test-dispatcher.ts
const route: AppRoute = {
  id: "nilai",
  title: "Nilai",
  path: "/nilai",
  description: "Daftar nilai",
  keywords: [],
  supported_intents: ["DIRECT_LINK"],
  allowed_params: [
    { key: "subject_id", mode: "list" },
    { key: "kelas_id", mode: "list" },
  ],
};
const classification = {
  intent: "DIRECT_LINK",
  confidence: 1,
  probabilities: { DIRECT_LINK: 1, REPORT_ACTION: 0, LIST_MENU: 0 },
  engine: "LOCAL_TRANSFORMERS",
  latency_ms: 0,
} as any;
const extraction = {
  query: "nilai pelajaran ilmu hitung kelas 8b",
  tokens: [],
  enumValues: {},
  timeHints: { hari_ini: false, bulan_ini: false, tahun_ini: false, tahun_ajaran_ini: false, tahun_ajaran_lalu: false },
};
const subject = (source: ResolvedParam["source"]): ResolvedParam => ({
  spec: route.allowed_params![0],
  values: [{ id: "SUB-01", name: "Matematika" }],
  source,
});
const kelas: ResolvedParam = {
  spec: route.allowed_params![1],
  values: [{ id: "K-08B", name: "Kelas 8B" }],
  source: "exact",
};

const run = (resolved: ResolvedParam[]) =>
  dispatchAction(extraction.query, classification, extraction, route, [route], resolved);

let failed = 0;
function check(name: string, cond: boolean) {
  if (!cond) failed++;
  console.log(cond ? pc.green(`  ✔ ${name}`) : pc.red(`  ✘ ${name}`));
}

// Semantic guess: main option must NOT carry the guess; a separate suggestion option must.
{
  const opts = run([subject("semantic"), kelas]).options;
  const main = opts[0];
  const sug = opts.find((o) => o.data?.suggestion);
  check("semantic: main option has no subject_id filter", main.data?.filters.subject_id === undefined);
  check("semantic: main option keeps the exact kelas_id filter", main.data?.filters.kelas_id === "K-08B");
  check("semantic: suggestion option exists", !!sug);
  check("semantic: suggestion title asks 'Maksud Anda'", !!sug?.title.startsWith("Maksud Anda Matematika?"));
  check("semantic: suggestion carries the guess + other filters", sug?.data?.filters.subject_id === "SUB-01" && sug?.data?.filters.kelas_id === "K-08B");
  check("semantic: suggestion ranks below main", !!sug && sug.score < main.score && sug.rank > main.rank);
}

// Exact match: filter applied directly, no suggestion.
{
  const opts = run([subject("exact"), kelas]).options;
  check("exact: subject_id applied as filter", opts[0].data?.filters.subject_id === "SUB-01");
  check("exact: no suggestion option", !opts.some((o) => o.data?.suggestion));
}

process.exit(failed > 0 ? 1 : 0);
