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
  db.run(`
    CREATE TABLE IF NOT EXISTS job (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
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
    const insertJob = db.prepare(`
      INSERT INTO job (id, code, name, parent, ordering, display, icon, client_id) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Tenant 1 (Client ID: "1") - Gunakan code lowercase sesuai standar Pintro
    insertJob.run("J01", "dashboard", "Dashboard Utama", null, 1, 1, "layout-dashboard", "1");
    insertJob.run("J02", "siswa", "Master Data Siswa", null, 2, 1, "users", "1");
    insertJob.run("J03", "nilai", "Penilaian Akademik Siswa", null, 3, 1, "award", "1");
    insertJob.run("J04", "spp", "Pembayaran & Tagihan SPP", null, 4, 1, "credit-card", "1");
    insertJob.run("J05", "rapot", "Cetak & Distribusi Rapot", null, 5, 1, "file-text", "1");
    insertJob.run("J06", "kelas", "Master Ruang Kelas", null, 6, 1, "school", "1");

    // Tenant 2 (Client ID: "2") - Menu Santri
    insertJob.run("J01_T2", "dashboard", "Dashboard Sekolah", null, 1, 1, "layout-dashboard", "2");
    insertJob.run("J02_T2", "siswa", "Data Santri", null, 2, 1, "users", "2");
    insertJob.run("J04_T2", "spp", "Kas & Syahriah (SPP)", null, 3, 1, "credit-card", "2");

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

    // Seed Invoices (Tenant 1)
    const insertInvoice = db.prepare(`
      INSERT INTO invoice (id, invoice_no, siswa_id, nama_siswa, kelas_id, bulan, nominal, status, client_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertInvoice.run("INV-2024-10-001", "INV/2024/10/001", "S001", "Budi Santoso", "K-08B", bulanLabel, 500000, "nunggak", "1");
    insertInvoice.run("INV-2024-10-002", "INV/2024/10/002", "S002", "Siti Rahma", "K-08B", bulanLabel, 500000, "lunas", "1");
    insertInvoice.run("INV-2024-10-003", "INV/2024/10/003", "S006", "Farhan Nugraha", "K-08B", bulanLabel, 500000, "nunggak", "1");
    insertInvoice.run("INV-2024-10-004", "INV/2024/10/004", "S005", "Rian Hidayat", "K-09A", bulanLabel, 550000, "nunggak", "1");
    // Tenant 2
    insertInvoice.run("INV-2024-10-005", "INV/2024/10/005", "S008", "Santri Zaid", "K-10A_T2", "Oktober 2024", 750000, "nunggak", "2");

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
      // Tenant 2
      ["S008", "0099999901", "Santri Zaid", "10A", "K-10A_T2", "aktif", "L", "2"],
    ];
    for (const s of siswaList) {
      insertSiswa.run(...s);
    }

    const insertNilai = db.prepare(`
      INSERT INTO nilai (id, siswa_id, nama_siswa, kelas, mapel, semester, nilai_akhir, keterangan, client_id) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const nilaiList = [
      ["N001", "S001", "Budi Santoso", "8B", "Matematika", "ganjil", 88, "Tuntas", "1"],
      ["N002", "S001", "Budi Santoso", "8B", "IPA", "ganjil", 90, "Tuntas", "1"],
      ["N003", "S002", "Siti Rahma", "8B", "Matematika", "ganjil", 92, "Tuntas", "1"],
      ["N004", "S005", "Rian Hidayat", "9A", "Matematika", "ganjil", 74, "Belum Tuntas", "1"],
      ["N005", "S001", "Budi Santoso", "8B", "IPA", "genap", 85, "Tuntas", "1"],
      // Tenant 2
      ["N006", "S008", "Santri Zaid", "10A", "Nahwu", "ganjil", 95, "Mumtaz", "2"],
    ];
    for (const n of nilaiList) {
      insertNilai.run(...n);
    }

    const insertSPP = db.prepare(`
      INSERT INTO spp (id, siswa_id, nama_siswa, kelas, bulan, nominal, status, jatuh_tempo, client_id) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const sppList = [
      ["SPP001", "S001", "Budi Santoso", "8B", bulanLabel, 500000, "nunggak", jatuhTempo, "1"],
      ["SPP002", "S002", "Siti Rahma", "8B", bulanLabel, 500000, "lunas", jatuhTempo, "1"],
      ["SPP003", "S006", "Farhan Nugraha", "8B", bulanLabel, 500000, "nunggak", jatuhTempo, "1"],
      ["SPP004", "S005", "Rian Hidayat", "9A", bulanLabel, 550000, "nunggak", jatuhTempo, "1"],
      ["SPP005", "S003", "Ahmad Dahlan", "7A", bulanLabel, 450000, "lunas", jatuhTempo, "1"],
      // Tenant 2
      ["SPP006", "S008", "Santri Zaid", "10A", bulanLabel, 750000, "nunggak", jatuhTempo, "2"],
    ];
    for (const sp of sppList) {
      insertSPP.run(...sp);
    }
  }
}
