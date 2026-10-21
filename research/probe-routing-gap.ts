import { dispatchAction } from "../service-search/src/dispatcher.js";
import { extractParams } from "../service-search/src/extractor.js";

const cls = (intent: any) => ({
  intent, confidence: 1,
  probabilities: { LIST_MENU: 0, DIRECT_LINK: 0, REPORT_ACTION: 0 } as any,
  engine: "JEV_CLOUD" as const, latency_ms: 1,
});

const R = (id: string, path: string, kw: string[], intents: string[]) =>
  ({ id, title: id, path, description: "", icon: "x", keywords: kw, supported_intents: intents, filter_keys: [] });

// Katalog penuh + 1 modul baru (PERPUSTAKAAN) yang TIDAK dikenal kode dispatcher
const routes: any[] = [
  R("dashboard", "/dashboard", ["dashboard","beranda"], ["LIST_MENU"]),
  R("siswa", "/siswa", ["siswa","murid"], ["LIST_MENU","DIRECT_LINK"]),
  R("nilai", "/nilai", ["nilai","akademik","mapel"], ["LIST_MENU","DIRECT_LINK"]),
  R("spp", "/spp", ["spp","tagihan","nunggak"], ["LIST_MENU","DIRECT_LINK"]),
  R("rapot", "/rapot", ["rapot","cetak"], ["LIST_MENU","REPORT_ACTION"]),
  R("perpustakaan", "/perpustakaan", ["buku","perpustakaan","pinjam"], ["LIST_MENU","DIRECT_LINK"]),
];

const cases: [string, any][] = [
  ["data nilai matematika kelas 8B", "DIRECT_LINK"],
  ["lihat siswa nunggak kelas 8B", "DIRECT_LINK"],
  ["lihat daftar buku perpustakaan kelas 8B", "DIRECT_LINK"],
  ["tampilkan jadwal ekstrakurikuler kelas 8B", "DIRECT_LINK"],   // domain TIDAK ada di katalog
  ["lihat daftar siswa", "DIRECT_LINK"],                          // ambigu: siswa umum
  ["buka menu perpustakaan", "LIST_MENU"],
];

for (const [q, intent] of cases) {
  const r = dispatchAction(q, cls(intent), extractParams(q), routes);
  const url = r.result.mode === "DIRECT_LINK" ? (r.result as any).target_url
    : r.result.mode === "LIST_MENU" ? (r.result as any).matched_menus.map((m: any) => m.path).join(", ")
    : (r.result as any).download_url;
  console.log(`"${q}"`.padEnd(48), "→", url);
}
