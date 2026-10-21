import { Database } from "bun:sqlite";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, "../../education.db");

export const db = new Database(dbPath);

// Inisialisasi skema tabel & seed data awal untuk POC
export function initDatabase() {
  db.run("PRAGMA journal_mode = WAL;");

  db.run(`
    CREATE TABLE IF NOT EXISTS siswa (
      id TEXT PRIMARY KEY,
      nisn TEXT NOT NULL,
      nama TEXT NOT NULL,
      kelas TEXT NOT NULL,
      status TEXT NOT NULL,
      gender TEXT NOT NULL
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
      keterangan TEXT NOT NULL
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
      jatuh_tempo TEXT NOT NULL
    );
  `);

  // Seed jika tabel siswa masih kosong
  const countRow = db.query("SELECT COUNT(*) as count FROM siswa").get() as { count: number };
  if (countRow.count === 0) {
    const insertSiswa = db.prepare(
      "INSERT INTO siswa (id, nisn, nama, kelas, status, gender) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const siswaList = [
      ["S001", "0081234561", "Budi Santoso", "8B", "aktif", "L"],
      ["S002", "0081234562", "Siti Rahma", "8B", "aktif", "P"],
      ["S003", "0081234563", "Ahmad Dahlan", "7A", "aktif", "L"],
      ["S004", "0081234564", "Dewi Sartika", "7C", "aktif", "P"],
      ["S005", "0081234565", "Rian Hidayat", "9A", "aktif", "L"],
      ["S006", "0081234566", "Farhan Nugraha", "8B", "aktif", "L"],
      ["S007", "0081234567", "Putri Anggraini", "8B", "pindah", "P"],
    ];
    for (const s of siswaList) {
      insertSiswa.run(...s);
    }

    const insertNilai = db.prepare(
      "INSERT INTO nilai (id, siswa_id, nama_siswa, kelas, mapel, semester, nilai_akhir, keterangan) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const nilaiList = [
      ["N001", "S001", "Budi Santoso", "8B", "Matematika", "ganjil", 88, "Tuntas"],
      ["N002", "S001", "Budi Santoso", "8B", "IPA", "ganjil", 90, "Tuntas"],
      ["N003", "S002", "Siti Rahma", "8B", "Matematika", "ganjil", 92, "Tuntas"],
      ["N004", "S005", "Rian Hidayat", "9A", "Matematika", "ganjil", 74, "Belum Tuntas"],
      ["N005", "S001", "Budi Santoso", "8B", "IPA", "genap", 85, "Tuntas"],
    ];
    for (const n of nilaiList) {
      insertNilai.run(...n);
    }

    const insertSPP = db.prepare(
      "INSERT INTO spp (id, siswa_id, nama_siswa, kelas, bulan, nominal, status, jatuh_tempo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const sppList = [
      ["SPP001", "S001", "Budi Santoso", "8B", "Oktober 2024", 500000, "nunggak", "2024-10-10"],
      ["SPP002", "S002", "Siti Rahma", "8B", "Oktober 2024", 500000, "lunas", "2024-10-10"],
      ["SPP003", "S006", "Farhan Nugraha", "8B", "Oktober 2024", 500000, "nunggak", "2024-10-10"],
      ["SPP004", "S005", "Rian Hidayat", "9A", "Oktober 2024", 550000, "nunggak", "2024-10-10"],
      ["SPP005", "S003", "Ahmad Dahlan", "7A", "Oktober 2024", 450000, "lunas", "2024-10-10"],
    ];
    for (const sp of sppList) {
      insertSPP.run(...sp);
    }
  }
}
