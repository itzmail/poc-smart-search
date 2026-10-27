import pc from "picocolors";

// Table-driven query suite. Run against already-running servers:
//   bun run test-queries.ts            -> full report, exit 1 only on unexpected failures
//   bun run test-queries.ts --strict   -> known_fail cases count as failures too
const SEARCH_URL = "http://127.0.0.1:4000";
const STRICT = process.argv.includes("--strict");

interface Case {
  cat: string;
  q: string;
  role?: string;
  client?: string;
  route?: string; // expected target_route
  has?: string[]; // each must appear (case-insensitive) in the serialized options
  not_has?: string[]; // none may appear (case-insensitive) in the serialized options
  roles?: string[]; // each entity_role must be present among options
  not_roles?: string[]; // none of these entity_role may be present
  min_siswa?: number; // minimum number of options with entity_role "siswa"
  known_fail?: string; // reason; case is expected to fail until the fix lands
}

// Seed data (app-education/src/data/db.ts), tenant 1:
//   kelas 7A (Siti Aminah, S.Pd), 7C, 8B (Ahmad Fauzi, M.Pd), 9A
//   siswa Siti Rahma (8B), Siti Aisyah (7A), Budi Santoso (8B), Rian Hidayat (9A)
//   mapel Matematika, Ilmu Pengetahuan Alam (Sains), Bahasa Indonesia, Bahasa Inggris
const CASES: Case[] = [
  // --- Kelas ---
  { cat: "kelas", q: "siswa nunggak kelas 8B", route: "siswa", has: ["k-08b", "nunggak"] },
  { cat: "kelas", q: "siswa nunggak kelas 8 b", route: "siswa", has: ["k-08b"] },
  { cat: "kelas", q: "siswa nunggak kelas VIII B", route: "siswa", has: ["k-08b"] },
  { cat: "kelas", q: "siswa nunggak kelas delapan b", route: "siswa", has: ["k-08b"] },
  { cat: "kelas", q: "tagihan spp 8B", route: "spp", has: ["k-08b"] },
  { cat: "kelas", q: "tagihan spp 9A belum lunas", route: "spp", has: ["k-09a"] },
  { cat: "kelas", q: "spp 7C", route: "spp", has: ["k-07c"] },
  // --- Mapel ---
  { cat: "mapel", q: "nilai matematika kelas 8B", route: "nilai", has: ["sub-01", "k-08b"] },
  { cat: "mapel", q: "nilai mtk 8B", route: "nilai", has: ["sub-01", "k-08b"] },
  { cat: "mapel", q: "nilai bahasa inggris", route: "nilai", has: ["sub-04"] },
  { cat: "mapel", q: "nilai b indo", route: "nilai", has: ["sub-03"] },
  { cat: "mapel", q: "nilai pelajaran sains", route: "nilai", has: ["sub-02"] },
  // Semantic last resort (threshold LIST_SEMANTIC_MIN may need calibration)
  { cat: "mapel", q: "nilai pelajaran ilmu hitung", route: "nilai", has: ["sub-01"], known_fail: "E5 single-token scores too flat to separate from generic words" },
  // --- Typo on master lists (fuzzy) ---
  { cat: "typo", q: "nilai matematka kelas 8B", route: "nilai", has: ["sub-01", "k-08b"] },
  { cat: "typo", q: "nilai bahasa inggirs", route: "nilai", has: ["sub-04"] },
  { cat: "typo", q: "wali kelas bu Aminha", roles: ["wali_kelas"], has: ["siti aminah"] },
  { cat: "typo", q: "wali kelas pak Fauzy", has: ["ahmad fauzi"] },
  // Negative: gibberish must not be forced onto a subject or class
  { cat: "typo", q: "nilai xqzvwk", route: "nilai", has: [], not_has: ["sub-0"] },
  { cat: "typo", q: "siswa nunggak kelas qwerty", not_has: ["k-0"] },
  // --- Tahun ajaran / waktu ---
  { cat: "waktu", q: "siapa yang belum bayar spp tahun ajaran ini", role: "KEUANGAN", route: "spp", has: ["nunggak"] },
  { cat: "waktu", q: "spp tahun ajaran 2025/2026", route: "spp", has: ["ay-2025"] },
  { cat: "waktu", q: "spp tahun ajaran lalu", route: "spp", has: ["ay-2025"] },
  { cat: "waktu", q: "siapa yang belum bayar spp hari ini", route: "spp", has: ["nunggak"] },
  { cat: "waktu", q: "siapa yang belum bayar spp kemarin", route: "spp", has: ["nunggak"] },
  { cat: "waktu", q: "siapa yang belum bayar spp minggu lalu", route: "spp", has: ["nunggak"] },
  { cat: "waktu", q: "siapa yang belum bayar spp bulan lalu", route: "spp", has: ["nunggak"] },
  // Negative: without the hint_regex gate the transformer must not invent a period/status
  { cat: "waktu", q: "daftar siswa kelas 8B", route: "siswa", has: ["k-08b"], not_has: ["nunggak", "bulan_ini", "hari_ini"] },
  { cat: "waktu", q: "nilai matematika kelas 8B", route: "nilai", not_has: ["bulan_ini", "hari_ini", "tahun_ini"] },
  // --- Siswa ---
  { cat: "siswa", q: "Siti ini ada di kelas berapa?", min_siswa: 2, roles: ["wali_kelas"] },
  { cat: "siswa", q: "Anak bernama Siti ada di kelas mana?", min_siswa: 2, not_roles: ["wali_kelas"] },
  { cat: "siswa", q: "siswa bernama Budi Santoso kelas berapa", has: ["budi santoso"] },
  { cat: "siswa", q: "spp atas nama Rian Hidayat", route: "spp", has: ["rian"] },
  { cat: "siswa", q: "nilai budi", route: "nilai", has: ["q=budi"] },
  { cat: "siswa", q: "Sitti ada di kelas berapa?", min_siswa: 1 },
  { cat: "siswa", q: "anak bernama Budy kelas berapa", has: ["budi santoso"] },
  // --- Wali kelas / guru ---
  { cat: "wali", q: "siapa wali kelas 8B", has: ["ahmad fauzi"] },
  { cat: "wali", q: "wali kelas bu Siti Aminah", roles: ["wali_kelas"], has: ["siti aminah"] },
  { cat: "wali", q: "bu aminah mengajar kelas apa", has: ["siti aminah"] },
  { cat: "wali", q: "pak fauzi wali kelas berapa", has: ["ahmad fauzi"] },
  // --- Guru (route "guru", /api/guru) ---
  { cat: "guru", q: "data guru bu Siti Nurhaliza", route: "guru", has: ["siti nurhaliza"] },
  { cat: "guru", q: "guru bernama Rina", route: "guru", has: ["rina wulandari"] },
  { cat: "guru", q: "data guru bu Rinna", route: "guru", has: ["rina wulandari"] },
  { cat: "guru", q: "data guru Siti", route: "guru", has: ["siti nurhaliza", "siti aminah"] },
  { cat: "guru", q: "data ustadz Abdullah", client: "2", role: "ADMIN", route: "guru", has: ["ustadz abdullah"] },
  // --- Bentrok: name shared by student, class teacher, etc. -> show all ---
  { cat: "bentrok", q: "Siti kelas berapa", min_siswa: 2, roles: ["wali_kelas"] },
  // --- Tenant isolation ---
  { cat: "tenant", q: "nilai nahwu", client: "2", role: "GURU", route: "nilai", known_fail: "tenant 2 has no nilai route nor master subject" },
  { cat: "tenant", q: "siswa nunggak kelas 8B", client: "2", role: "ADMIN", not_roles: ["siswa"] },
];

async function resolve(c: Case) {
  const res = await fetch(`${SEARCH_URL}/resolve?q=${encodeURIComponent(c.q)}`, {
    headers: { "X-Client-Id": c.client ?? "1", "X-User-Role": c.role ?? "SUPERADMIN" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as any;
}

function evaluate(c: Case, r: any): string[] {
  const problems: string[] = [];
  const options: any[] = r.options || [];
  const blob = JSON.stringify(options).toLowerCase();
  const entityRoles = new Set(options.map((o) => o.data?.entity_role).filter(Boolean));

  if (c.route && r.target_route !== c.route) problems.push(`route=${r.target_route}, want ${c.route}`);
  for (const h of c.has ?? []) if (!blob.includes(h.toLowerCase())) problems.push(`missing "${h}"`);
  for (const h of c.not_has ?? []) if (blob.includes(h.toLowerCase())) problems.push(`unexpected "${h}"`);
  for (const role of c.roles ?? []) if (!entityRoles.has(role)) problems.push(`missing entity_role ${role}`);
  for (const role of c.not_roles ?? []) if (entityRoles.has(role)) problems.push(`unexpected entity_role ${role}`);
  if (c.min_siswa !== undefined) {
    const n = options.filter((o) => o.data?.entity_role === "siswa").length;
    if (n < c.min_siswa) problems.push(`siswa options=${n}, want >=${c.min_siswa}`);
  }
  return problems;
}

async function main() {
  console.log(pc.bold(pc.cyan(`\nQuery suite: ${CASES.length} cases${STRICT ? " (strict)" : ""}\n`)));
  const stats: Record<string, { pass: number; total: number }> = {};
  let unexpected = 0;
  let fixed = 0;

  for (const c of CASES) {
    let problems: string[];
    try {
      problems = evaluate(c, await resolve(c));
    } catch (e: any) {
      problems = [`error: ${e.message}`];
    }
    const ok = problems.length === 0;
    const s = (stats[c.cat] ??= { pass: 0, total: 0 });
    s.total++;
    if (ok) s.pass++;

    const label = `[${c.cat}] ${c.q}`;
    if (ok && !c.known_fail) console.log(pc.green(`  ✔ ${label}`));
    else if (ok && c.known_fail) {
      fixed++;
      console.log(pc.green(`  ★ ${label}`) + pc.dim(`  now passes (was: ${c.known_fail}) -> drop known_fail`));
    } else if (c.known_fail) {
      if (STRICT) unexpected++;
      console.log(pc.yellow(`  ~ ${label}`) + pc.dim(`  known: ${c.known_fail} | ${problems.join("; ")}`));
    } else {
      unexpected++;
      console.log(pc.red(`  ✘ ${label}`) + pc.dim(`  ${problems.join("; ")}`));
    }
  }

  console.log(pc.bold("\nSummary per category"));
  for (const [cat, s] of Object.entries(stats)) console.log(`  ${cat.padEnd(8)} ${s.pass}/${s.total}`);
  const known = CASES.filter((c) => c.known_fail).length;
  console.log(pc.dim(`\n  known_fail cases: ${known}, newly passing: ${fixed}, unexpected failures: ${unexpected}`));
  process.exit(unexpected > 0 ? 1 : 0);
}

main();
