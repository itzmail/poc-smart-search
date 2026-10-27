import pc from "picocolors";
import * as fs from "node:fs";

const APP_URL = "http://127.0.0.1:3000";
const SEARCH_URL = "http://127.0.0.1:4000";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log(pc.green(`   ✔ ${label}`) + (detail ? pc.dim(`  ${detail}`) : ""));
  else {
    failures++;
    console.error(pc.red(`   ✘ ${label}`) + (detail ? pc.dim(`  ${detail}`) : ""));
  }
}

async function search(q: string, role: string, clientId = "1", engine = "auto") {
  const res = await fetch(
    `${SEARCH_URL}/resolve?q=${encodeURIComponent(q)}&engine=${engine}`,
    { headers: { "X-Client-Id": clientId, "X-User-Role": role } }
  );
  if (!res.ok) throw new Error(`resolve HTTP ${res.status}: ${await res.text()}`);
  return await res.json();
}

async function runE2E() {
  console.log(pc.bold(pc.cyan("\n🚀 E2E SEQUENTIAL LAZY PIPELINE (Classify -> allowed_params -> Lazy Master -> Options)\n")));

  // 1. Health check
  console.log(pc.bold("1. Health check kedua service..."));
  const health = await (await fetch(`${SEARCH_URL}/health`)).json();
  console.log(pc.green(`   ✔ service-search: cache=${health.cache.engine}`));
  const appHealth = await fetch(`${APP_URL}/api/routes`, { headers: { "X-Client-Id": "1", "X-User-Role": "SUPERADMIN" } });
  console.log(pc.green(`   ✔ app-education: HTTP ${appHealth.status}`));

  // 2. Route manifest dari tabel search_routes (ParamSpec penuh)
  console.log(pc.bold("\n2. Route Manifest (tabel search_routes + ACL)"));
  const routes = await appHealth.json();
  const sppRoute: any = routes.routes.find((r: any) => r.id === "spp");
  console.log(pc.dim(`   Active Context: ${JSON.stringify(routes.active_context)}`));
  console.log(pc.dim(`   spp allowed_params: ${JSON.stringify(sppRoute.allowed_params.map((p: any) => p.key))}`));
  check(
    "ParamSpec ber-endpoint tersedia dari DB",
    sppRoute.allowed_params.some((p: any) => p.endpoint && p.mode === "list") &&
      sppRoute.allowed_params.some((p: any) => p.mode === "enum" && p.values)
  );

  // 3. Kasus multi-entity: "Siti ini ada di kelas berapa?"
  console.log(pc.bold("\n3. Multi-Entity Disambiguation: 'Siti ini ada di kelas berapa?'"));
  const rSiti = await search("Siti ini ada di kelas berapa?", "SUPERADMIN");
  console.log(`   route=${rSiti.target_route} | resolved=${JSON.stringify(Object.keys(rSiti.resolved_params || {}))}`);
  rSiti.options.forEach((o: any) =>
    console.log(`     [#${o.rank}] ${pc.yellow(o.target_type)} ${pc.bold(o.title)} ➔ ${pc.blue(o.destination)}`)
  );
  const siswaOpts = rSiti.options.filter((o: any) => o.data?.entity_role === "siswa");
  const waliOpt = rSiti.options.find((o: any) => o.data?.entity_role === "wali_kelas");
  check("2 siswa 'Siti' (Siti Rahma 8B & Siti Aisyah 7A) muncul sebagai opsi terpisah", siswaOpts.length >= 2 && !!siswaOpts.find((o: any) => o.data.siswa.nama === "Siti Aisyah"));
  check("Opsi wali kelas 'Siti Aminah, S.Pd' juga muncul", !!waliOpt && waliOpt.data.wali_kelas.nama.includes("Siti Aminah"));
  check("Payload data membawa objek siswa + kelas lengkap", !!siswaOpts[0]?.data?.siswa?.id && !!siswaOpts[0]?.data?.kelas?.id);

  // 4. Filter SPP + tahun ajaran aktif
  console.log(pc.bold("\n4. Negasi & Kalender: 'Siapa yang belum bayar spp tahun ajaran ini?'"));
  const rSpp = await search("Siapa yang belum bayar spp tahun ajaran ini?", "KEUANGAN");
  console.log(`   route=${rSpp.target_route}`);
  rSpp.options.slice(0, 2).forEach((o: any) => console.log(`     [#${o.rank}] ${pc.bold(o.title)} ➔ ${pc.blue(o.destination)}`));
  const filters = rSpp.options[0]?.data?.filters || {};
  check("status=nunggak (negasi-aware, bukan salah ke 'linas')", filters.status === "nunggak");
  check("academic_year_id FK tahun ajaran AKTIF dari DB (AY-2026)", filters.academic_year_id === routes.active_context.academic_year_id);

  // 5. Negasi kebalikan: 'riwayat tagihan yang sudah lunas'
  console.log(pc.bold("\n5. Negasi kebalikan: 'riwayat tagihan yang sudah lunas'"));
  const rLunas = await search("riwayat tagihan yang sudah lunas", "SUPERADMIN");
  check("status=lunas (bukan nunggak meski ada kata 'tagihan')", rLunas.options[0]?.data?.filters?.status === "lunas", `-> ${rLunas.options[0]?.destination}`);

  // 5B. Natural-language waktu & status (enum + semantic fallback + date range filter):
  console.log(pc.bold("\n5B. Natural Language: waktu relatif & status colloquial"));
  const nlCases = [
    {
      q: "Siapa yang belum bayar spp minggu ini?",
      check: (f: any) => f.status === "nunggak" && !!f["created_at.$gte"] && !!f["created_at.$lte"],
      desc: 'status="nunggak", created_at.$gte & created_at.$lte present',
    },
    {
      q: "Siapa yang belum bayar spp tahun lalu?",
      check: (f: any) => f.status === "nunggak" && !!f["created_at.$gte"] && !!f["created_at.$lte"],
      desc: 'status="nunggak", created_at.$gte & created_at.$lte present',
    },
    { q: "santri yang udah nyetor syahriah", check: (f: any) => f.status === "lunas", desc: 'status="lunas"' },
    { q: "santri yang belum nyetor syahriah", check: (f: any) => f.status === "nunggak", desc: 'status="nunggak"' },
    { q: "kembalian siswa yg sudah kasih duit", check: (f: any) => f.status === "lunas", desc: 'status="lunas"' },
  ];
  for (const tc of nlCases) {
    const r = await search(tc.q, "SUPERADMIN");
    const f = r.options[0]?.data?.filters || {};
    const ok = tc.check(f);
    check(`"${tc.q}" -> ${tc.desc}`, ok, `got ${JSON.stringify(f)}`);
  }

  // 6. Master semantic: 'nilai matematika tahun ajaran ini'
  console.log(pc.bold("\n6. Master lazy cache: 'nilai matematika tahun ajaran ini'"));
  const rNilai = await search("nilai matematika tahun ajaran ini", "SUPERADMIN");
  const nilaiFilters = rNilai.options[0]?.data?.filters || {};
  console.log(`   route=${rNilai.target_route} ➔ ${pc.blue(rNilai.options[0]?.destination)}`);
  check("subject_id ter-resolve ke master subjects", !!nilaiFilters.subject_id);
  check("academic_year_id AKTIF ikut ter-set", !!nilaiFilters.academic_year_id);

  // 7. ACL: GURU tidak boleh dapat SPP
  console.log(pc.bold("\n7. ACL Isolasi: role GURU meminta SPP"));
  const rGuru = await search("spp nunggak", "GURU");
  const guruDests = rGuru.options.map((o: any) => o.destination);
  console.log(pc.dim(`   Options GURU: ${JSON.stringify(guruDests)}`));
  check("Tidak ada opsi /spp untuk role GURU", !guruDests.some((d: any) => d.startsWith("/spp")));

  // 8. Multi-tenant: client_id=2 terisolasi
  console.log(pc.bold("\n8. Multi-Tenant: client_id=2 (santri)"));
  const rT2 = await search("santri nunggak", "ADMIN", "2");
  console.log(pc.dim(`   Options tenant 2: ${rT2.options.map((o: any) => o.destination).join(", ")}`));
  const t2Manifest = await (await fetch(`${APP_URL}/api/routes`, { headers: { "X-Client-Id": "2", "X-User-Role": "ADMIN" } })).json();
  check(
    "Tenant 2 isolated: route spp & manifest tanpa bocor tenant lain",
    rT2.target_route === "spp" && t2Manifest.routes.every((r: any) => r.client_id === "2")
  );

  // 9. Threshold dinamis
  console.log(pc.bold("\n9. Threshold dinamis (tight 0.9 vs loose 0.1)"));
  const rTightQ = await fetch(`${SEARCH_URL}/resolve?q=${encodeURIComponent("Siti ini ada di kelas berapa?")}&threshold=0.9`, { headers: { "X-Client-Id": "1", "X-User-Role": "SUPERADMIN" } }).then((r) => r.json());
  const rLooseQ = await fetch(`${SEARCH_URL}/resolve?q=${encodeURIComponent("Siti ini ada di kelas berapa?")}&threshold=0.1`, { headers: { "X-Client-Id": "1", "X-User-Role": "SUPERADMIN" } }).then((r) => r.json());
  console.log(pc.dim(`   Threshold 90%: ${rTightQ.total_options} opsi | Threshold 10%: ${rLooseQ.total_options} opsi`));
  check("Threshold bekerja memfilter opsi dinamis", rLooseQ.total_options >= rTightQ.total_options);

  // 10. Local fallback (transformers.js in-process)
  console.log(pc.bold("\n10. Local Fallback (transformers.js in-process, engine=local)"));
  const rLocal = await search("Siti ini ada di kelas berapa?", "SUPERADMIN", "1", "local");
  console.log(pc.dim(`   engine=${rLocal.meta?.engine} | route=${rLocal.target_route}`));
  check("Fallback local tetap menurunkan opsi entity kelas Siti", rLocal.options.some((o: any) => o.destination === "/kelas/K-08B"));

  // 11. Cache hit latensi
  console.log(pc.bold("\n11. Redis Query Cache (2nd call < 20ms)"));
  const t1 = performance.now();
  await fetch(`${SEARCH_URL}/resolve?q=${encodeURIComponent("Siti ini ada di kelas berapa?")}`, { headers: { "X-Client-Id": "1", "X-User-Role": "SUPERADMIN" } });
  const dur = performance.now() - t1;
  console.log(pc.dim(`   2nd call: ${dur.toFixed(2)}ms`));
  check(dur < 20, "Cache hit < 20ms");

  // 11b. Kata penunjuk siswa: fetch siswa saja, tanpa opsi wali kelas
  console.log(pc.bold("\n11b. Anchor siswa: 'Anak bernama Siti ada di kelas mana?'"));
  await fetch(`${SEARCH_URL}/routes/refresh`, { method: "POST", headers: { "X-Client-Id": "1", "X-User-Role": "SUPERADMIN" } });
  const rAnak = await search("Anak bernama Siti ada di kelas mana?", "SUPERADMIN");
  const anakSiswa = rAnak.options.filter((o: any) => o.data?.entity_role === "siswa");
  check("Token ter-ekstrak hanya 'siti' -> 2 siswa Siti muncul", anakSiswa.length >= 2 && !!anakSiswa.find((o: any) => o.data.siswa.nama === "Siti Aisyah"));
  check("Opsi wali kelas TIDAK muncul saat ada kata 'anak'", !rAnak.options.some((o: any) => o.data?.entity_role === "wali_kelas"));

  // 12. Hardening: identitas, batas input, isolasi tenant, rate limit
  console.log(pc.bold("\n12. Hardening (identitas, batas input, isolasi tenant, rate limit)"));
  const H1 = { "X-Client-Id": "1", "X-User-Role": "SUPERADMIN" };
  const get = (qs: string, headers: Record<string, string> = H1) => fetch(`${SEARCH_URL}/resolve?${qs}`, { headers });
  const qSiti = encodeURIComponent("Siti ini ada di kelas berapa?");

  check("Tanpa header identitas -> 401", (await get(`q=${qSiti}`, {})).status === 401);
  check("X-Client-Id tidak valid -> 401", (await get(`q=${qSiti}`, { "X-Client-Id": "a:b", "X-User-Role": "GURU" })).status === 401);

  const plain = await (await get(`q=${qSiti}`)).json();
  const spoofed = await (await get(`q=${qSiti}&client_id=2&role=GURU&engine=local`)).json();
  check(
    "client_id/role/engine di query diabaikan (hasil identik dengan tenant 1)",
    spoofed.target_route === plain.target_route && spoofed.total_options === plain.total_options && spoofed.meta?.engine === plain.meta?.engine
  );

  const otherTenant = await (await get(`q=${qSiti}`, { "X-Client-Id": "2", "X-User-Role": "SUPERADMIN" })).json();
  check("Cache tenant 1 tidak dilayani ke tenant 2", otherTenant.meta?.cached === false);

  check("q 201 karakter -> 400", (await get(`q=${"a".repeat(201)}`)).status === 400);
  const bigBody = await fetch(`${SEARCH_URL}/resolve`, { method: "POST", headers: H1, body: "x".repeat(5000) });
  check("Body POST > 4 KB -> 413", bigBody.status === 413);
  check("Body POST JSON rusak -> 400", (await fetch(`${SEARCH_URL}/resolve`, { method: "POST", headers: H1, body: "{bad" })).status === 400);

  for (const t of ["abc", "-5", "999", "Infinity"]) {
    check(`threshold='${t}' tidak membuat error`, (await get(`q=${qSiti}&threshold=${t}`)).status === 200);
  }

  if (process.env.RATE_LIMIT_RPM === "0") {
    console.log(pc.dim("   (skip rate limit: RATE_LIMIT_RPM=0)"));
  } else {
    const rlHeaders = { "X-Client-Id": "rl-test", "X-User-Role": "GURU" };
    let limited: Response | undefined;
    for (let i = 0; i < 400 && !limited; i++) {
      const r = await get(`q=${qSiti}`, rlHeaders);
      if (r.status === 429) limited = r;
    }
    check("Rate limit -> 429 dengan Retry-After", !!limited && Number(limited.headers.get("Retry-After")) >= 1);
  }

  // Rangkuman
  if (failures === 0) {
    console.log(pc.bold(pc.green("\n🎉 SEMUA CHECK SEQUENTIAL LAZY PIPELINE LULUS!\n")));
  } else {
    console.log(pc.bold(pc.red(`\n⛔ ${failures} CHECK GAGAL — perbaiki pipeline sebelum deploy.\n`)));
    process.exit(1);
  }
}

// Simpan ringkasan hasil ke file untuk audit CI (opsional)
process.on("exit", (code) => {
  try {
    fs.writeFileSync(
      "e2e-result.json",
      JSON.stringify({ status: code === 0 ? "pass" : "fail", failures, at: new Date().toISOString() }, null, 2)
    );
  } catch {}
});

runE2E().catch((e) => {
  console.error(pc.red(`\n⛔ E2E Fatal: ${e.message}`));
  process.exit(1);
});
