import { Database } from "bun:sqlite";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, "../../education.db");

export const db = new Database(dbPath);

// Inisialisasi skema tabel & seed data awal untuk POC Multi-Tenant (Skema Pintro)
export function initDatabase() {
  db.run("PRAGMA journal_mode = WAL;");

  // 1. PINTRO JOB (Tabel Menu/Fitur)
  // Metadata semantik (description, keywords, dll) ikut di DB — TIDAK ADA hardcode di kode service
  db.run(`
    CREATE TABLE IF NOT EXISTS job (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      keywords TEXT,
      supported_intents TEXT,
      allowed_params TEXT,
      parent TEXT,
      ordering INTEGER NOT NULL DEFAULT 1,
      display INTEGER NOT NULL DEFAULT 1,
      icon TEXT,
      icon_2 TEXT,
      menu_type_id INTEGER DEFAULT 1,
      client_id TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );
  `);

  // 1b. MASTER ACADEMIC YEAR (Tahun Ajaran Aktif per Tenant)
  // Sumber kebenaran kalender akademik — aktif menurut DB, bukan new Date()
  db.run(`
    CREATE TABLE IF NOT EXISTS academic_year (
      id TEXT PRIMARY KEY,            -- e.g. "AY-2026"
      name TEXT NOT NULL,             -- e.g. "2026/2027"
      semester TEXT NOT NULL,         -- "ganjil" | "genap"
      start_date TEXT NOT NULL,       -- e.g. "2026-07-01"
      end_date TEXT NOT NULL,         -- e.g. "2027-06-30"
      is_active INTEGER NOT NULL DEFAULT 0,
      client_id TEXT NOT NULL
    );
  `);

  // 1c. SEARCH ROUTES — 1 Tabel konfigurasi Smart Search Production (dipisah dari tabel job)
  // allowed_params = array of ParamSpec: { key, endpoint?, mode: "list"|"search"|"enum",
  //   query_param?, match_field?, resolves_to?, hint_regex?, values? }
  // Semua konfigurasi lazy-fetch & matching disimpan di DB (zero-hardcode di service-search).
  db.run(`
    CREATE TABLE IF NOT EXISTS search_routes (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      url_path TEXT NOT NULL,
      description TEXT,
      keywords TEXT,
      supported_intents TEXT,
      allowed_params TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      client_id TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );
  `);

  // 1d. MASTER DEPARTMENT (Jurusan) — contoh master list kecil untuk lazy cache
  db.run(`
    CREATE TABLE IF NOT EXISTS master_department (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      client_id TEXT NOT NULL
    );
  `);

  // 1e. MASTER CLASS LEVEL (Tingkat) — contoh master list kecil untuk lazy cache
  db.run(`
    CREATE TABLE IF NOT EXISTS master_class_level (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      client_id TEXT NOT NULL
    );
  `);

  // 1f. MASTER SUBJECT (Mata Pelajaran) — contoh master list kecil untuk lazy cache
  db.run(`
    CREATE TABLE IF NOT EXISTS master_subject (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      client_id TEXT NOT NULL
    );
  `);

  // 2. PINTRO GROUPS (Tabel Role / User Group)
  db.run(`
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      client_id TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );
  `);

  // 3. PINTRO ACL (Access Control List: Relasi Group ke Job)
  db.run(`
    CREATE TABLE IF NOT EXISTS acl (
      id TEXT PRIMARY KEY,
      groups_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      add_priv INTEGER DEFAULT 1,
      edit_priv INTEGER DEFAULT 1,
      remove_priv INTEGER DEFAULT 1,
      delete_priv INTEGER DEFAULT 1,
      client_id TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );
  `);

  // 4. MASTER KELAS (Entity Master Ruang Kelas)
  db.run(`
    CREATE TABLE IF NOT EXISTS master_kelas (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      tingkat TEXT NOT NULL,
      wali_kelas TEXT,
      client_id TEXT NOT NULL
    );
  `);

  // 5. INVOICE / TAGIHAN KEUANGAN
  db.run(`
    CREATE TABLE IF NOT EXISTS invoice (
      id TEXT PRIMARY KEY,
      invoice_no TEXT NOT NULL,
      siswa_id TEXT NOT NULL,
      nama_siswa TEXT NOT NULL,
      kelas_id TEXT NOT NULL,
      academic_year_id TEXT,
      bulan TEXT NOT NULL,
      nominal INTEGER NOT NULL,
      status TEXT NOT NULL,
      client_id TEXT NOT NULL
    );
  `);

  // 6. Data Bisnis Siswa, Nilai, SPP dengan Multi-Tenant client_id
  db.run(`
    CREATE TABLE IF NOT EXISTS siswa (
      id TEXT PRIMARY KEY,
      nisn TEXT NOT NULL,
      nama TEXT NOT NULL,
      kelas TEXT NOT NULL,
      kelas_id TEXT,
      status TEXT NOT NULL,
      gender TEXT NOT NULL,
      client_id TEXT NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS nilai (
      id TEXT PRIMARY KEY,
      siswa_id TEXT NOT NULL,
      nama_siswa TEXT NOT NULL,
      kelas TEXT NOT NULL,
      academic_year_id TEXT,
      mapel TEXT NOT NULL,
      semester TEXT NOT NULL,
      nilai_akhir INTEGER NOT NULL,
      keterangan TEXT NOT NULL,
      client_id TEXT NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS spp (
      id TEXT PRIMARY KEY,
      siswa_id TEXT NOT NULL,
      nama_siswa TEXT NOT NULL,
      kelas TEXT NOT NULL,
      academic_year_id TEXT,
      bulan TEXT NOT NULL,
      nominal INTEGER NOT NULL,
      status TEXT NOT NULL,
      jatuh_tempo TEXT NOT NULL,
      client_id TEXT NOT NULL
    );
  `);

  // Seed Menu/Job jika kosong
  const jobCount = db.query("SELECT COUNT(id) as count FROM job").get() as { count: number };
  if (jobCount.count === 0) {
    // Label bulan berjalan (dinamis, mengikuti kalender saat seeding) agar
    // filter waktu relatif "bulan ini" / "hari ini" di smart search selalu relevan
    const now = new Date();
    const monthName = now.toLocaleString("id-ID", { month: "long" });
    const bulanLabel = `${monthName} ${now.getFullYear()}`;
    const jatuhTempo = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-10`;
    // Semester aktif menurut kalender saat seeding: TA baru dimulai Juli (bulan 7)
    const isGanjil = now.getMonth() + 1 >= 7;
    const insertJob = db.prepare(`
      INSERT INTO job (id, code, name, description, keywords, supported_intents, allowed_params, parent, ordering, display, icon, client_id) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Tenant 1 (Client ID: "1") - Gunakan code lowercase sesuai standar Pintro
    // description/keywords/supported_intents/allowed_params diambil dari DB (JSON TEXT)
    insertJob.run("J01", "dashboard", "Dashboard Utama", "Statistik umum sekolah: total siswa, siswa aktif, dan ringkasan pembayaran", JSON.stringify(["home", "beranda", "dashboard", "utama", "statistik"]), JSON.stringify(["LIST_MENU"]), JSON.stringify([]), null, 1, 1, "layout-dashboard", "1");
    insertJob.run("J02", "siswa", "Master Data Siswa", "Daftar dan profil data siswa, murid, dan santri dengan filter kelas dan status", JSON.stringify(["siswa", "murid", "santri", "pelajar", "data siswa", "profil"]), JSON.stringify(["LIST_MENU", "DIRECT_LINK"]), JSON.stringify(["kelas", "status", "academic_year_id", "q"]), null, 2, 1, "users", "1");
    insertJob.run("J03", "nilai", "Penilaian Akademik Siswa", "Buku nilai siswa, rekap nilai harian, dan nilai per mata pelajaran", JSON.stringify(["nilai", "akademik", "skor", "ulangan", "rapor", "mata pelajaran", "mapel"]), JSON.stringify(["LIST_MENU", "DIRECT_LINK"]), JSON.stringify(["kelas", "semester", "mapel", "academic_year_id"]), null, 3, 1, "award", "1");
    insertJob.run("J04", "spp", "Pembayaran & Tagihan SPP", "Kelola tagihan SPP, list siswa nunggak, pembayaran uang sekolah, kas keuangan, dan iuran", JSON.stringify(["spp", "bayar", "tagihan", "nunggak", "keuangan", "iuran", "tunggakan", "syahriah", "invoice"]), JSON.stringify(["LIST_MENU", "DIRECT_LINK"]), JSON.stringify(["kelas", "status", "created_at", "periode", "academic_year_id", "invoice_id"]), null, 4, 1, "credit-card", "1");
    insertJob.run("J05", "rapot", "Cetak & Distribusi Rapot", "Aksi cetak dan unduh dokumen rapor siswa format PDF atau Excel", JSON.stringify(["rapot", "rapor", "cetak", "unduh", "download", "pdf", "leger"]), JSON.stringify(["LIST_MENU", "REPORT_ACTION"]), JSON.stringify(["kelas", "semester", "format", "nama"]), null, 5, 1, "file-text", "1");
    insertJob.run("J06", "kelas", "Master Ruang Kelas", "Data ruang kelas, rombel, dan wali kelas per tingkat", JSON.stringify(["kelas", "ruang kelas", "rombel", "wali kelas", "tingkat"]), JSON.stringify(["LIST_MENU", "DIRECT_LINK"]), JSON.stringify(["id", "tingkat"]), null, 6, 1, "school", "1");

    // Tenant 2 (Client ID: "2") - Menu Santri
    insertJob.run("J01_T2", "dashboard", "Dashboard Sekolah", "Statistik umum sekolah santri", JSON.stringify(["home", "beranda", "dashboard", "utama", "statistik"]), JSON.stringify(["LIST_MENU"]), JSON.stringify([]), null, 1, 1, "layout-dashboard", "2");
    insertJob.run("J02_T2", "siswa", "Data Santri", "Daftar dan profil data santri dengan filter kelas dan status", JSON.stringify(["siswa", "murid", "santri", "pelajar", "data santri"]), JSON.stringify(["LIST_MENU", "DIRECT_LINK"]), JSON.stringify(["kelas", "status", "q"]), null, 2, 1, "users", "2");
    insertJob.run("J04_T2", "spp", "Kas & Syahriah (SPP)", "Kelola kas dan iuran syahriah santri, list santri nunggak", JSON.stringify(["spp", "bayar", "tagihan", "nunggak", "keuangan", "iuran", "syahriah", "kas"]), JSON.stringify(["LIST_MENU", "DIRECT_LINK"]), JSON.stringify(["kelas", "status", "created_at", "periode", "academic_year_id"]), null, 3, 1, "credit-card", "2");

    // Seed Groups (Role)
    const insertGroup = db.prepare(`
      INSERT INTO groups (id, code, name, client_id) VALUES (?, ?, ?, ?)
    `);
    // Tenant 1
    insertGroup.run("G01", "SUPERADMIN", "Super Admin Sekolah", "1");
    insertGroup.run("G02", "GURU", "Dewan Guru / Pengajar", "1");
    insertGroup.run("G03", "KEUANGAN", "Bagian Tata Usaha & Keuangan", "1");
    insertGroup.run("G04", "SISWA", "Wali Murid & Siswa", "1");

    // Tenant 2
    insertGroup.run("G01_T2", "ADMIN", "Administrator", "2");
    insertGroup.run("G02_T2", "GURU", "Ustadz / Pengajar", "2");

    // Seed ACL (Izin Akses Role ke Menu)
    const insertAcl = db.prepare(`
      INSERT INTO acl (id, groups_id, job_id, add_priv, edit_priv, remove_priv, delete_priv, client_id)
      VALUES (?, ?, ?, 1, 1, 1, 1, ?)
    `);

    // SUPERADMIN Tenant 1: Akses Semua (J01 s/d J06)
    insertAcl.run("ACL01", "G01", "J01", "1");
    insertAcl.run("ACL02", "G01", "J02", "1");
    insertAcl.run("ACL03", "G01", "J03", "1");
    insertAcl.run("ACL04", "G01", "J04", "1");
    insertAcl.run("ACL05", "G01", "J05", "1");
    insertAcl.run("ACL06", "G01", "J06", "1");

    // GURU Tenant 1: Dashboard, Siswa, Nilai, Rapot, Kelas (TIDAK BISA SPP!)
    insertAcl.run("ACL07", "G02", "J01", "1");
    insertAcl.run("ACL08", "G02", "J02", "1");
    insertAcl.run("ACL09", "G02", "J03", "1");
    insertAcl.run("ACL10", "G02", "J05", "1");
    insertAcl.run("ACL11", "G02", "J06", "1");

    // KEUANGAN Tenant 1: Dashboard, Siswa, SPP, Kelas (TIDAK BISA NILAI & RAPOT!)
    insertAcl.run("ACL12", "G03", "J01", "1");
    insertAcl.run("ACL13", "G03", "J02", "1");
    insertAcl.run("ACL14", "G03", "J04", "1");
    insertAcl.run("ACL15", "G03", "J06", "1");

    // SISWA Tenant 1: Dashboard & Rapot
    insertAcl.run("ACL16", "G04", "J01", "1");
    insertAcl.run("ACL17", "G04", "J05", "1");

    // Seed Master Kelas (Tenant 1)
    const insertKelas = db.prepare(`
      INSERT INTO master_kelas (id, code, name, tingkat, wali_kelas, client_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertKelas.run("K-07A", "7a", "Kelas 7A", "7", "Siti Aminah, S.Pd", "1");
    insertKelas.run("K-07C", "7c", "Kelas 7C", "7", "Bambang Susanto, S.Pd", "1");
    insertKelas.run("K-08B", "8b", "Kelas 8B", "8", "Ahmad Fauzi, M.Pd", "1");
    insertKelas.run("K-09A", "9a", "Kelas 9A", "9", "Nurul Hidayati, S.Si", "1");
    // Tenant 2
    insertKelas.run("K-10A_T2", "10a", "Kelas 10A Ula", "10", "Ustadz Abdullah", "2");

    // Seed Academic Year (1 tahun ajaran AKTIF per tenant, dari kalender saat seeding)
    const insertAY = db.prepare(`
      INSERT INTO academic_year (id, name, semester, start_date, end_date, is_active, client_id)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `);
    if (isGanjil) {
      insertAY.run("AY-2026", "2026/2027", "ganjil", "2026-07-01", "2027-06-30", "1");
      insertAY.run("AY-2025", "2025/2026", "genap", "2025-07-01", "2026-06-30", "1");
    } else {
      insertAY.run("AY-2025", "2025/2026", "genap", "2025-07-01", "2026-06-30", "1");
    }
    const activeAYId = "AY-" + (isGanjil ? "2026" : "2025");

    // Seed Invoices (Tenant 1)
    const insertInvoice = db.prepare(`
      INSERT INTO invoice (id, invoice_no, siswa_id, nama_siswa, kelas_id, academic_year_id, bulan, nominal, status, client_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertInvoice.run("INV-2024-10-001", "INV/2024/10/001", "S001", "Budi Santoso", "K-08B", activeAYId, bulanLabel, 500000, "nunggak", "1");
    insertInvoice.run("INV-2024-10-002", "INV/2024/10/002", "S002", "Siti Rahma", "K-08B", activeAYId, bulanLabel, 500000, "lunas", "1");
    insertInvoice.run("INV-2024-10-003", "INV/2024/10/003", "S006", "Farhan Nugraha", "K-08B", activeAYId, bulanLabel, 500000, "nunggak", "1");
    insertInvoice.run("INV-2024-10-004", "INV/2024/10/004", "S005", "Rian Hidayat", "K-09A", activeAYId, bulanLabel, 550000, "nunggak", "1");
    // Tenant 2
    insertInvoice.run("INV-2024-10-005", "INV/2024/10/005", "S008", "Santri Zaid", "K-10A_T2", "AY-2026", bulanLabel, 750000, "nunggak", "2");

    // Seed Siswa untuk Tenant 1
    const insertSiswa = db.prepare(`
      INSERT INTO siswa (id, nisn, nama, kelas, kelas_id, status, gender, client_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const siswaList = [
      ["S001", "0081234561", "Budi Santoso", "8B", "K-08B", "aktif", "L", "1"],
      ["S002", "0081234562", "Siti Rahma", "8B", "K-08B", "aktif", "P", "1"],
      ["S003", "0081234563", "Ahmad Dahlan", "7A", "K-07A", "aktif", "L", "1"],
      ["S004", "0081234564", "Dewi Sartika", "7C", "K-07C", "aktif", "P", "1"],
      ["S005", "0081234565", "Rian Hidayat", "9A", "K-09A", "aktif", "L", "1"],
      ["S006", "0081234566", "Farhan Nugraha", "8B", "K-08B", "aktif", "L", "1"],
      ["S007", "0081234567", "Putri Anggraini", "8B", "K-08B", "pindah", "P", "1"],
      // Siswa "Siti" ke-2 — kasus multi-entity disambiguation (Siti Rahma 8B vs Siti Aisyah 7A)
      ["S009", "0081234569", "Siti Aisyah", "7A", "K-07A", "aktif", "P", "1"],
      // Tenant 2
      ["S008", "0099999901", "Santri Zaid", "10A", "K-10A_T2", "aktif", "L", "2"],
    ];
    for (const s of siswaList) {
      insertSiswa.run(...s);
    }

    const insertNilai = db.prepare(`
      INSERT INTO nilai (id, siswa_id, nama_siswa, kelas, academic_year_id, mapel, semester, nilai_akhir, keterangan, client_id) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const nilaiList = [
      ["N001", "S001", "Budi Santoso", "8B", activeAYId, "Matematika", "ganjil", 88, "Tuntas", "1"],
      ["N002", "S001", "Budi Santoso", "8B", activeAYId, "IPA", "ganjil", 90, "Tuntas", "1"],
      ["N003", "S002", "Siti Rahma", "8B", activeAYId, "Matematika", "ganjil", 92, "Tuntas", "1"],
      ["N004", "S005", "Rian Hidayat", "9A", activeAYId, "Matematika", "ganjil", 74, "Belum Tuntas", "1"],
      ["N005", "S001", "Budi Santoso", "8B", activeAYId, "IPA", "genap", 85, "Tuntas", "1"],
      // Tenant 2
      ["N006", "S008", "Santri Zaid", "10A", "AY-2026", "Nahwu", "ganjil", 95, "Mumtaz", "2"],
    ];
    for (const n of nilaiList) {
      insertNilai.run(...n);
    }

    const insertSPP = db.prepare(`
      INSERT INTO spp (id, siswa_id, nama_siswa, kelas, academic_year_id, bulan, nominal, status, jatuh_tempo, client_id) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const sppList = [
      ["SPP001", "S001", "Budi Santoso", "8B", activeAYId, bulanLabel, 500000, "nunggak", jatuhTempo, "1"],
      ["SPP002", "S002", "Siti Rahma", "8B", activeAYId, bulanLabel, 500000, "lunas", jatuhTempo, "1"],
      ["SPP003", "S006", "Farhan Nugraha", "8B", activeAYId, bulanLabel, 500000, "nunggak", jatuhTempo, "1"],
      ["SPP004", "S005", "Rian Hidayat", "9A", activeAYId, bulanLabel, 550000, "nunggak", jatuhTempo, "1"],
      ["SPP005", "S003", "Ahmad Dahlan", "7A", activeAYId, bulanLabel, 450000, "lunas", jatuhTempo, "1"],
      // Tenant 2
      ["SPP006", "S008", "Santri Zaid", "10A", "AY-2026", bulanLabel, 750000, "nunggak", jatuhTempo, "2"],
    ];
    for (const sp of sppList) {
      insertSPP.run(...sp);
    }
  }

  // Seed Master Department / Class Level / Subject (master list kecil utk lazy cache)
  const deptCount = db.query("SELECT COUNT(id) as count FROM master_department").get() as { count: number };
  if (deptCount.count === 0) {
    const insertDept = db.prepare("INSERT INTO master_department (id, name, client_id) VALUES (?, ?, ?)");
    insertDept.run("DEPT-IPA", "IPA", "1");
    insertDept.run("DEPT-IPS", "IPS", "1");
    insertDept.run("DEPT-UMUM", "Umum", "1");

    const insertLvl = db.prepare("INSERT INTO master_class_level (id, name, client_id) VALUES (?, ?, ?)");
    insertLvl.run("LVL-7", "7", "1");
    insertLvl.run("LVL-8", "8", "1");
    insertLvl.run("LVL-9", "9", "1");

    const insertSub = db.prepare("INSERT INTO master_subject (id, name, client_id) VALUES (?, ?, ?)");
    insertSub.run("SUB-01", "Matematika", "1");
    insertSub.run("SUB-02", "Ilmu Pengetahuan Alam (Sains)", "1");
    insertSub.run("SUB-03", "Bahasa Indonesia", "1");
    insertSub.run("SUB-04", "Bahasa Inggris", "1");
  }

  // Ensure ACL Tenant 2 (ADMIN -> semua job T2; GURU T2 -> tanpa SPP) — idempotent
  const aclT2Count = db.query("SELECT COUNT(id) as count FROM acl WHERE client_id = '2'").get() as { count: number };
  if (aclT2Count.count === 0) {
    const insAclT2 = db.prepare("INSERT OR IGNORE INTO acl (id, groups_id, job_id, add_priv, edit_priv, remove_priv, delete_priv, client_id) VALUES (?, ?, ?, 1,1,1,1, '2')");
    insAclT2.run("ACL20", "G01_T2", "J01_T2");
    insAclT2.run("ACL21", "G01_T2", "J02_T2");
    insAclT2.run("ACL22", "G01_T2", "J04_T2");
    insAclT2.run("ACL23", "G02_T2", "J01_T2");
    insAclT2.run("ACL24", "G02_T2", "J02_T2");
  }

  // Ensure demo multi-"Siti" tersedia (idempotent — untuk kasus multi-entity disambiguation)
  const sitiCount = db.query("SELECT COUNT(id) as count FROM siswa WHERE LOWER(nama) LIKE 'siti%'").get() as { count: number };
  if (sitiCount.count < 2) {
    db.query("INSERT OR IGNORE INTO siswa (id, nisn, nama, kelas, kelas_id, status, gender, client_id) VALUES ('S009', '0081234569', 'Siti Aisyah', '7A', 'K-07A', 'aktif', 'P', '1')").run();
  }

  // Ensure tagihan SPP dengan jatuh_tempo dalam 7 hari terakhir (idempotent — untuk demo filter "minggu ini")
  const activeAY = db.query("SELECT id FROM academic_year WHERE is_active = 1 AND client_id = '1'").get() as { id: string } | null;
  if (activeAY) {
    const insertRecentSPP = db.prepare(`
      INSERT OR IGNORE INTO spp (id, siswa_id, nama_siswa, kelas, academic_year_id, bulan, nominal, status, jatuh_tempo, client_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '1')
    `);
    const recentSpp: [string, string, string, string, number, string, number][] = [
      ["SPP007", "S001", "Budi Santoso", "8B", 500000, "nunggak", 3],
      ["SPP008", "S006", "Farhan Nugraha", "8B", 500000, "nunggak", 5],
      ["SPP009", "S002", "Siti Rahma", "8B", 500000, "lunas", 2],
    ];
    for (const [id, siswaId, nama, kelas, nominal, status, daysAgo] of recentSpp) {
      const d = new Date();
      d.setDate(d.getDate() - daysAgo);
      const jatuhTempoRecent = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const bulan = `${d.toLocaleString("id-ID", { month: "long" })} ${d.getFullYear()}`;
      insertRecentSPP.run(id, siswaId, nama, kelas, activeAY.id, bulan, nominal, status, jatuhTempoRecent);
    }
  }

  // Shared param configs (mengurangi duplikasi JSON antar route)
  const academicYearParam = {
    key: "academic_year_id",
    endpoint: "/api/master/academic-years",
    mode: "list",
    hint_regex: "(tahun|th(a)?n\\??)\\s*(ajaran|pelajaran|ajar)?\\s*(ini|sekarang|saat\\s*ini|aktif)|[0-9]{4}/[0-9]{4}",
  };
  const kelasParam = {
    key: "kelas_id",
    endpoint: "/api/master/kelas",
    mode: "list",
  };
  // wali_kelas dilewati bila ada kata penunjuk siswa ("anak/siswa/student/...") dan tidak ada
  // kata penunjuk wali ("wali/guru/ibu/bapak"); selain itu aktif untuk kata berhuruf >= 4
  const waliKelasHint =
    "^(?!(?=.*\\b(siswa|anak|murid|student|santri)\\b)(?!.*\\b(wali|guru|ibu|bapak)\\b))(?:.*\\b(wali|guru|ibu|bapak|bu\\s|pak\\s)\\b|.*[a-z]{4,})";
  const nilaiSiswaParam = { key: "siswa_id", endpoint: "/api/siswa", mode: "search", query_param: "q" };
  const statusSppParam = {
    key: "status",
    hint_regex: "\\b(status|lunas|nunggak|bayar|tunggakan|hutang|setor|nyetor|duit|uang|manarin|piring)\\b",
    mode: "enum",
    values: {
      nunggak: "\\b(nunggak|belum\\s*(bayar|lunas|setor|nyetor)|tertunggak|terlambat\\s*bayar|masih\\s*hutang|manarin)\\b|\\bpiring\\b",
      lunas: "\\b(lunas|(sudah|udah)\\s*(bayar|lunas|setor|nyetor|kasih\\s*(duit|uang))|pembayaran\\s*selesai|bebas\\s*tunggakan)\\b",
    },
  };
  const createdAtParam = {
    key: "created_at",
    mode: "date_range",
    param_gte: "created_at.$gte",
    param_lte: "created_at.$lte",
    // Gate semantik: enum date_range hanya aktif bila kalimat memuat kata waktu
    hint_regex: "\\b(hari|minggu|bulan|tahun|semester|kemarin|lalu|sekarang|berjalan|this\\s*(week|month|year))\\b",
    values: {
      hari_ini: "\\b(hari\\s*ini)\\b",
      minggu_ini: "\\b(minggu\\s*(ini|berjalan|sekarang)|7\\s*hari\\s*(terakhir|ini))\\b",
      bulan_ini: "\\b(bulan\\s*(ini|berjalan|sekarang)|this\\s*month)\\b",
      bulan_lalu: "\\b(bulan\\s*(lalu|kemarin|sebelumnya)|bulan\\s*yang\\s*lalu)\\b",
      tahun_ini: "\\b(tahun\\s*(ini|sekarang))\\b",
      tahun_lalu: "\\b(tahun\\s*(lalu|kemarin|sebelumnya)|tahun\\s*yang\\s*lalu)\\b",
    },
  };
  const periodeParam = {
    ...createdAtParam,
    key: "periode",
  };
  const semesterParam = {
    key: "semester",
    hint_regex: "\\b(semester|sem|ganjil|genap|gasal)\\b",
    mode: "enum",
    values: {
      ganjil: "\\b(ganjil|semester\\s*1|sem\\s*1)\\b",
      genap: "\\b(genap|semester\\s*2|sem\\s*2)\\b",
    },
  };

  // Seed Search Routes (konfigurasi Smart Search production) jika kosong
  const routeCount = db.query("SELECT COUNT(id) as count FROM search_routes").get() as { count: number };

  // Migration idempotent: kisahkan enum anchors baru (minggu/bulan lalu/tahun lalu/colloquial)
  // ke existing rows tanpa meng-me-reset seluruh route config. Sebagai rule untuk DB lama.
  const DEFAULT_ENUM_VALUES: Record<string, Record<string, string>> = {
    status: statusSppParam.values,
    periode: periodeParam.values,
    semester: {
      ganjil: "\\b(ganjil|semester\\s*1|sem\\s*1)\\b",
      genap: "\\b(genap|semester\\s*2|sem\\s*2)\\b",
    },
  };
  const enumRows = db.query("SELECT id, code, allowed_params FROM search_routes").all() as any[];
  for (const row of enumRows) {
    const specs: any[] = JSON.parse(row.allowed_params || "[]");
    let changed = false;
    // DB lama: route nilai belum bisa meresolve nama siswa
    if (row.code === "nilai" && !specs.some((s) => s.key === "siswa_id")) {
      specs.unshift(nilaiSiswaParam);
      changed = true;
    }
    for (const spec of specs) {
      // DB lama: kelas/mapel tidak lagi digerbang hint_regex (master list kecil & ter-cache,
      // nama kelas/mapel dinamis tidak selalu memuat kata "kelas"/"nilai")
      if ((spec.mode ?? "list") === "list" && (spec.key === "kelas_id" || spec.key === "subject_id") && spec.hint_regex) {
        delete spec.hint_regex;
        changed = true;
      }
      // DB lama: kata "rola" (typo seed tenant 2) tidak boleh jadi pemicu siswa_id
      if (spec.key === "siswa_id" && spec.hint_regex?.includes("|\\brola\\b")) {
        spec.hint_regex = spec.hint_regex.replace("|\\brola\\b", "");
        changed = true;
      }
      // DB lama: samakan hint_regex wali_kelas dengan konstanta kode
      if (spec.key === "wali_kelas" && spec.hint_regex !== waliKelasHint) {
        spec.hint_regex = waliKelasHint;
        changed = true;
      }
      const defaults = DEFAULT_ENUM_VALUES[spec.key];
      if ((spec.mode ?? "") === "enum" && defaults) {
        if (spec.key === "periode" && !spec.hint_regex) {
          spec.hint_regex = periodeParam.hint_regex;
          changed = true;
        }
        if (spec.key === "status" && !spec.hint_regex) {
          spec.hint_regex = statusSppParam.hint_regex;
          changed = true;
        }
        if (spec.key === "semester" && !spec.hint_regex) {
          spec.hint_regex = semesterParam.hint_regex;
          changed = true;
        }
        for (const [vk, rx] of Object.entries(defaults)) {
          // Upgrade: key baru ditambahkan; key existing di-upgrade ke anchor default
          // (DB code-managed: constants ini adalah source of truth enum anchors)
          if (spec.values[vk] !== rx) {
            spec.values[vk] = rx as string;
            changed = true;
          }
        }
      }
    }
    if (changed) {
      db.query("UPDATE search_routes SET allowed_params = ? WHERE id = ?").run(JSON.stringify(specs), row.id);
    }
  }

  // Teacher master (test data for name-collision cases). Idempotent: safe on existing DBs.
  db.run(`
    CREATE TABLE IF NOT EXISTS guru (
      id TEXT PRIMARY KEY,
      nama TEXT NOT NULL,
      mapel TEXT,
      wali_kelas_id TEXT,
      client_id TEXT NOT NULL
    );
  `);
  const insertGuru = db.prepare(`
    INSERT OR IGNORE INTO guru (id, nama, mapel, wali_kelas_id, client_id) VALUES (?, ?, ?, ?, ?)
  `);
  const guruList = [
    // Homeroom teachers match master_kelas.wali_kelas
    ["G-001", "Siti Aminah, S.Pd", "Bahasa Indonesia", "K-07A", "1"],
    ["G-002", "Bambang Susanto, S.Pd", "IPS", "K-07C", "1"],
    ["G-003", "Ahmad Fauzi, M.Pd", "Matematika", "K-08B", "1"],
    ["G-004", "Nurul Hidayati, S.Si", "Ilmu Pengetahuan Alam", "K-09A", "1"],
    // Subject teachers without a class; "Siti" collides with student and homeroom names
    ["G-005", "Siti Nurhaliza, S.Pd", "Bahasa Inggris", null, "1"],
    ["G-006", "Rina Wulandari, S.Pd", "Matematika", null, "1"],
    // Tenant 2
    ["G-101", "Ustadz Abdullah", "Nahwu", "K-10A_T2", "2"],
    ["G-102", "Ustadz Yusuf", "Sharaf", null, "2"],
  ];
  for (const g of guruList) insertGuru.run(...g);

  // Guru job + route + ACL (idempotent; INSERT OR IGNORE keeps existing rows untouched)
  const guruKeywords = JSON.stringify(["guru", "pengajar", "ustadz", "dewan guru", "mengajar", "wali kelas"]);
  const guruParams = JSON.stringify([
    { key: "guru_id", endpoint: "/api/guru", mode: "search", query_param: "q" },
  ]);
  const guruDesc = "Data guru dan pengajar: nama, mata pelajaran yang diampu, dan kelas yang diwalikan";
  const guruIntents = JSON.stringify(["LIST_MENU", "DIRECT_LINK"]);
  const insGuruJob = db.prepare(`
    INSERT OR IGNORE INTO job (id, code, name, description, keywords, supported_intents, allowed_params, parent, ordering, display, icon, client_id)
    VALUES (?, 'guru', ?, ?, ?, ?, ?, NULL, 7, 1, 'user-check', ?)
  `);
  const insGuruRoute = db.prepare(`
    INSERT OR IGNORE INTO search_routes (id, job_id, code, title, url_path, description, keywords, supported_intents, allowed_params, is_active, client_id)
    VALUES (?, ?, 'guru', ?, '/guru', ?, ?, ?, ?, 1, ?)
  `);
  const insGuruAcl = db.prepare(`
    INSERT OR IGNORE INTO acl (id, groups_id, job_id, add_priv, edit_priv, remove_priv, delete_priv, client_id)
    VALUES (?, ?, ?, 1, 1, 1, 1, ?)
  `);
  insGuruJob.run("J07", "Master Data Guru", guruDesc, guruKeywords, guruIntents, guruParams, "1");
  insGuruRoute.run("SR-07", "J07", "Master Data Guru", guruDesc, guruKeywords, guruIntents, guruParams, "1");
  insGuruAcl.run("ACL30", "G01", "J07", "1"); // SUPERADMIN
  insGuruAcl.run("ACL31", "G02", "J07", "1"); // GURU
  insGuruAcl.run("ACL32", "G03", "J07", "1"); // KEUANGAN
  insGuruJob.run("J07_T2", "Data Ustadz", guruDesc, guruKeywords, guruIntents, guruParams, "2");
  insGuruRoute.run("SR-07_T2", "J07_T2", "Data Ustadz", guruDesc, guruKeywords, guruIntents, guruParams, "2");
  insGuruAcl.run("ACL33", "G01_T2", "J07_T2", "2");
  insGuruAcl.run("ACL34", "G02_T2", "J07_T2", "2");

  if (routeCount.count === 0) {
    const insertRoute = db.prepare(`
      INSERT INTO search_routes (id, job_id, code, title, url_path, description, keywords, supported_intents, allowed_params, is_active, client_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);


    // ---- Tenant 1 ----
    insertRoute.run("SR-01", "J01", "dashboard", "Dashboard Utama", "/dashboard",
      "Statistik umum sekolah: total siswa, siswa aktif, dan ringkasan pembayaran",
      JSON.stringify(["home", "beranda", "dashboard", "utama", "statistik"]),
      JSON.stringify(["LIST_MENU"]), JSON.stringify([]), "1");

    insertRoute.run("SR-02", "J02", "siswa", "Master Data Siswa", "/ng_student",
      "Daftar dan profil data siswa, murid, dan santri dengan filter kelas dan status",
      JSON.stringify(["siswa", "murid", "santri", "pelajar", "data siswa", "profil"]),
      JSON.stringify(["LIST_MENU", "DIRECT_LINK"]), JSON.stringify([
        { key: "filter[name]", endpoint: "/api/smart-search/siswa", mode: "search", query_param: "q" },
        { key: "filter[ng_class_level_id]", endpoint: "/api/smart-search/kelas", mode: "list" },
        { key: "filter[status]", mode: "enum", values: { "1": "\\b(aktif|masih\\s*belajar)\\b", "0": "\\b(pindah|tidak\\s*aktif)\\b", "2": "\\b(lulus|alumni)\\b", "3": "\\b(cuti|ditangguhkan)\\b" } },
      ]), "1");

    insertRoute.run("SR-03", "J03", "nilai", "Penilaian Akademik Siswa", "/nilai",
      "Buku nilai siswa, rekap nilai harian, dan nilai per mata pelajaran",
      JSON.stringify(["nilai", "akademik", "skor", "ulangan", "rapor nilai"]),
      JSON.stringify(["LIST_MENU", "DIRECT_LINK"]), JSON.stringify([
        nilaiSiswaParam,
        { key: "subject_id", endpoint: "/api/master/subjects", mode: "list" },
        kelasParam,
        semesterParam,
        academicYearParam,
      ]), "1");

    insertRoute.run("SR-04", "J04", "spp", "Pembayaran & Tagihan SPP", "/ng_account_invoice_student",
      "Kelola tagihan SPP, list siswa nunggak, pembayaran uang sekolah, kas keuangan, dan iuran",
      JSON.stringify(["spp", "bayar", "tagihan", "nunggak", "keuangan", "iuran", "tunggakan", "syahriah"]),
      JSON.stringify(["LIST_MENU", "DIRECT_LINK"]), JSON.stringify([
        { key: "filter[name]", endpoint: "/api/smart-search/siswa", mode: "search", query_param: "q" },
        { key: "filter[ng_class_level_id]", endpoint: "/api/smart-search/kelas", mode: "list" },
        { key: "filter[status]", mode: "enum", values: { "0": "\\b(nunggak|belum\\s*(bayar|lunas)|tunggakan)\\b", "1": "\\b(lunas|sudah\\s*bayar)\\b" } },
        { key: "filter[year]", endpoint: "/api/smart-search/academic-years", mode: "list", hint_regex: "tahun\\s*(ajaran|pelajaran)?\\s*(ini|sekarang|saat\\s*ini|aktif)|[0-9]{4}/[0-9]{4}" },
      ]), "1");

    insertRoute.run("SR-05", "J05", "rapot", "Cetak & Distribusi Rapot", "/rapot",
      "Aksi cetak dan unduh dokumen rapor siswa format PDF atau Excel",
      JSON.stringify(["rapot", "rapor", "cetak", "unduh", "download", "pdf", "leger"]),
      JSON.stringify(["LIST_MENU", "REPORT_ACTION"]), JSON.stringify([
        kelasParam,
        semesterParam,
        { key: "format", mode: "enum", values: { pdf: "\\bpdf\\b", excel: "\\b(excel|xlsx|csv)\\b", print: "\\b(cetak|print)\\b" } },
      ]), "1");

    insertRoute.run("SR-06", "J06", "kelas", "Master Ruang Kelas", "/kelas",
      "Data ruang kelas, rombel, wali kelas, dan pencarian kelas dari nama siswa (mis: siti ada di kelas berapa)",
      JSON.stringify(["kelas", "ruang kelas", "rombel", "wali kelas", "tingkat"]),
      JSON.stringify(["LIST_MENU", "DIRECT_LINK"]), JSON.stringify([
        // Bridge param: cari nama siswa via /api/siswa, hasil siswa menyebut kelasnya (kelas_id)
        { key: "siswa_id", endpoint: "/api/siswa", mode: "search", query_param: "q", resolves_to: "kelas_id" },
        // List param: cek wali_kelas di master kelas via match_field
        { key: "wali_kelas", endpoint: "/api/master/kelas", mode: "list", match_field: "wali_kelas", resolves_to: "kelas_id", hint_regex: waliKelasHint },
        // List param: cocokkan nama/kode kelas langsung
        kelasParam,
      ]), "1");

    // ---- Tenant 2 ----
    insertRoute.run("SR-01_T2", "J01_T2", "dashboard", "Dashboard Sekolah", "/dashboard",
      "Statistik umum sekolah santri",
      JSON.stringify(["home", "beranda", "dashboard", "utama", "statistik"]),
      JSON.stringify(["LIST_MENU"]), JSON.stringify([]), "2");

    insertRoute.run("SR-02_T2", "J02_T2", "siswa", "Data Santri", "/siswa",
      "Daftar dan profil data santri dengan filter kelas dan status",
      JSON.stringify(["siswa", "murid", "santri", "pelajar", "data santri"]),
      JSON.stringify(["LIST_MENU", "DIRECT_LINK"]), JSON.stringify([
        { key: "siswa_id", endpoint: "/api/siswa", mode: "search", query_param: "q" },
        { key: "kelas_id", endpoint: "/api/master/kelas", mode: "list" },
        { key: "status", mode: "enum", values: { aktif: "\\b(aktif|masih\\s*belajar)\\b", pindah: "\\b(pindah|pindahan)\\b" } },
      ]), "2");

    insertRoute.run("SR-04_T2", "J04_T2", "spp", "Kas & Syahriah (SPP)", "/spp",
      "Kelola kas dan iuran syahriah santri, list santri nunggak",
      JSON.stringify(["spp", "bayar", "tagihan", "nunggak", "keuangan", "iuran", "syahriah", "kas"]),
      JSON.stringify(["LIST_MENU", "DIRECT_LINK"]), JSON.stringify([
        { key: "siswa_id", endpoint: "/api/siswa", mode: "search", query_param: "q", hint_regex: "\\b(siapa|santri|murid|anak)\\b|\\bbu\\b|\\bpak\\b|\\bibu\\b|\\bbapak\\b|\\b(wali|guru)\\b" },
        { key: "kelas_id", endpoint: "/api/master/kelas", mode: "list" },
        statusSppParam,
        createdAtParam,
        academicYearParam,
      ]), "2");
  }
}

// Baca seluruh search_routes ACL-filtered untuk tenant & role (dipakai GET /api/routes di server.ts)
export function getSearchRoutes(clientId: string, role: string) {
  const sql = `
    SELECT sr.id, sr.job_id, sr.code, sr.title, sr.url_path, sr.description,
           sr.keywords, sr.supported_intents, sr.allowed_params, sr.is_active, sr.client_id
    FROM search_routes sr
    JOIN acl a ON a.job_id = sr.job_id AND a.client_id = sr.client_id
    JOIN groups g ON g.id = a.groups_id AND g.client_id = sr.client_id
    WHERE sr.client_id = ?
      AND UPPER(g.code) = ?
      AND sr.is_active = 1
      AND sr.deleted_at IS NULL
      AND a.deleted_at IS NULL
    ORDER BY sr.id ASC
  `;
  return db.query(sql).all(clientId, role.toUpperCase());
}
