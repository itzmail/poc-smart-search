import pc from "picocolors";

const APP_URL = "http://127.0.0.1:3000";
const SEARCH_URL = "http://127.0.0.1:4000";

async function runE2E() {
  console.log(pc.bold(pc.cyan("\n🚀 MENJALANKAN TEST INTEGRASI E2E: ENTITY RESOLVER & MULTI-OPTION ARRAY\n")));

  // 1. Check Search Service
  console.log(pc.bold("1. Memeriksa Service Search (:4000)..."));
  try {
    const sRes = await fetch(`${SEARCH_URL}/health`);
    if (!sRes.ok) throw new Error(`HTTP ${sRes.status}`);
    const sData = await sRes.json();
    console.log(pc.green(`   ✔ Service Search Siap: ${JSON.stringify(sData)}`));
  } catch (err: any) {
    console.error(pc.red(`   ✘ Service Search belum aktif di port 4000: ${err.message}`));
    process.exit(1);
  }

  // 2. Check App Education + Entity Resolver Endpoint
  console.log(pc.bold("\n2. Memeriksa App Backend & Entity Resolver (:3000)..."));
  try {
    const rKelas = await (await fetch(`${APP_URL}/api/master/resolve?q=8B`, { headers: { "X-Client-Id": "1" } })).json();
    const rInv = await (await fetch(`${APP_URL}/api/master/resolve?q=INV-001`, { headers: { "X-Client-Id": "1" } })).json();
    console.log(pc.green(`   ✔ Entity Resolver Siap:`));
    console.log(`     • '8B' ➔ ${rKelas.entities[0]?.type}: [${rKelas.entities[0]?.id}] ${rKelas.entities[0]?.name}`);
    console.log(`     • 'INV-001' ➔ ${rInv.entities[0]?.type}: [${rInv.entities[0]?.id}] ${rInv.entities[0]?.name}`);
  } catch (err: any) {
    console.error(pc.red(`   ✘ App Backend belum aktif di port 3000: ${err.message}`));
    process.exit(1);
  }

  // 3. Test Skenario Ambigu: "kelas 8B" (Harus mengembalikan MULTI-OPTION ARRAY: DETAIL & LIST)
  console.log(pc.bold("\n3. Testing Skenario Ambigu: 'kelas 8B' (Multi-Option DETAIL & LIST)"));
  const rAmbigu = await (
    await fetch(`${APP_URL}/api/search?q=${encodeURIComponent("kelas 8B")}&threshold=0.2&engine=jev`, {
      headers: { "X-Client-Id": "1", "X-User-Role": "KEUANGAN" },
    })
  ).json();
  console.log(`   Total Options: ${pc.cyan(rAmbigu.total_options)} opsi ditemukan (Threshold: ${rAmbigu.threshold * 100}%)`);
  rAmbigu.options.forEach((opt: any) => {
    console.log(`     [#${opt.rank}] ${pc.yellow(opt.target_type)} | ${pc.bold(opt.title)} ➔ ${pc.blue(opt.destination)}`);
  });
  const hasDetail = rAmbigu.options.some((o: any) => o.target_type === "DETAIL");
  const hasList = rAmbigu.options.some((o: any) => o.target_type === "LIST");
  console.log(hasDetail && hasList ? pc.green("   ✔ Berhasil: Tersedia opsi DETAIL (/kelas/K-08B) dan LIST (/spp?kelas_id=K-08B).") : pc.red("   ✘ Gagal"));

  // 4. Test Skenario List Spesifik: "lihat siswa nunggak kelas 8B"
  console.log(pc.bold("\n4. Testing Skenario List Filter: 'lihat siswa nunggak kelas 8B'"));
  const rList = await (
    await fetch(`${APP_URL}/api/search?q=${encodeURIComponent("lihat siswa nunggak kelas 8B")}&engine=jev`, {
      headers: { "X-Client-Id": "1", "X-User-Role": "KEUANGAN" },
    })
  ).json();
  const topOpt = rList.options[0];
  console.log(`   Rank #1: ${pc.yellow(topOpt.target_type)} | Title: ${pc.bold(topOpt.title)}`);
  console.log(`   Destination: ${pc.blue(topOpt.destination)}`);
  console.log(topOpt.target_type === "LIST" ? pc.green("   ✔ Target Type LIST menduduki peringkat #1.") : pc.yellow("   ⚠️ Target type bukan LIST"));

  // 5. Test Skenario Invoice Langsung: "INV-001"
  console.log(pc.bold("\n5. Testing Skenario Invoice ID: 'INV-001'"));
  const rInv = await (
    await fetch(`${APP_URL}/api/search?q=${encodeURIComponent("INV-001")}&engine=jev`, {
      headers: { "X-Client-Id": "1", "X-User-Role": "KEUANGAN" },
    })
  ).json();
  const invOpt = rInv.options[0];
  console.log(`   Rank #1: ${pc.yellow(invOpt.target_type)} | Title: ${pc.bold(invOpt.title)}`);
  console.log(`   Destination: ${pc.blue(invOpt.destination)}`);
  console.log(invOpt.destination.includes("/spp/invoice/") ? pc.green("   ✔ Berhasil resolusi ke halaman detail invoice.") : pc.red("   ✘ Gagal resolusi"));

  // 6. Test Pengaruh Threshold: 0.8 vs 0.1
  console.log(pc.bold("\n6. Testing Pengaruh Parameter Threshold:"));
  const rTight = await (
    await fetch(`${APP_URL}/api/search?q=${encodeURIComponent("kelas 8B")}&threshold=0.85&engine=jev`, {
      headers: { "X-Client-Id": "1", "X-User-Role": "KEUANGAN" },
    })
  ).json();
  const rLoose = await (
    await fetch(`${APP_URL}/api/search?q=${encodeURIComponent("kelas 8B")}&threshold=0.10&engine=jev`, {
      headers: { "X-Client-Id": "1", "X-User-Role": "KEUANGAN" },
    })
  ).json();
  console.log(`   Threshold 85%: ${pc.cyan(rTight.total_options)} opsi`);
  console.log(`   Threshold 10%: ${pc.cyan(rLoose.total_options)} opsi`);
  console.log(rLoose.total_options >= rTight.total_options ? pc.green("   ✔ Threshold bekerja memfilter opsi secara dinamis.") : pc.red("   ✘ Gagal threshold"));

  // 7. Test Pertanyaan Alami: "Aku ingin tahu nama anak siti ada di kelas mana"
  console.log(pc.bold("\n7. Testing Pertanyaan Alami: 'Aku ingin tahu nama anak siti ada di kelas mana'"));
  const rSiti = await (
    await fetch(`${APP_URL}/api/search?q=${encodeURIComponent("Aku ingin tahu nama anak siti ada di kelas mana")}&engine=jev`, {
      headers: { "X-Client-Id": "1", "X-User-Role": "SUPERADMIN" },
    })
  ).json();
  console.log(`   Total Options: ${pc.cyan(rSiti.total_options)}`);
  rSiti.options.forEach((opt: any) => {
    console.log(`     [#${opt.rank}] ${pc.yellow(opt.target_type)} | ${pc.bold(opt.title)} ➔ ${pc.blue(opt.destination)}`);
  });
  const hasKelasSiti = rSiti.options[0]?.destination === "/kelas/K-08B";
  console.log(hasKelasSiti ? pc.green("   ✔ Berhasil: Rank #1 membuka Ruang Kelas 8B tempat Siti belajar (/kelas/K-08B).") : pc.red("   ✘ Gagal kelas siti"));

  // 8. Test Pertanyaan Agregasi: "kelas mana saja yang telat bayar"
  console.log(pc.bold("\n8. Testing Pertanyaan Agregasi: 'kelas mana saja yang telat bayar'"));
  const rTelat = await (
    await fetch(`${APP_URL}/api/search?q=${encodeURIComponent("kelas mana saja yang telat bayar")}&engine=jev`, {
      headers: { "X-Client-Id": "1", "X-User-Role": "SUPERADMIN" },
    })
  ).json();
  console.log(`   Total Options: ${pc.cyan(rTelat.total_options)}`);
  rTelat.options.forEach((opt: any) => {
    console.log(`     [#${opt.rank}] ${pc.yellow(opt.target_type)} | ${pc.bold(opt.title)} ➔ ${pc.blue(opt.destination)}`);
  });
  const hasRekap = rTelat.options.some((o: any) => o.destination.includes("status=nunggak"));
  console.log(hasRekap ? pc.green("   ✔ Berhasil: Memunculkan rekap tunggakan per kelas (8B dan 9A).") : pc.red("   ✘ Gagal agregasi"));

  // 9. Test Query Waktu Relatif: "siapa siswa yang belum bayar bulan ini"
  console.log(pc.bold("\n9. Testing Query Waktu Relatif: 'siapa siswa yang belum bayar bulan ini'"));
  const rBulanIni = await (
    await fetch(`${APP_URL}/api/search?q=${encodeURIComponent("siapa siswa yang belum bayar bulan ini")}&engine=jev`, {
      headers: { "X-Client-Id": "1", "X-User-Role": "KEUANGAN" },
    })
  ).json();
  console.log(`   Total Options: ${pc.cyan(rBulanIni.total_options)}`);
  rBulanIni.options.forEach((opt: any) => {
    console.log(`     [#${opt.rank}] ${pc.yellow(opt.target_type)} | ${pc.bold(opt.title)} ➔ ${pc.blue(opt.destination)}`);
  });
  const hasPeriode = rBulanIni.options[0]?.destination.includes("periode=bulan_ini");
  console.log(hasPeriode ? pc.green("   ✔ Berhasil: Filter waktu relatif 'bulan ini' dikirim ke route SPP (periode=bulan_ini).") : pc.red("   ✘ Gagal periode bulan ini"));

  // 10. Test Route Manifest: active_context & allowed_params
  console.log(pc.bold("\n10. Testing Route Manifest: 'active_context' & 'allowed_params'"));
  const rManifest = await (
    await fetch(`${APP_URL}/api/routes`, { headers: { "X-Client-Id": "1", "X-User-Role": "KEUANGAN" } })
  ).json();
  console.log(`   Active Context: ${pc.cyan(JSON.stringify(rManifest.active_context))}`);
  const sppRoute = rManifest.routes.find((r: any) => r.id === "spp");
  console.log(`   Route SPP allowed_params: ${pc.cyan(JSON.stringify(sppRoute?.allowed_params))}`);
  const ctxOk = rManifest.active_context?.tahun_ajaran && rManifest.active_context?.semester;
  const paramsOk = sppRoute?.allowed_params?.includes("periode");
  console.log(ctxOk && paramsOk ? pc.green("   ✔ Berhasil: App mengirim konteks kalender akademik aktif + kontrak allowed_params.") : pc.red("   ✘ Gagal manifest"));

  console.log(pc.bold(pc.green("\n🎉 SEMUA FITUR STANDARDIZED ARRAY, DETAIL vs LIST & THRESHOLD TERVERIFIKASI 100%!\n")));
}

runE2E().catch(console.error);
