export interface SiswaRecord {
  id: string;
  nisn: string;
  nama: string;
  kelas: string;
  status: "aktif" | "alumni" | "pindah";
  gender: "L" | "P";
}

export interface NilaiRecord {
  id: string;
  siswa_id: string;
  nama_siswa: string;
  kelas: string;
  mapel: string;
  semester: "ganjil" | "genap";
  nilai_akhir: number;
  keterangan: "Tuntas" | "Belum Tuntas";
}

export interface SPPRecord {
  id: string;
  siswa_id: string;
  nama_siswa: string;
  kelas: string;
  bulan: string;
  nominal: number;
  status: "lunas" | "nunggak";
  jatuh_tempo: string;
}

export const SISWA_DATA: SiswaRecord[] = [
  { id: "S001", nisn: "0081234561", nama: "Budi Santoso", kelas: "8B", status: "aktif", gender: "L" },
  { id: "S002", nisn: "0081234562", nama: "Siti Rahma", kelas: "8B", status: "aktif", gender: "P" },
  { id: "S003", nisn: "0081234563", nama: "Ahmad Dahlan", kelas: "7A", status: "aktif", gender: "L" },
  { id: "S004", nisn: "0081234564", nama: "Dewi Sartika", kelas: "7C", status: "aktif", gender: "P" },
  { id: "S005", nisn: "0081234565", nama: "Rian Hidayat", kelas: "9A", status: "aktif", gender: "L" },
  { id: "S006", nisn: "0081234566", nama: "Farhan Nugraha", kelas: "8B", status: "aktif", gender: "L" },
  { id: "S007", nisn: "0081234567", nama: "Putri Anggraini", kelas: "8B", status: "pindah", gender: "P" },
];

export const NILAI_DATA: NilaiRecord[] = [
  { id: "N001", siswa_id: "S001", nama_siswa: "Budi Santoso", kelas: "8B", mapel: "Matematika", semester: "ganjil", nilai_akhir: 88, keterangan: "Tuntas" },
  { id: "N002", siswa_id: "S001", nama_siswa: "Budi Santoso", kelas: "8B", mapel: "IPA", semester: "ganjil", nilai_akhir: 90, keterangan: "Tuntas" },
  { id: "N003", siswa_id: "S002", nama_siswa: "Siti Rahma", kelas: "8B", mapel: "Matematika", semester: "ganjil", nilai_akhir: 92, keterangan: "Tuntas" },
  { id: "N004", siswa_id: "S005", nama_siswa: "Rian Hidayat", kelas: "9A", mapel: "Matematika", semester: "ganjil", nilai_akhir: 74, keterangan: "Belum Tuntas" },
  { id: "N005", siswa_id: "S001", nama_siswa: "Budi Santoso", kelas: "8B", mapel: "IPA", semester: "genap", nilai_akhir: 85, keterangan: "Tuntas" },
];

export const SPP_DATA: SPPRecord[] = [
  { id: "SPP001", siswa_id: "S001", nama_siswa: "Budi Santoso", kelas: "8B", bulan: "Oktober 2024", nominal: 500000, status: "nunggak", jatuh_tempo: "2024-10-10" },
  { id: "SPP002", siswa_id: "S002", nama_siswa: "Siti Rahma", kelas: "8B", bulan: "Oktober 2024", nominal: 500000, status: "lunas", jatuh_tempo: "2024-10-10" },
  { id: "SPP003", siswa_id: "S006", nama_siswa: "Farhan Nugraha", kelas: "8B", bulan: "Oktober 2024", nominal: 500000, status: "nunggak", jatuh_tempo: "2024-10-10" },
  { id: "SPP004", siswa_id: "S005", nama_siswa: "Rian Hidayat", kelas: "9A", bulan: "Oktober 2024", nominal: 550000, status: "nunggak", jatuh_tempo: "2024-10-10" },
  { id: "SPP005", siswa_id: "S003", nama_siswa: "Ahmad Dahlan", kelas: "7A", bulan: "Oktober 2024", nominal: 450000, status: "lunas", jatuh_tempo: "2024-10-10" },
];
