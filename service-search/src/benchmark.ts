import pc from "picocolors";
import { classifyIntent } from "./classifier.js";
import { extractParams } from "./extractor.js";
import { dispatchAction } from "./dispatcher.js";
import { getActiveRoutes } from "./routes-sync.js";

interface TestCase {
  query: string;
  expected: "LIST_MENU" | "DIRECT_LINK" | "REPORT_ACTION";
}

const TEST_CASES: TestCase[] = [
  // Skenario 1: LIST_MENU
  { query: "buka menu pembayaran spp", expected: "LIST_MENU" },
  { query: "ke menu master siswa", expected: "LIST_MENU" },
  { query: "halaman penilaian rapor", expected: "LIST_MENU" },
  { query: "tampilkan menu pengaturan", expected: "LIST_MENU" },
  { query: "menu keuangan sekolah", expected: "LIST_MENU" },

  // Skenario 2: DIRECT_LINK
  { query: "lihat siswa nunggak kelas 8B", expected: "DIRECT_LINK" },
  { query: "data nilai matematika kelas 9A semester ganjil", expected: "DIRECT_LINK" },
  { query: "cari siswa atas nama Budi Santoso", expected: "DIRECT_LINK" },
  { query: "cek tagihan spp yang belum lunas kelas 7A", expected: "DIRECT_LINK" },
  { query: "daftar siswa aktif kelas 8B", expected: "DIRECT_LINK" },
  { query: "rekap nilai ipa kelas 8B semester genap", expected: "DIRECT_LINK" },

  // Skenario 3: REPORT_ACTION
  { query: "cetak rapot kelas 8B semester ganjil", expected: "REPORT_ACTION" },
  { query: "unduh rapor siswa budi format pdf", expected: "REPORT_ACTION" },
  { query: "download raport kelas 7A semester 1", expected: "REPORT_ACTION" },
  { query: "print leger nilai kelas 9A", expected: "REPORT_ACTION" },
  { query: "cetak rapor semester genap", expected: "REPORT_ACTION" },
];

async function runBenchmarkForEngine(engineName: "jev" | "laya") {
  const engineTitle = engineName === "jev" ? "TypeSafe JEV Cloud (System One)" : "Laya Local Daemon (MLX :4141)";
  console.log(pc.bold(pc.cyan(`\n🧪 BENCHMARK ENGINE: ${engineTitle}`)));
  console.log(`Total sample queries: ${TEST_CASES.length}\n`);

  // Warmup
  await classifyIntent("warmup test", engineName);

  const dynamicRoutes = await getActiveRoutes();

  let correctCount = 0;
  const latencies: number[] = [];

  for (let i = 0; i < TEST_CASES.length; i++) {
    const tc = TEST_CASES[i];
    const classification = await classifyIntent(tc.query, engineName);
    const params = extractParams(tc.query);
    const response = dispatchAction(tc.query, classification, params, dynamicRoutes, [], 0.2);

    const isMatch = classification.intent === tc.expected;
    if (isMatch) correctCount++;
    latencies.push(classification.latency_ms);

    const statusBadge = isMatch ? pc.green("✔ PASS") : pc.red("✘ FAIL");
    console.log(
      `[${String(i + 1).padStart(2, "0")}/${TEST_CASES.length}] ${statusBadge} | "${pc.bold(tc.query)}"`
    );
    console.log(
      `     Intent: ${pc.cyan(classification.intent)} (exp: ${pc.dim(tc.expected)}) | Options: ${response.total_options} | Latency: ${classification.latency_ms}ms`
    );
  }

  const avgLatency = Math.round((latencies.reduce((a, b) => a + b, 0) / latencies.length) * 100) / 100;
  const accuracy = Math.round((correctCount / TEST_CASES.length) * 100);

  console.log(pc.dim("─".repeat(60)));
  console.log(`📊 Hasil untuk ${pc.bold(engineTitle)}:`);
  console.log(`• Accuracy    : ${accuracy >= 90 ? pc.green(accuracy + "%") : pc.yellow(accuracy + "%")}`);
  console.log(`• Avg Latency : ${pc.green(avgLatency + " ms")}`);
  console.log(`• Latency Range: ${Math.min(...latencies)}ms – ${Math.max(...latencies)}ms`);
  console.log(pc.dim("─".repeat(60)));

  return { engine: engineName, accuracy, avgLatency, latencies };
}

async function main() {
  console.clear();
  console.log(pc.bold(pc.yellow("=========================================================================")));
  console.log(pc.bold(pc.white("   🏆 SMART SEARCH BENCHMARK: TypeSafe JEV vs Laya-MLX Local")));
  console.log(pc.dim("   Testing 16 Typical Indonesian Education Queries (Threshold: 20%)"));
  console.log(pc.bold(pc.yellow("=========================================================================")));

  const jevResult = await runBenchmarkForEngine("jev");
  const layaResult = await runBenchmarkForEngine("laya");

  console.log("\n" + pc.bold(pc.cyan("📋 TABEL PERBANDINGAN AKHIR:")));
  console.log("┌──────────────────────────┬──────────┬─────────────┬────────────────────┐");
  console.log("│ Engine                   │ Accuracy │ Avg Latency │ Latency Range      │");
  console.log("├──────────────────────────┼──────────┼─────────────┼────────────────────┤");
  console.log(
    `│ ${pc.bold("TypeSafe JEV (Cloud)")}     │ ${String(jevResult.accuracy + "%").padEnd(8)} │ ${String(jevResult.avgLatency + " ms").padEnd(11)} │ ${Math.min(...jevResult.latencies)}ms – ${Math.max(...jevResult.latencies)}ms`.padEnd(52) +
      "│"
  );
  console.log(
    `│ ${pc.bold("Laya-MLX (Local Daemon)")}  │ ${String(layaResult.accuracy + "%").padEnd(8)} │ ${String(layaResult.avgLatency + " ms").padEnd(11)} │ ${Math.min(...layaResult.latencies)}ms – ${Math.max(...layaResult.latencies)}ms`.padEnd(52) +
      "│"
  );
  console.log("└──────────────────────────┴──────────┴─────────────┴────────────────────┘\n");
}

main().catch(console.error);
