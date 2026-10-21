import pc from "picocolors";
import { cacheGet, cacheSet, DEFAULT_TTL_SECONDS } from "./cache/redis.js";

export interface AppRoute {
  id: string;
  title: string;
  path: string;
  description: string;
  keywords: string[];
  supported_intents: string[];
  filter_keys: string[];
}

const ROUTES_CACHE_KEY = "smartsearch:routes:manifest";
const APP_EDUCATION_URL = process.env.APP_EDUCATION_URL || "http://127.0.0.1:3000";

// Fallback jika backend app belum menyala saat pertama kali start
const FALLBACK_ROUTES: AppRoute[] = [
  {
    id: "dashboard",
    title: "Dashboard Utama",
    path: "/dashboard",
    description: "Statistik umum sekolah, total siswa, dan ringkasan pembayaran",
    keywords: ["home", "beranda", "dashboard", "utama", "statistik"],
    supported_intents: ["LIST_MENU"],
    filter_keys: [],
  },
  {
    id: "siswa",
    title: "Master Data Siswa",
    path: "/siswa",
    description: "Daftar data induk siswa, profil murid, filter kelas dan status",
    keywords: ["siswa", "murid", "santri", "pelajar", "data siswa", "profil"],
    supported_intents: ["LIST_MENU", "DIRECT_LINK"],
    filter_keys: ["kelas", "status", "q"],
  },
  {
    id: "nilai",
    title: "Penilaian Akademik Siswa",
    path: "/nilai",
    description: "Buku nilai siswa, rekap nilai harian, PTS, PAS, per mata pelajaran",
    keywords: ["nilai", "akademik", "skor", "ulangan", "rapor", "mata pelajaran", "mapel"],
    supported_intents: ["LIST_MENU", "DIRECT_LINK"],
    filter_keys: ["kelas", "semester", "mapel"],
  },
  {
    id: "spp",
    title: "Pembayaran & Tagihan SPP",
    path: "/spp",
    description: "Kelola tagihan SPP, siswa nunggak, pembayaran uang sekolah, kas keuangan",
    keywords: ["spp", "bayar", "tagihan", "nunggak", "keuangan", "iuran", "tunggakan"],
    supported_intents: ["LIST_MENU", "DIRECT_LINK"],
    filter_keys: ["status", "kelas"],
  },
  {
    id: "rapot",
    title: "Cetak & Distribusi Rapot",
    path: "/rapot",
    description: "Aksi cetak dokumen rapor, unduh PDF rapor per siswa atau per kelas",
    keywords: ["rapot", "rapor", "cetak", "unduh", "download", "pdf", "leger"],
    supported_intents: ["LIST_MENU", "REPORT_ACTION"],
    filter_keys: ["kelas", "semester", "format", "nama"],
  },
];

export async function getActiveRoutes(forceRefresh = false): Promise<AppRoute[]> {
  // 1. Cek dari Cache Redis dulu (jika tidak force refresh)
  if (!forceRefresh) {
    const cached = await cacheGet(ROUTES_CACHE_KEY);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {}
    }
  }

  // 2. Fetch fresh manifest dari Backend App Pendidikan
  try {
    const res = await fetch(`${APP_EDUCATION_URL}/api/routes`, {
      signal: AbortSignal.timeout(1500),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.routes) && data.routes.length > 0) {
        await cacheSet(ROUTES_CACHE_KEY, JSON.stringify(data.routes), DEFAULT_TTL_SECONDS);
        console.log(pc.green(`✔ [Routes-Sync] Berhasil sinkronisasi ${data.routes.length} route dari App ke Redis (TTL 30m).`));
        return data.routes;
      }
    }
  } catch {
    // Backend mungkin belum nyala, gunakan fallback
  }

  // 3. Fallback ke memory lokal jika backend belum dapat dijangkau
  await cacheSet(ROUTES_CACHE_KEY, JSON.stringify(FALLBACK_ROUTES), DEFAULT_TTL_SECONDS);
  return FALLBACK_ROUTES;
}
