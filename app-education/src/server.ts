import * as http from "node:http";
import pc from "picocolors";
import { db, initDatabase, getSearchRoutes } from "./data/db.js";

// Inisialisasi skema & tabel SQLite dengan skema Pintro (job, groups, acl, master_kelas, invoice)
initDatabase();

const PORT = parseInt(process.env.APP_PORT || "3000", 10);
const SEARCH_SERVICE_URL = process.env.SEARCH_SERVICE_URL || "http://127.0.0.1:4000";

function sendJson(res: http.ServerResponse, statusCode: number, data: any) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Client-Id, X-User-Role",
  });
  res.end(JSON.stringify(data, null, 2));
}

// Konteks kalender akademik aktif per tenant.
// Sumber kebenaran untuk query waktu relatif: "tahun ajaran ini", "semester ini", "bulan ini", "hari ini".
function getActiveContext(clientId: string = "1") {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12

  // Fallback kalender jika row DB belum ter-set
  const isGanjil = month >= 7;
  const fallbackYear = isGanjil ? `${year}/${year + 1}` : `${year - 1}/${year}`;
  const fallbackSemester = isGanjil ? "ganjil" : "genap";

  // Ambil tahun ajaran aktif dari DB:
  // Prioritas 1: is_active=1 dan hari ini berada di rentang start_date..end_date
  // Prioritas 2: is_active=1 (LIMIT 1)
  const todayStr = now.toISOString().slice(0, 10);
  let ay = db.query(`
    SELECT id, name, semester FROM academic_year
    WHERE client_id = ? AND is_active = 1 AND ? BETWEEN start_date AND end_date
    LIMIT 1
  `).get(clientId, todayStr) as { id: string; name: string; semester: string } | null;

  if (!ay) {
    ay = db.query(`
      SELECT id, name, semester FROM academic_year
      WHERE client_id = ? AND is_active = 1
      ORDER BY id DESC
      LIMIT 1
    `).get(clientId) as { id: string; name: string; semester: string } | null;
  }

  const monthName = now.toLocaleString("id-ID", { month: "long" });
  return {
    today: todayStr,
    bulan_label: `${monthName} ${year}`,
    tahun_ajaran: ay?.name ?? fallbackYear,
    semester: ay?.semester ?? fallbackSemester,
    academic_year_id: ay?.id,
  };
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url || "/", `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;
  const qParams = parsedUrl.searchParams;

  // Baca Multi-Tenant Context dari Header / Query Params
  const clientId = (req.headers["x-client-id"] || qParams.get("client_id") || "1").toString();
  const userRole = (req.headers["x-user-role"] || qParams.get("role") || "SUPERADMIN").toString().toUpperCase();

  // 0. Dynamic Route Manifest Endpoint (Filter Berdasarkan Pintro ACL: search_routes + acl + groups)
  // Sumber kebenaran: tabel search_routes di DB, di-JOIN dengan acl & groups via getSearchRoutes()
  if (pathname === "/api/routes" || pathname === "/routes") {
    console.log(pc.dim(`[APP ACL] Fetch routes untuk Client ID: ${clientId} | Role: ${userRole}`));

    const rawRoutes = getSearchRoutes(clientId, userRole) as Array<{
      id: string;
      job_id: string;
      code: string;
      title: string;
      url_path: string;
      description: string;
      keywords: string;
      supported_intents: string;
      allowed_params: string;
      is_active: number;
      client_id: string;
    }>;

    const activeContext = getActiveContext(clientId);
    const routes = rawRoutes.map((sr) => {
      let keywords: string[] = [];
      let supportedIntents: string[] = ["LIST_MENU", "DIRECT_LINK"];
      let allowedParams: any[] = [];
      try { keywords = JSON.parse(sr.keywords || "[]"); } catch {}
      try { supportedIntents = JSON.parse(sr.supported_intents || "[]"); } catch {}
      try {
        allowedParams = JSON.parse(sr.allowed_params || "[]");
        // Sanitasi dinamis: bersihkan hint_regex yang masih memuat daftar nama dummy hardcode
        // dari seed lama agar resolver tidak membatasi nama siswa/santri/wali.
        allowedParams = allowedParams.map((p: any) => {
          if (p.key === "siswa_id" && p.hint_regex) {
            // Ubah pemicu menjadi kata peran/keterangan konteks siswa secara dinamis (tanpa nama orang spesifik)
            p.hint_regex = "\\b(siapa|siswa|student|murid|santri|anak|nama|milik|atas\\s+nama)\\b|[a-z]{3,}";
          }
          return p;
        });
      } catch {}

      return {
        id: sr.code,
        job_id: sr.job_id,
        job_code: sr.code,
        title: sr.title,
        path: sr.url_path,
        icon: "layout-dashboard",
        description: sr.description || `Modul ${sr.title} (Client: ${sr.client_id})`,
        keywords,
        supported_intents: supportedIntents,
        allowed_params: allowedParams,
        client_id: sr.client_id,
      };
    });

    return sendJson(res, 200, {
      service: "app-education",
      client_id: clientId,
      user_role: userRole,
      active_context: activeContext,
      total_permitted_routes: routes.length,
      routes,
    });
  }

  // 0a. Master Endpoints (per X-Client-Id) untuk lazy-resolver di service-search
  // Mode "list" di ParamSpec merujuk ke endpoint-endpoint ini:
  // - /api/master/academic-years -> id, name, semester, is_active
  // - /api/master/subjects       -> id, name
  // - /api/master/kelas          -> id, code, name, tingkat, wali_kelas
  if (pathname === "/api/master/academic-years") {
    const rows = db.query(`
      SELECT id, name, semester, start_date, end_date, is_active, client_id
      FROM academic_year
      WHERE client_id = ?
      ORDER BY start_date DESC
    `).all(clientId);
    return sendJson(res, 200, {
      module: "Master Academic Years",
      client_id: clientId,
      count: rows.length,
      data: rows,
    });
  }

  if (pathname === "/api/master/subjects") {
    const rows = db.query(`
      SELECT id, name, client_id
      FROM master_subject
      WHERE client_id = ?
      ORDER BY id ASC
    `).all(clientId);
    return sendJson(res, 200, {
      module: "Master Subjects",
      client_id: clientId,
      count: rows.length,
      data: rows,
    });
  }

  if (pathname === "/api/master/kelas") {
    const rows = db.query(`
      SELECT id, code, name, tingkat, wali_kelas, client_id
      FROM master_kelas
      WHERE client_id = ?
      ORDER BY tingkat ASC, code ASC
    `).all(clientId);
    return sendJson(res, 200, {
      module: "Master Kelas",
      client_id: clientId,
      count: rows.length,
      data: rows,
    });
  }

  // 0b. Master Entity Resolver (Mendeteksi Kelas, Invoice, Siswa & Agregasi)
  if (pathname === "/api/master/resolve") {
    const rawQ = (qParams.get("q") || "").replace(/\+/g, " ").trim();
    const q = rawQ.toLowerCase();
    if (!q) {
      return sendJson(res, 200, { found: false, entities: [] });
    }

    const entities: Array<{
      type: "kelas" | "invoice" | "siswa" | "agregasi";
      id: string;
      code?: string;
      name: string;
      detail_url?: string;
      list_url: string;
      meta?: any;
    }> = [];

    // Deteksi Pola Agregasi: "kelas mana saja yang telat / nunggak / bayar"
    const isArrearsAggregation = /\b(kelas\s+mana|mana\s+saja|daftar\s+kelas)\b/i.test(q) &&
      /\b(telat|nunggak|belum\s*lunas|tunggakan|bayar)\b/i.test(q);

    if (isArrearsAggregation) {
      const arrearsClasses = db.query(`
        SELECT k.id as kelas_id, k.code, k.name, COUNT(s.id) as total_nunggak, SUM(s.nominal) as total_nominal
        FROM spp s
        JOIN master_kelas k ON LOWER(k.code) = LOWER(s.kelas) AND k.client_id = s.client_id
        WHERE s.client_id = ? AND s.status = 'nunggak'
        GROUP BY k.id, k.code, k.name
        ORDER BY total_nunggak DESC
      `).all(clientId) as any[];

      if (arrearsClasses.length > 0) {
        entities.push({
          type: "agregasi",
          id: "rekap-nunggak-kelas",
          name: "Rekap Tunggakan SPP per Kelas",
          list_url: "/spp?status=nunggak",
          meta: {
            classes: arrearsClasses,
            total_classes: arrearsClasses.length,
          },
        });
      }
    }

    // 1. Cek tabel master_kelas (mis. "8b", "kelas 8b", "8B", "k-08b")
    const cleanKelasCode = q.replace(/^kelas\s*/i, "").trim();
    const kelasRow = db.query(`
      SELECT id, code, name, tingkat 
      FROM master_kelas 
      WHERE client_id = ? AND (LOWER(code) = ? OR LOWER(name) LIKE ? OR LOWER(id) = ?)
      LIMIT 1
    `).get(clientId, cleanKelasCode, `%${cleanKelasCode}%`, cleanKelasCode) as any;

    if (kelasRow) {
      entities.push({
        type: "kelas",
        id: kelasRow.id,
        code: kelasRow.code,
        name: kelasRow.name,
        detail_url: `/kelas/${kelasRow.id}`,
        list_url: `/spp?kelas_id=${kelasRow.id}`,
      });
    }

    // 2. Cek tabel invoice (mis. "INV-2024-10-001", "INV-001", "001", "INV/2024/10/001")
    const numToken = q.match(/\d+/)?.[0];
    const invoiceRow = db.query(`
      SELECT id, invoice_no, siswa_id, nama_siswa, kelas_id, nominal, status 
      FROM invoice 
      WHERE client_id = ? AND (
        LOWER(id) LIKE ? OR 
        LOWER(invoice_no) LIKE ? OR
        (? != '' AND (id LIKE ? OR invoice_no LIKE ?))
      )
      LIMIT 1
    `).get(
      clientId, 
      `%${q}%`, 
      `%${q}%`, 
      numToken || "", 
      numToken ? `%${numToken}%` : "%never_match%",
      numToken ? `%${numToken}%` : "%never_match%"
    ) as any;

    if (invoiceRow) {
      entities.push({
        type: "invoice",
        id: invoiceRow.id,
        code: invoiceRow.invoice_no,
        name: `Tagihan ${invoiceRow.invoice_no} (${invoiceRow.nama_siswa})`,
        detail_url: `/spp/invoice/${invoiceRow.id}`,
        list_url: `/spp?status=${invoiceRow.status}`,
      });
    }

    // 3. Cek tabel siswa dengan Smart Token Extraction
    // Ekstrak nama siswa dari kalimat natural (misal: "nama anak siti", "anak budi", "siswa farhan")
    const candidateTokens: string[] = [];
    const namePattern = q.match(/(?:nama\s+anak|anak|siswa|murid|santri)\s+([a-z\s]+?)(?:\s+(?:ada|di|kelas|mana|sudah|belum)|$)/i);
    if (namePattern && namePattern[1].trim()) {
      candidateTokens.push(namePattern[1].trim());
    }

    // Tambah token individual panjang >= 3 karakter
    // Stopword diperluas: kata tanya, waktu relatif, & kata aksi umum agar tidak
    // salah terdeteksi sebagai nama siswa (mis. "ini" nyaris cocok dgn "Anggraini")
    const STOPWORDS = new Set([
      "aku", "ingin", "tahu", "nama", "anak", "ada", "yang", "dan", "dari", "kelas", "mana", "saja",
      "bisa", "buat", "lihat", "cek", "ini", "itu", "belum", "sudah", "bayar", "bulan", "hari", "tahun",
      "ajaran", "pelajaran", "nunggak", "lunas", "tagihan", "tunggakan", "cetak", "semua", "daftar",
      "rekap", "total", "berapa", "tolong", "tunjukkan", "buka", "data", "status", "siapa", "apakah",
      "periode", "aktif", "semester",
    ]);
    q.split(/\s+/).forEach((w) => {
      const clean = w.replace(/[^a-z0-9]/gi, "");
      if (clean.length >= 3 && !STOPWORDS.has(clean)) {
        if (!candidateTokens.includes(clean)) candidateTokens.push(clean);
      }
    });

    let siswaRow: any = null;
    for (const token of candidateTokens) {
      siswaRow = db.query(`
        SELECT id, nisn, nama, kelas, kelas_id 
        FROM siswa 
        WHERE client_id = ? AND (LOWER(nama) LIKE ? OR LOWER(id) = ? OR nisn = ?)
        LIMIT 1
      `).get(clientId, `%${token}%`, token, token) as any;
      if (siswaRow) break;
    }

    if (siswaRow) {
      // Ambil juga data invoice terkait siswa ini jika ada
      const relatedInvoices = db.query(`
        SELECT id, invoice_no, nominal, status 
        FROM invoice 
        WHERE client_id = ? AND siswa_id = ? 
        ORDER BY id DESC LIMIT 2
      `).all(clientId, siswaRow.id) as any[];

      entities.push({
        type: "siswa",
        id: siswaRow.id,
        name: siswaRow.nama,
        detail_url: `/siswa/${siswaRow.id}`,
        list_url: `/siswa?kelas_id=${siswaRow.kelas_id || siswaRow.kelas}`,
        meta: {
          kelas: siswaRow.kelas,
          kelas_id: siswaRow.kelas_id,
          kelas_detail_url: `/kelas/${siswaRow.kelas_id || siswaRow.kelas}`,
          invoices: relatedInvoices,
        },
      });
    }

    return sendJson(res, 200, {
      found: entities.length > 0,
      total: entities.length,
      entities,
    });
  }

  // 1. Dashboard Module - Terisolasi per Client ID
  if (pathname === "/api/dashboard" || pathname === "/dashboard") {
    const totalSiswa = db.query("SELECT COUNT(id) as cnt FROM siswa WHERE client_id = ?").get(clientId) as { cnt: number };
    const siswaAktif = db.query("SELECT COUNT(id) as cnt FROM siswa WHERE status = 'aktif' AND client_id = ?").get(clientId) as { cnt: number };
    const sppNunggak = db.query("SELECT COUNT(id) as cnt, COALESCE(SUM(nominal), 0) as total FROM spp WHERE status = 'nunggak' AND client_id = ?").get(clientId) as { cnt: number; total: number };

    return sendJson(res, 200, {
      title: "Statistik Dashboard Sekolah",
      client_id: clientId,
      user_role: userRole,
      source: "sqlite://education.db",
      summary: {
        total_siswa: totalSiswa.cnt,
        siswa_aktif: siswaAktif.cnt,
        total_nunggak_spp: sppNunggak.cnt,
        nominal_nunggak: sppNunggak.total,
      },
    });
  }

  // 2. Data Siswa Module
  if (pathname === "/api/siswa" || pathname === "/siswa") {
    const kelas = qParams.get("kelas");
    const kelasId = qParams.get("kelas_id");
    const status = qParams.get("status");
    const search = qParams.get("q");

    let sql = "SELECT id, nisn, nama, kelas, kelas_id, status, gender, client_id FROM siswa WHERE client_id = ?";
    const params: string[] = [clientId];

    if (kelasId) {
      sql += " AND (LOWER(kelas_id) = LOWER(?) OR LOWER(kelas) = LOWER(?))";
      params.push(kelasId, kelasId);
    } else if (kelas) {
      sql += " AND LOWER(kelas) = LOWER(?)";
      params.push(kelas);
    }
    if (status) {
      sql += " AND LOWER(status) = LOWER(?)";
      params.push(status);
    }
    if (search) {
      sql += " AND LOWER(nama) LIKE LOWER(?)";
      params.push(`%${search}%`);
    }

    const rows = db.query(sql).all(...params);
    return sendJson(res, 200, {
      module: "Master Data Siswa",
      client_id: clientId,
      filters_applied: { kelas: kelasId || kelas, status, search },
      count: rows.length,
      data: rows,
    });
  }

  // 2b. Detail Siswa by ID
  if (pathname.startsWith("/api/siswa/") || pathname.startsWith("/siswa/")) {
    const id = pathname.replace(/^\/(api\/)?siswa\//, "");
    const row = db.query("SELECT id, nisn, nama, kelas, kelas_id, status, gender, client_id FROM siswa WHERE client_id = ? AND id = ?").get(clientId, id);
    if (!row) return sendJson(res, 404, { error: "Siswa tidak ditemukan" });
    return sendJson(res, 200, { module: "Detail Siswa", data: row });
  }

  // 3. Detail Kelas by ID
  if (pathname.startsWith("/api/kelas/") || pathname.startsWith("/kelas/")) {
    const id = pathname.replace(/^\/(api\/)?kelas\//, "");
    const kelasRow = db.query("SELECT id, code, name, tingkat, wali_kelas, client_id FROM master_kelas WHERE client_id = ? AND id = ?").get(clientId, id);
    if (!kelasRow) return sendJson(res, 404, { error: "Kelas tidak ditemukan" });
    const siswaList = db.query("SELECT id, nisn, nama, status FROM siswa WHERE client_id = ? AND (kelas_id = ? OR kelas = ?)").all(clientId, id, (kelasRow as any).code);
    return sendJson(res, 200, {
      module: "Detail Ruang Kelas",
      kelas: kelasRow,
      total_siswa: siswaList.length,
      siswa: siswaList,
    });
  }

  // 4. SPP Keuangan Module
  if (pathname === "/api/spp" || pathname === "/spp") {
    const status = qParams.get("status");
    const kelas = qParams.get("kelas");
    const kelasId = qParams.get("kelas_id");
    const periode = qParams.get("periode"); // hari_ini | minggu_ini | bulan_ini | bulan_lalu | tahun_ini | tahun_lalu
    const academicYearId = qParams.get("academic_year_id");

    let sql = "SELECT id, siswa_id, nama_siswa, kelas, academic_year_id, bulan, nominal, status, jatuh_tempo, client_id FROM spp WHERE client_id = ?";
    const params: string[] = [clientId];

    if (status) {
      sql += " AND LOWER(status) = LOWER(?)";
      params.push(status);
    }

    if (academicYearId) {
      sql += " AND academic_year_id = ?";
      params.push(academicYearId);
    }

    // Filter waktu relatif dihitung server-side (TIDAK ditebak oleh AI)
    if (periode === "hari_ini") {
      sql += " AND date(jatuh_tempo) = date('now', 'localtime')";
    } else if (periode === "minggu_ini") {
      sql += " AND date(jatuh_tempo) BETWEEN date('now', 'localtime', '-7 days') AND date('now', 'localtime')";
    } else if (periode === "bulan_ini") {
      sql += " AND strftime('%Y-%m', jatuh_tempo) = strftime('%Y-%m', 'now', 'localtime')";
    } else if (periode === "bulan_lalu") {
      sql += " AND strftime('%Y-%m', jatuh_tempo) = strftime('%Y-%m', 'now', 'localtime', '-1 month')";
    } else if (periode === "tahun_ini") {
      sql += " AND strftime('%Y', jatuh_tempo) = strftime('%Y', 'now', 'localtime')";
    } else if (periode === "tahun_lalu") {
      sql += " AND strftime('%Y', jatuh_tempo) = strftime('%Y', 'now', 'localtime', '-1 year')";
    }

    if (kelasId) {
      sql += " AND (LOWER(kelas) = LOWER(?) OR id IN (SELECT id FROM spp WHERE kelas = ?))";
      // Fallback matching kelas kode
      const clean = kelasId.replace(/^K-0?/, "").toLowerCase();
      params.push(clean, clean);
    } else if (kelas) {
      sql += " AND LOWER(kelas) = LOWER(?)";
      params.push(kelas);
    }

    const rows = db.query(sql).all(...params) as any[];
    const totalTunggakan = rows
      .filter((r) => r.status === "nunggak")
      .reduce((acc, curr) => acc + curr.nominal, 0);

    return sendJson(res, 200, {
      module: "Tagihan & Pembayaran SPP",
      client_id: clientId,
      filters_applied: {
        status,
        kelas: kelasId || kelas,
        periode: periode || null,
        academic_year_id: academicYearId || null,
      },
      active_context: getActiveContext(clientId),
      total_tunggakan: totalTunggakan,
      count: rows.length,
      data: rows,
    });
  }

  // 4b. Detail Invoice by ID
  if (pathname.startsWith("/api/spp/invoice/") || pathname.startsWith("/spp/invoice/")) {
    const id = pathname.replace(/^\/(api\/)?spp\/invoice\//, "");
    const inv = db.query("SELECT id, invoice_no, siswa_id, nama_siswa, kelas_id, academic_year_id, bulan, nominal, status, client_id FROM invoice WHERE client_id = ? AND id = ?").get(clientId, id);
    if (!inv) return sendJson(res, 404, { error: "Invoice tidak ditemukan" });
    return sendJson(res, 200, { module: "Detail Invoice Tagihan SPP", data: inv });
  }

  // 4c. Penilaian Akademik (Nilai) Module
  if (pathname === "/api/nilai" || pathname === "/nilai") {
    const subjectId = qParams.get("subject_id") || qParams.get("mapel");
    const kelasId = qParams.get("kelas_id") || qParams.get("kelas");
    const semester = qParams.get("semester");
    const academicYearId = qParams.get("academic_year_id");

    let sql = `
      SELECT id, siswa_id, nama_siswa, kelas, academic_year_id, mapel, semester, nilai_akhir, keterangan, client_id
      FROM nilai
      WHERE client_id = ?
    `;
    const params: string[] = [clientId];

    if (subjectId) {
      // Cocokkan ID mapel (SUB-01) atau nama mapel (Matematika)
      const subRow = db.query("SELECT name FROM master_subject WHERE client_id = ? AND (id = ? OR LOWER(name) = LOWER(?))").get(clientId, subjectId, subjectId) as { name: string } | null;
      const subName = subRow?.name || subjectId;
      sql += " AND LOWER(mapel) LIKE LOWER(?)";
      params.push(`%${subName}%`);
    }

    if (kelasId) {
      const clean = kelasId.replace(/^K-0?/, "").toLowerCase();
      sql += " AND (LOWER(kelas) = LOWER(?) OR LOWER(kelas) = LOWER(?))";
      params.push(kelasId, clean);
    }

    if (semester) {
      sql += " AND LOWER(semester) = LOWER(?)";
      params.push(semester);
    }

    if (academicYearId) {
      sql += " AND academic_year_id = ?";
      params.push(academicYearId);
    }

    sql += " ORDER BY id ASC";
    const rows = db.query(sql).all(...params) as any[];

    return sendJson(res, 200, {
      module: "Penilaian Akademik Siswa",
      client_id: clientId,
      filters_applied: {
        subject_id: subjectId || null,
        kelas_id: kelasId || null,
        semester: semester || null,
        academic_year_id: academicYearId || null,
      },
      count: rows.length,
      data: rows,
    });
  }

  // 5. Rapot Module
  if (pathname === "/api/rapot" || pathname === "/rapot") {
    const kelas = qParams.get("kelas") || "8B";
    const semester = qParams.get("semester") || "ganjil";

    const sql = "SELECT id, nama, kelas, client_id FROM siswa WHERE client_id = ? AND LOWER(kelas) = LOWER(?)";
    const students = db.query(sql).all(clientId, kelas) as { id: string; nama: string; kelas: string }[];

    return sendJson(res, 200, {
      module: "Cetak & Distribusi Rapot",
      client_id: clientId,
      kelas,
      semester,
      total_siswa_siap_cetak: students.length,
      students: students.map((s) => ({
        id: s.id,
        nama: s.nama,
        status_leger: "Lengkap",
        download_action_url: `/api/rapot/download?kelas=${kelas}&semester=${semester}&nama=${encodeURIComponent(s.nama)}&format=pdf`,
      })),
    });
  }

  // 5b. Rapot Download Action Endpoint
  if (pathname === "/api/rapot/download") {
    const kelas = qParams.get("kelas") || "Umum";
    const semester = qParams.get("semester") || "Ganjil";
    const format = qParams.get("format") || "pdf";
    const nama = qParams.get("nama") || "Semua_Siswa";

    const filename = `Rapor_${nama.replace(/\s+/g, "_")}_Client_${clientId}_Kelas_${kelas}_${semester}.${format}`;

    res.writeHead(200, {
      "Content-Type": format === "pdf" ? "application/pdf" : "text/plain",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Mock-Action": "SUCCESS_DOWNLOAD",
    });

    res.end(
      `[MOCK DOKUMEN RAPOT RESMI DARI DATABASE SQLITE]\nClient ID: ${clientId}\nNama Siswa: ${nama}\nKelas: ${kelas}\nSemester: ${semester}\nFormat: ${format.toUpperCase()}\nStatus: Generated by Smart Search Action Engine.\n`
    );
    return;
  }

  // 6. Global Smart Search Gateway
  if (pathname === "/api/search") {
    const rawQuery = qParams.get("q") || "";
    const query = rawQuery.replace(/\+/g, " ");
    const engine = qParams.get("engine") || "auto";
    const threshold = qParams.get("threshold") || "0.2";

    if (!query) {
      return sendJson(res, 400, { error: "Query parameter 'q' is required." });
    }

    try {
      const searchUrl = new URL(`${SEARCH_SERVICE_URL}/resolve`);
      searchUrl.searchParams.set("q", query);
      searchUrl.searchParams.set("engine", engine);
      searchUrl.searchParams.set("threshold", threshold);

      const searchRes = await fetch(searchUrl.toString(), {
        headers: {
          "X-Client-Id": clientId,
          "X-User-Role": userRole,
        },
      });

      if (!searchRes.ok) {
        throw new Error(`Search service error HTTP ${searchRes.status}`);
      }

      const searchResult = await searchRes.json();
      return sendJson(res, 200, searchResult);
    } catch (err: any) {
      return sendJson(res, 502, {
        error: "Smart Search Service unreachable",
        detail: err.message,
        tip: "Pastikan service-search sedang berjalan di port 4000 (bun run start:search)",
      });
    }
  }

  sendJson(res, 404, { error: "Route not found" });
});

server.listen(PORT, () => {
  console.log(`\n🏫 [App Pendidikan Backend + SQLite (Pintro Multi-Tenant & Entity Resolver)] running on http://127.0.0.1:${PORT}`);
  console.log(`📁 Database: education.db (Tabel: job, groups, acl, master_kelas, invoice, siswa, nilai, spp)`);
  console.log(`📡 Endpoints:`);
  console.log(`   • GET /api/routes (ACL Filtered)`);
  console.log(`   • GET /api/master/resolve?q=query (Entity Lookup by ID/Code/Name)`);
  console.log(`   • GET /api/kelas/:id (Detail Ruang Kelas)`);
  console.log(`   • GET /api/spp/invoice/:id (Detail Invoice)`);
  console.log(`   • GET /api/search?q=query&threshold=0.2 (Multi-Option Search Gateway)\n`);
});

// Graceful shutdown: tutup port saat Ctrl+C (SIGINT) atau SIGTERM
const shutdown = () => {
  console.log(pc.yellow("\n🛑 [App Pendidikan] Menghentikan server dan melepas port..."));
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 1000).unref();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
