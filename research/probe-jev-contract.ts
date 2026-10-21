const key = process.env.TYPESAFE_API_KEY || "";
const qs = [
  "buka menu pembayaran spp",
  "lihat siswa nunggak kelas 8B",
  "cetak rapot kelas 8B semester ganjil",
  "halo apa kabar",
  "berapa total tunggakan bulan ini",
  "unduh rapor budi format pdf",
];
const criteria = {
  LIST_MENU: "User is looking for static navigation menus or settings (e.g. 'ke menu spp', 'menu profil').",
  DIRECT_LINK: "User wants to view a specific filtered data table or deep link (e.g. 'lihat siswa nunggak kelas 8B', 'data nilai matematika').",
  REPORT_ACTION: "User wants to generate, print, or download a report card / rapot document (e.g. 'cetak rapot kelas 8B', 'unduh rapot budi format pdf').",
};
console.log("q".padEnd(38), "| choice".padEnd(16), "| conf  | probs(L/D/R)      | in/out tok | ms");
console.log("-".repeat(112));
for (const q of qs) {
  const t0 = performance.now();
  const res = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: "jev-latest", state: q,
      questions: { intent: { type: "choice",
        instructions: "Determine the user's intended smart search action in an education school management system.",
        criteria } } }),
  });
  const j: any = await res.json();
  const ms = Math.round((performance.now() - t0) * 100) / 100;
  const a = j.answers?.intent || {};
  const p = a.probabilities || {};
  const mismatch = a.confidence != null && p[a.choice] != null && Math.abs(a.confidence - p[a.choice]) > 0.005 ? " ⚠" : "";
  console.log(
    q.padEnd(38), "|", String(a.choice).padEnd(14), "|", String(a.confidence).padEnd(5), "|",
    `${p.LIST_MENU ?? "-"}/${p.DIRECT_LINK ?? "-"}/${p.REPORT_ACTION ?? "-"}`.padEnd(18), "|",
    `${j.usage?.input_tokens}/${j.usage?.output_tokens}`.padEnd(10), "|", ms + mismatch
  );
}
