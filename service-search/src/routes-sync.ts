import pc from "picocolors";
import { cacheGet, cacheSet, DEFAULT_TTL_SECONDS } from "./cache/redis.js";

export interface AppRoute {
  id: string;
  job_id?: string;
  job_code?: string;
  title: string;
  path: string;
  description: string;
  icon?: string;
  keywords: string[];
  supported_intents: string[];
  filter_keys: string[];
  client_id?: string;
}

export interface ResolvedEntity {
  type: "kelas" | "invoice" | "siswa" | "agregasi";
  id: string;
  code?: string;
  name: string;
  detail_url?: string;
  list_url: string;
  meta?: any;
}

const APP_EDUCATION_URL = process.env.APP_EDUCATION_URL || "http://127.0.0.1:3000";

// Fallback jika backend app belum menyala saat pertama kali start (semua code lowercase)
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
    keywords: ["spp", "bayar", "tagihan", "nunggak", "keuangan", "iuran", "tunggakan", "invoice"],
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
  {
    id: "kelas",
    title: "Master Ruang Kelas",
    path: "/kelas",
    description: "Data ruang kelas, rombel, dan wali kelas",
    keywords: ["kelas", "ruang kelas", "rombel", "wali kelas"],
    supported_intents: ["LIST_MENU", "DIRECT_LINK"],
    filter_keys: ["id", "tingkat"],
  },
];

export async function getActiveRoutes(
  clientId: string = "1",
  role: string = "SUPERADMIN",
  forceRefresh = false
): Promise<AppRoute[]> {
  const routesCacheKey = `smartsearch:routes:${clientId}:${role.toUpperCase()}`;

  // 1. Cek dari Cache Redis dulu (per client_id dan per role)
  if (!forceRefresh) {
    const cached = await cacheGet(routesCacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {}
    }
  }

  // 2. Fetch fresh manifest dari Backend App Pendidikan dengan header ACL Pintro
  try {
    const res = await fetch(`${APP_EDUCATION_URL}/api/routes`, {
      headers: {
        "X-Client-Id": clientId,
        "X-User-Role": role,
      },
      signal: AbortSignal.timeout(1500),
    });

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.routes) && data.routes.length > 0) {
        await cacheSet(routesCacheKey, JSON.stringify(data.routes), DEFAULT_TTL_SECONDS);
        return data.routes;
      }
    }
  } catch {
    // Backend mungkin belum nyala, gunakan fallback
  }

  // 3. Fallback ke memory lokal jika backend belum dapat dijangkau
  await cacheSet(routesCacheKey, JSON.stringify(FALLBACK_ROUTES), DEFAULT_TTL_SECONDS);
  return FALLBACK_ROUTES;
}

// Entity Resolver: Mencari kelas, invoice, siswa dari database app melalui API
export async function resolveEntities(
  query: string,
  clientId: string = "1"
): Promise<ResolvedEntity[]> {
  const cacheKey = `smartsearch:entity:${clientId}:${query.toLowerCase().trim()}`;

  const cached = await cacheGet(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {}
  }

  try {
    const res = await fetch(
      `${APP_EDUCATION_URL}/api/master/resolve?q=${encodeURIComponent(query)}`,
      {
        headers: { "X-Client-Id": clientId },
        signal: AbortSignal.timeout(1500),
      }
    );

    if (res.ok) {
      const data = await res.json();
      if (data.found && Array.isArray(data.entities)) {
        await cacheSet(cacheKey, JSON.stringify(data.entities), DEFAULT_TTL_SECONDS);
        return data.entities;
      }
    }
  } catch {}

  return [];
}
