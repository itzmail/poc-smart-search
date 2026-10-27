import pc from "picocolors";
import { extractRawParams } from "./service-search/src/extractor.js";
import type { ParamSpec } from "./service-search/src/routes-sync.js";

// Unit table for the pure extractor (no server needed): bun run test-extractor.ts
const statusSpec = {
  key: "status",
  mode: "enum",
  values: {
    nunggak: "\\b(nunggak|belum\\s*(bayar|lunas))\\b",
    lunas: "\\b(lunas|sudah\\s*bayar)\\b",
  },
} as unknown as ParamSpec;

interface Case {
  q: string;
  tokens?: string[]; // must be present
  no_tokens?: string[]; // must be absent
  enum?: Record<string, string>; // expected enumValues
  time?: Partial<Record<"hari_ini" | "bulan_ini" | "tahun_ini" | "tahun_ajaran_ini" | "tahun_ajaran_lalu", boolean>>;
}

const CASES: Case[] = [
  // tokens: names kept, command/role words dropped
  { q: "nilai budi", tokens: ["budi"], no_tokens: ["nilai"] },
  { q: "Anak bernama Siti ada di kelas berapa?", tokens: ["siti"], no_tokens: ["anak", "bernama", "kelas", "berapa", "ada"] },
  { q: "siswa bernama Budi Santoso kelas berapa", tokens: ["budi santoso"], no_tokens: ["siswa", "bernama"] },
  { q: "Anak bernama Siti ada di kelas berapa?", no_tokens: ["bernama siti"] },
  { q: "spp atas nama Rian Hidayat", tokens: ["rian hidayat", "rian", "hidayat"], no_tokens: ["spp", "atas", "nama"] },
  { q: "wali kelas bu Siti Aminah", tokens: ["siti", "aminah"], no_tokens: ["wali", "kelas", "bu"] },
  { q: "pak fauzi wali kelas berapa", tokens: ["fauzi"], no_tokens: ["wali", "berapa", "pak"] },
  { q: "daftar siswa kelas 7A", no_tokens: ["kelas 7a"] },
  { q: "spp tahun ajaran sebelumnya", no_tokens: ["sebelumnya"] },
  // tokens: class and subject codes, after normalization
  { q: "siswa nunggak kelas 8B", tokens: ["8b"], no_tokens: ["nunggak", "siswa"] },
  { q: "siswa nunggak kelas VIII B", tokens: ["8b"] },
  { q: "siswa nunggak kelas delapan b", tokens: ["8b"] },
  { q: "kelas 8 b", tokens: ["8b"] },
  { q: "nilai matematika kelas 8B", tokens: ["matematika", "8b"], no_tokens: ["nilai", "kelas"] },
  { q: "nilai mtk 8B", tokens: ["mtk", "8b"] },
  { q: "nilai bahasa inggris", tokens: ["bahasa", "inggris"] },
  // normalization must not touch ordinary words
  { q: "spp satu minggu lalu", no_tokens: ["1"] },
  // enum (regex layer)
  { q: "siapa yang belum bayar spp", enum: { status: "nunggak" } },
  { q: "siapa yang sudah bayar spp", enum: { status: "lunas" } },
  { q: "daftar siswa kelas 7A", enum: {} },
  // time hints
  { q: "spp tahun ajaran ini", time: { tahun_ajaran_ini: true, tahun_ajaran_lalu: false, tahun_ini: false } },
  { q: "spp tahun ini", time: { tahun_ini: true, tahun_ajaran_ini: false } },
  { q: "spp tahun ajaran lalu", time: { tahun_ajaran_lalu: true, tahun_ajaran_ini: false } },
  { q: "spp tahun ajaran sebelumnya", time: { tahun_ajaran_lalu: true } },
  { q: "spp tahun ajaran 2025/2026", time: { tahun_ajaran_lalu: false, tahun_ajaran_ini: false } },
  { q: "spp hari ini", time: { hari_ini: true, bulan_ini: false } },
  { q: "spp bulan ini", time: { bulan_ini: true, hari_ini: false } },
  { q: "spp bulan lalu", time: { bulan_ini: false, tahun_ajaran_lalu: false } },
];

let failed = 0;
for (const c of CASES) {
  const r = extractRawParams(c.q, [statusSpec]);
  const problems: string[] = [];
  for (const t of c.tokens ?? []) if (!r.tokens.includes(t)) problems.push(`missing token "${t}"`);
  for (const t of c.no_tokens ?? []) if (r.tokens.includes(t)) problems.push(`unexpected token "${t}"`);
  if (c.enum && JSON.stringify(r.enumValues) !== JSON.stringify(c.enum)) {
    problems.push(`enum=${JSON.stringify(r.enumValues)}, want ${JSON.stringify(c.enum)}`);
  }
  for (const [k, v] of Object.entries(c.time ?? {})) {
    if ((r.timeHints as Record<string, boolean>)[k] !== v) problems.push(`time.${k}=${(r.timeHints as Record<string, boolean>)[k]}, want ${v}`);
  }
  if (problems.length) {
    failed++;
    console.log(pc.red(`  ✘ ${c.q}`) + pc.dim(`  ${problems.join("; ")}  | tokens=${JSON.stringify(r.tokens)}`));
  } else {
    console.log(pc.green(`  ✔ ${c.q}`) + pc.dim(`  tokens=${JSON.stringify(r.tokens)}`));
  }
}
console.log(`\n${CASES.length - failed}/${CASES.length} passed`);
process.exit(failed ? 1 : 0);
