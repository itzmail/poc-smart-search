/**
 * RISET: Analisis Lapisan Akses API (JEV / Laya) pada Smart Search
 * Mengukur berapa banyak panggilan API eksternal per request, breakdown latency,
 * perilaku fallback, dan throughput saat cache hit vs cache miss.
 */
import pc from "picocolors";

const SEARCH = "http://127.0.0.1:4000";
const APP = "http://127.0.0.1:3000";
const LAYA = "http://127.0.0.1:4141";
const JEV = "https://api.typesafe.ai/v1/systemone";

const key = process.env.TYPESAFE_API_KEY || "";

async function timeIt(label: string, fn: () => Promise<any>) {
  const t0 = performance.now();
  try {
    const r = await fn();
    const ms = Math.round((performance.now() - t0) * 100) / 100;
    console.log(`   ${pc.green("✔")} ${label.padEnd(46)} ${pc.bold(ms + " ms")}`);
    return { ok: true, ms, r };
  } catch (e: any) {
    const ms = Math.round((performance.now() - t0) * 100) / 100;
    console.log(`   ${pc.red("✘")} ${label.padEnd(46)} ${pc.red(ms + " ms")} ${pc.dim(e.message)}`);
    return { ok: false, ms, r: null };
  }
}

console.log(pc.bold(pc.cyan("\n════════ RISET: LAPISAN AKSES API (JEV / LAYA) ════════\n")));

// ── A. Panggilan API eksternal murni (tanpa app di atasnya) ──────────────
console.log(pc.bold("A. Latensi API eksternal (direct, tanpa wrapper)"));
console.log(pc.dim("   Tujuan: tahu biaya asli 1 panggilan engine"));

const layaEmbeds: number[] = [];
for (let i = 0; i < 5; i++) {
  const r = await timeIt(`POST ${LAYA}/embed  (query tunggal, run ${i + 1})`, async () => {
    const res = await fetch(`${LAYA}/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: [`uji latensi laya run ${i}`] }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  });
  if (r.ok) layaEmbeds.push(r.ms);
}

// Batch anchor (4 intent x ~6 kalimat) — hanya terjadi sekali saat cold start
await timeIt(`POST ${LAYA}/embed  (batch anchors, cold-start only)`, async () => {
  const res = await fetch(`${LAYA}/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      texts: [
        "buka menu spp", "menu profil", "ke dashboard", "halaman pengaturan",
        "lihat siswa nunggak kelas 8b", "data nilai matematika", "daftar siswa aktif",
        "cetak rapot kelas 8b", "unduh rapor budi", "print leger semester ganjil",
      ],
    }),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
});

const jevRuns: number[] = [];
for (let i = 0; i < 3; i++) {
  const r = await timeIt(`POST api.typesafe.ai/v1/systemone  (run ${i + 1})`, async () => {
    const res = await fetch(JEV, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "jev-latest",
        state: `uji latensi jev run ${i}`,
        questions: {
          intent: {
            type: "choice",
            instructions: "Determine the user's intended smart search action.",
            criteria: { LIST_MENU: "navigation menu", DIRECT_LINK: "filtered data table", REPORT_ACTION: "print document" },
          },
        },
      }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const j = await res.json();
    return { answers: j.answers, keys: Object.keys(j) };
  });
  if (r.ok) jevRuns.push(r.ms);
  if (i === 0 && r.ok) console.log(pc.dim(`      ↳ shape response: ${JSON.stringify(r.r.keys)} answers=${JSON.stringify(r.r.answers)}`));
}

// ── B. Panggilan internal app (ACL route sync + SQLite) ────────────────
console.log(pc.bold("\nB. API internal yang dipanggil setelah engine memutuskan"));
await timeIt("GET /api/routes  (ACL Pintro: job+groups+acl)", async () => {
  const res = await fetch(`${APP}/api/routes`, { headers: { "X-Client-Id": "1", "X-User-Role": "KEUANGAN" } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
});
await timeIt("GET /api/spp?status=nunggak&kelas=8B  (SQLite)", async () => {
  const res = await fetch(`${APP}/api/spp?status=nunggak&kelas=8B`, { headers: { "X-Client-Id": "1" } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
});
await timeIt("GET /api/rapot/download  (aksi file)", async () => {
  const res = await fetch(`${APP}/api/rapot/download?kelas=8B&semester=ganjil&format=pdf`, { headers: { "X-Client-Id": "1" } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.text();
});

// ── C. End-to-end: cache miss vs cache hit ─────────────────────────────
console.log(pc.bold("\nC. End-to-end /api/search — cache MISS vs cache HIT"));
const uniq = `uji riset ${Math.floor(performance.now())}`;
await timeIt(`MISS  JEV   "${uniq.slice(0, 22)}..."`, async () => {
  const res = await fetch(`${APP}/api/search?q=${encodeURIComponent(uniq)}&engine=jev`, { headers: { "X-Client-Id": "1", "X-User-Role": "KEUANGAN" } });
  return res.json();
});
await timeIt(`HIT   JEV   (query sama, dari Redis)`, async () => {
  const res = await fetch(`${APP}/api/search?q=${encodeURIComponent(uniq)}&engine=jev`, { headers: { "X-Client-Id": "1", "X-User-Role": "KEUANGAN" } });
  const j = await res.json();
  if (!j.cached) throw new Error("tidak kena cache");
  return j;
});
const uniqLaya = `uji riset laya ${Math.floor(performance.now())}`;
await timeIt(`MISS  LAYA  "${uniqLaya.slice(0, 22)}..."`, async () => {
  const res = await fetch(`${APP}/api/search?q=${encodeURIComponent(uniqLaya)}&engine=laya`, { headers: { "X-Client-Id": "1", "X-User-Role": "KEUANGAN" } });
  return res.json();
});

// ── D. Throughput konkurensi (cache hit vs JEV asli) ───────────────────
console.log(pc.bold("\nD. Konkurensi: throughput cache-hit vs panggilan JEV asli"));

async function blast(n: number, label: string, fn: (i: number) => Promise<any>) {
  const t0 = performance.now();
  const results = await Promise.allSettled(Array.from({ length: n }, (_, i) => fn(i)));
  const ms = Math.round((performance.now() - t0) * 100) / 100;
  const ok = results.filter((r) => r.status === "fulfilled").length;
  const fail = n - ok;
  const rps = Math.round((n / ms) * 1000);
  console.log(
    `   ${label}: ${pc.bold(n + " request")} → ${pc.bold(ms + "ms")} | ${pc.green(ok + " ok")}${fail ? " / " + pc.red(fail + " gagal") : ""} | ${pc.cyan("~" + rps + " rps")}`
  );
  return { ms, ok, fail, rps };
}

const cached = await blast(50, "50x CACHE HIT (Redis) ", async () => {
  const res = await fetch(`${APP}/api/search?q=${encodeURIComponent(uniq)}&engine=jev`, { headers: { "X-Client-Id": "1", "X-User-Role": "KEUANGAN" } });
  return res.json();
});

const jevBlast = await blast(10, "10x JEV ASLI (tiap req unik)", async (i) => {
  const res = await fetch(`${APP}/api/search?q=${encodeURIComponent(`siswa nunggak kelas 8b probe ${i} ${Math.floor(performance.now())}`)}&engine=jev`, { headers: { "X-Client-Id": "1", "X-User-Role": "KEUANGAN" } });
  return res.json();
});

const layaBlast = await blast(20, "20x LAYA ASLI (tiap req unik)", async (i) => {
  const res = await fetch(`${APP}/api/search?q=${encodeURIComponent(`siswa nunggak kelas 8b laya ${i} ${Math.floor(performance.now())}`)}&engine=laya`, { headers: { "X-Client-Id": "1", "X-User-Role": "KEUANGAN" } });
  return res.json();
});

// ── E. Fallback: JEV gagal → Laya ──────────────────────────────────────
console.log(pc.bold("\nE. Perilaku fallback (JEV error → Laya lokal)"));
await timeIt("MISS  auto  (key valid, harusnya JEV)", async () => {
  const res = await fetch(`${APP}/api/search?q=${encodeURIComponent(`probe auto ${Math.floor(performance.now())}`)}&engine=auto`, { headers: { "X-Client-Id": "1", "X-User-Role": "KEUANGAN" } });
  const j = await res.json();
  console.log(pc.dim(`      ↳ engine terpakai: ${j.engine}`));
  return j;
});

// ── Ringkasan ──────────────────────────────────────────────────────────
const avg = (a: number[]) => Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 100) / 100;
console.log(pc.bold(pc.cyan("\n════════ RINGKASAN ANGKA ════════")));
console.log(`Laya /embed (query)   avg ${pc.bold(avg(layaEmbeds) + " ms")}   n=${layaEmbeds.length}  [${Math.min(...layaEmbeds)}–${Math.max(...layaEmbeds)}]`);
console.log(`JEV systemone         avg ${pc.bold(avg(jevRuns) + " ms")}   n=${jevRuns.length}  [${Math.min(...jevRuns)}–${Math.max(...jevRuns)}]`);
console.log(`Ratio JEV / Laya      ${pc.bold(Math.round((avg(jevRuns) / avg(layaEmbeds)) * 100) / 100)}x lebih lambat (biaya jaringan cloud)`);
console.log(`Cache-hit throughput  ${pc.bold(cached.rps + " rps")}  (${cached.fail} gagal dari 50) → CPU engine 0%`);
console.log(`JEV real throughput   ${pc.bold(jevBlast.rps + " rps")}  (${jevBlast.fail} gagal dari 10)`);
console.log(`Laya real throughput  ${pc.bold(layaBlast.rps + " rps")}  (${layaBlast.fail} gagal dari 20)`);
console.log("");
