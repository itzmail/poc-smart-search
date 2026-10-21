import pc from "picocolors";
import { classifyIntent, type IntentType } from "./classifier.js";
import { extractParams } from "./extractor.js";
import { dispatchAction } from "./dispatcher.js";
import { getActiveRoutes } from "./routes-sync.js";

interface TestCase {
  query: string;
  expected: IntentType;
  expectedParams?: {
    kelas?: string;
    semester?: string;
    status?: string;
  };
}

const TEST_CASES: TestCase[] = [
  // 1. LIST_MENU
  { query: "ke menu master data siswa", expected: "LIST_MENU" },
  { query: "buka menu pembayaran spp", expected: "LIST_MENU" },
  { query: "halaman modul penilaian akademik", expected: "LIST_MENU" },
  { query: "buka pengaturan profil sekolah", expected: "LIST_MENU" },
  { query: "daftar menu keuangan spp", expected: "LIST_MENU" },
  { query: "link halaman dashboard utama", expected: "LIST_MENU" },

  // 2. DIRECT_LINK
  { query: "lihat siswa nunggak kelas 8B", expected: "DIRECT_LINK", expectedParams: { kelas: "8B", status: "nunggak" } },
  { query: "data nilai matematika kelas 9A semester ganjil", expected: "DIRECT_LINK", expectedParams: { kelas: "9A", semester: "ganjil" } },
  { query: "filter siswa aktif kelas 7C", expected: "DIRECT_LINK", expectedParams: { kelas: "7C", status: "aktif" } },
  { query: "daftar murid belum bayar uang sekolah kelas 8", expected: "DIRECT_LINK", expectedParams: { kelas: "8", status: "nunggak" } },
  { query: "buka nilai ipa semester genap kelas 8B", expected: "DIRECT_LINK", expectedParams: { kelas: "8B", semester: "genap" } },

  // 3. REPORT_ACTION
  { query: "cetak rapot kelas 8B semester ganjil", expected: "REPORT_ACTION", expectedParams: { kelas: "8B", semester: "ganjil" } },
  { query: "unduh rapot siswa budi santoso", expected: "REPORT_ACTION" },
  { query: "print raport semester 1 format pdf kelas 7A", expected: "REPORT_ACTION", expectedParams: { kelas: "7A", semester: "ganjil" } },
  { query: "download file rapot kelas 9A format pdf", expected: "REPORT_ACTION", expectedParams: { kelas: "9A" } },
  { query: "cetak e-rapor semester genap kelas 8", expected: "REPORT_ACTION", expectedParams: { kelas: "8", semester: "genap" } },
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
    const response = dispatchAction(tc.query, classification, params, dynamicRoutes);

    const isMatch = classification.intent === tc.expected;
    if (isMatch) correctCount++;
    latencies.push(classification.latency_ms);

    const statusBadge = isMatch ? pc.green("✔ PASS") : pc.red("✘ FAIL");
    console.log(
      `[${String(i + 1).padStart(2, "0")}/${TEST_CASES.length}] ${statusBadge} | "${pc.bold(tc.query)}"`
    );
    console.log(
      `     Intent: ${pc.cyan(classification.intent)} (exp: ${pc.dim(tc.expected)}) | Conf: ${Math.round(classification.confidence * 100)}% | Latency: ${classification.latency_ms}ms`
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

  return { engine: engineTitle, accuracy, avgLatency, min: Math.min(...latencies), max: Math.max(...latencies) };
}

async function main() {
  const targetEngine = process.argv[2] as "jev" | "laya" | undefined;

  if (targetEngine) {
    await runBenchmarkForEngine(targetEngine);
  } else {
    const resJev = await runBenchmarkForEngine("jev");
    const resLaya = await runBenchmarkForEngine("laya");

    console.log(pc.bold(pc.white("\n🏆 HEAD-TO-HEAD COMPARISON TABLE:")));
    console.log(pc.bold(pc.cyan("=========================================================================")));
    console.log(`| Engine                  | Accuracy | Avg Latency | Latency Range |`);
    console.log(`|-------------------------|----------|-------------|---------------|`);
    console.log(`| TypeSafe JEV (Cloud)    | ${String(resJev.accuracy + "%").padEnd(8)} | ${String(resJev.avgLatency + " ms").padEnd(11)} | ${resJev.min}ms – ${resJev.max}ms   |`);
    console.log(`| Laya-MLX (Local Daemon) | ${String(resLaya.accuracy + "%").padEnd(8)} | ${String(resLaya.avgLatency + " ms").padEnd(11)} | ${resLaya.min}ms – ${resLaya.max}ms    |`);
    console.log(pc.bold(pc.cyan("=========================================================================\n")));
  }
}

main().catch(console.error);
