import * as http from "node:http";
import pc from "picocolors";
import { db, initDatabase } from "./data/db.js";

// Inisialisasi skema & tabel SQLite
initDatabase();

const PORT = parseInt(process.env.APP_PORT || "3000", 10);
const SEARCH_SERVICE_URL = process.env.SEARCH_SERVICE_URL || "http://127.0.0.1:4000";

function sendJson(res: http.ServerResponse, statusCode: number, data: any) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data, null, 2));
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url || "/", `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;
  const qParams = parsedUrl.searchParams;

  // 1. Dashboard Module - Query agregasi langsung dari SQLite
  if (pathname === "/api/dashboard" || pathname === "/dashboard") {
    const totalSiswa = db.query("SELECT COUNT(id) as cnt FROM siswa").get() as { cnt: number };
    const siswaAktif = db.query("SELECT COUNT(id) as cnt FROM siswa WHERE status = 'aktif'").get() as { cnt: number };
    const sppNunggak = db.query("SELECT COUNT(id) as cnt, COALESCE(SUM(nominal), 0) as total FROM spp WHERE status = 'nunggak'").get() as { cnt: number; total: number };

    console.log(pc.dim(`[SQLITE] SELECT aggregate dashboard summary`));

    return sendJson(res, 200, {
      title: "Statistik Dashboard Sekolah",
      source: "sqlite://education.db",
      summary: {
        total_siswa: totalSiswa.cnt,
        siswa_aktif: siswaAktif.cnt,
        total_nunggak_spp: sppNunggak.cnt,
        nominal_nunggak: sppNunggak.total,
      },
    });
  }

  // 2. Data Siswa Module - Query dinamis ke SQLite
  if (pathname === "/api/siswa" || pathname === "/siswa") {
    const kelas = qParams.get("kelas");
    const status = qParams.get("status");
    const search = qParams.get("q");

    let sql = "SELECT id, nisn, nama, kelas, status, gender FROM siswa WHERE 1=1";
    const params: string[] = [];

    if (kelas) {
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

    console.log(pc.dim(`[SQLITE] ${sql} | Params: ${JSON.stringify(params)}`));
    const rows = db.query(sql).all(...params);

    return sendJson(res, 200, {
      module: "Master Data Siswa",
      source: "sqlite://education.db",
      filters_applied: { kelas, status, search },
      count: rows.length,
      data: rows,
    });
  }

  // 3. Nilai Akademik Module - Query ke SQLite
  if (pathname === "/api/nilai" || pathname === "/nilai") {
    const kelas = qParams.get("kelas");
    const semester = qParams.get("semester");
    const mapel = qParams.get("mapel");

    let sql = "SELECT id, siswa_id, nama_siswa, kelas, mapel, semester, nilai_akhir, keterangan FROM nilai WHERE 1=1";
    const params: string[] = [];

    if (kelas) {
      sql += " AND LOWER(kelas) = LOWER(?)";
      params.push(kelas);
    }
    if (semester) {
      sql += " AND LOWER(semester) = LOWER(?)";
      params.push(semester);
    }
    if (mapel) {
      sql += " AND LOWER(mapel) = LOWER(?)";
      params.push(mapel);
    }

    console.log(pc.dim(`[SQLITE] ${sql} | Params: ${JSON.stringify(params)}`));
    const rows = db.query(sql).all(...params);

    return sendJson(res, 200, {
      module: "Penilaian Akademik Siswa",
      source: "sqlite://education.db",
      filters_applied: { kelas, semester, mapel },
      count: rows.length,
      data: rows,
    });
  }

  // 4. SPP Keuangan Module - Query ke SQLite
  if (pathname === "/api/spp" || pathname === "/spp") {
    const status = qParams.get("status");
    const kelas = qParams.get("kelas");

    let sql = "SELECT id, siswa_id, nama_siswa, kelas, bulan, nominal, status, jatuh_tempo FROM spp WHERE 1=1";
    const params: string[] = [];

    if (status) {
      sql += " AND LOWER(status) = LOWER(?)";
      params.push(status);
    }
    if (kelas) {
      sql += " AND LOWER(kelas) = LOWER(?)";
      params.push(kelas);
    }

    console.log(pc.dim(`[SQLITE] ${sql} | Params: ${JSON.stringify(params)}`));
    const rows = db.query(sql).all(...params) as any[];
    const totalTunggakan = rows
      .filter((r) => r.status === "nunggak")
      .reduce((acc, curr) => acc + curr.nominal, 0);

    return sendJson(res, 200, {
      module: "Tagihan & Pembayaran SPP",
      source: "sqlite://education.db",
      filters_applied: { status, kelas },
      total_tunggakan: totalTunggakan,
      count: rows.length,
      data: rows,
    });
  }

  // 5. Rapot Module (Preview) - Ambil daftar siswa dari SQLite
  if (pathname === "/api/rapot" || pathname === "/rapot") {
    const kelas = qParams.get("kelas") || "8B";
    const semester = qParams.get("semester") || "ganjil";

    const sql = "SELECT id, nama, kelas FROM siswa WHERE LOWER(kelas) = LOWER(?)";
    const students = db.query(sql).all(kelas) as { id: string; nama: string; kelas: string }[];

    console.log(pc.dim(`[SQLITE] ${sql} | Params: [${kelas}]`));

    return sendJson(res, 200, {
      module: "Cetak & Distribusi Rapot",
      source: "sqlite://education.db",
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

    const filename = `Rapor_${nama.replace(/\s+/g, "_")}_Kelas_${kelas}_${semester}.${format}`;

    res.writeHead(200, {
      "Content-Type": format === "pdf" ? "application/pdf" : "text/plain",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Mock-Action": "SUCCESS_DOWNLOAD",
    });

    res.end(
      `[MOCK DOKUMEN RAPOT RESMI DARI DATABASE SQLITE]\nNama Siswa: ${nama}\nKelas: ${kelas}\nSemester: ${semester}\nFormat: ${format.toUpperCase()}\nStatus: Generated by Smart Search Action Engine.\n`
    );
    return;
  }

  // 6. Global Smart Search Gateway (Forwarding ke Service Search Port 4000)
  if (pathname === "/api/search") {
    const query = qParams.get("q");
    const engine = qParams.get("engine") || "auto";

    if (!query) {
      return sendJson(res, 400, { error: "Query parameter 'q' is required." });
    }

    try {
      const searchUrl = new URL(`${SEARCH_SERVICE_URL}/resolve`);
      searchUrl.searchParams.set("q", query);
      searchUrl.searchParams.set("engine", engine);

      const searchRes = await fetch(searchUrl.toString());
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
  console.log(`\n🏫 [App Pendidikan Backend + SQLite] running on http://127.0.0.1:${PORT}`);
  console.log(`📁 Database: education.db (SQLite)`);
  console.log(`📡 Endpoints:`);
  console.log(`   • GET /api/dashboard`);
  console.log(`   • GET /api/siswa?kelas=8B&status=aktif`);
  console.log(`   • GET /api/nilai?kelas=8B&semester=ganjil`);
  console.log(`   • GET /api/spp?status=nunggak&kelas=8B`);
  console.log(`   • GET /api/rapot?kelas=8B&semester=ganjil`);
  console.log(`   • GET /api/rapot/download?kelas=8B&semester=ganjil&format=pdf`);
  console.log(`   • GET /api/search?q=query&engine=auto|jev|laya (Smart Search Gateway)\n`);
});
