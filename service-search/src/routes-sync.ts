import pc from "picocolors";
import { cacheGet, cacheSet, DEFAULT_TTL_SECONDS } from "./cache/redis.js";
import { appEducationBreaker } from "./breaker.js";

// Kontrak descriptor satu query-param yang dikenali sebuah route.
// Sumber kebenaran: kolom JSON `search_routes.allowed_params` (tabel DB).
// mode:
//   "list"       -> master list kecil, dicocokkan ke token query (butuh endpoint)
//   "search"     -> pencarian entity per-token via query_param (butuh endpoint)
//   "enum"       -> nilai dari regex DB (values) atau semantic fallback (tanpa endpoint)
//   "date_range" -> rentang tanggal (gte & lte) yang dihitung dari hint waktu (tanpa endpoint)
export interface ParamSpec {
  key: string;
  endpoint?: string;
  mode?: "list" | "search" | "enum" | "date_range";
  query_param?: string;
  param_gte?: string;
  param_lte?: string;
  match_field?: string;
  resolves_to?: string;
  hint_regex?: string;
  values?: Record<string, string>;
}

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
  allowed_params?: ParamSpec[];
  client_id?: string;
}

// Konteks kalender akademik aktif dari app (sumber kebenaran waktu relatif)
export interface ActiveContext {
  today: string;
  bulan_label: string;
  tahun_ajaran: string;
  semester: string;
  academic_year_id?: string;
}

export interface RoutesManifest {
  routes: AppRoute[];
  active_context?: ActiveContext;
  degraded?: boolean;
}

const DEGRADED_TTL_SECONDS = parseInt(process.env.SMARTSEARCH_DEGRADED_TTL || "20", 10);

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

// Fallback jika backend app belum menyala saat pertama kali start (Pintro NG routes)
const FALLBACK_ROUTES: AppRoute[] = [
  {
    id: "siswa",
    title: "Master Data Siswa",
    path: "/ng_student",
    description: "Daftar data induk siswa, profil murid, filter kelas dan status",
    keywords: ["siswa", "murid", "santri", "pelajar", "data siswa", "profil"],
    supported_intents: ["LIST_MENU", "DIRECT_LINK"],
    allowed_params: [
      {
        key: "filter[name]",
        endpoint: "/api/smart-search/siswa",
        mode: "search",
        query_param: "q",
      },
      {
        key: "filter[ng_class_level_id]",
        endpoint: "/api/smart-search/kelas",
        mode: "list",
      },
      {
        key: "filter[status]",
        mode: "enum",
        values: {
          "1": "\\b(aktif|masih\\s*belajar)\\b",
          "0": "\\b(pindah|tidak\\s*aktif)\\b",
          "2": "\\b(lulus|alumni)\\b",
          "3": "\\b(cuti|ditangguhkan)\\b",
        },
        hint_regex: "\\b(status|aktif|pindah|lulus|cuti)\\b",
      },
    ],
  },
  {
    id: "siswa_detail",
    title: "Detail Profil Siswa",
    path: "/ng_student/detail/:id",
    description: "Profil lengkap biodata siswa, data orang tua, riwayat pendidikan",
    keywords: ["profil siswa", "biodata siswa", "detail murid", "data pribadi siswa"],
    supported_intents: ["DIRECT_LINK"],
    allowed_params: [
      {
        key: "id",
        endpoint: "/api/smart-search/siswa",
        mode: "search",
        query_param: "q",
      },
    ],
  },
  {
    id: "spp",
    title: "Pembayaran & Tagihan SPP",
    path: "/ng_account_invoice_student",
    description: "Kelola tagihan SPP, siswa nunggak, pembayaran uang sekolah",
    keywords: ["spp", "bayar", "tagihan", "nunggak", "invoice", "tunggakan", "keuangan"],
    supported_intents: ["LIST_MENU", "DIRECT_LINK"],
    allowed_params: [
      {
        key: "filter[name]",
        endpoint: "/api/smart-search/siswa",
        mode: "search",
        query_param: "q",
      },
      {
        key: "filter[ng_class_level_id]",
        endpoint: "/api/smart-search/kelas",
        mode: "list",
      },
      {
        key: "filter[status]",
        mode: "enum",
        values: {
          "0": "\\b(nunggak|belum\\s*(bayar|lunas)|tunggakan)\\b",
          "1": "\\b(lunas|sudah\\s*bayar)\\b",
        },
        hint_regex: "\\b(status|lunas|nunggak|tunggakan)\\b",
      },
      {
        key: "filter[year]",
        endpoint: "/api/smart-search/academic-years",
        mode: "list",
        hint_regex: "tahun\\s*(ajaran|pelajaran)?\\s*(ini|sekarang|saat\\s*ini|aktif)|[0-9]{4}/[0-9]{4}",
      },
    ],
  },
  {
    id: "invoice_students",
    title: "Daftar Tagihan & Kuitansi Siswa",
    path: "/ng_invoice_students",
    description: "Daftar riwayat invoice, kuitansi pembayaran, dan cetak kuitansi siswa",
    keywords: ["invoice", "kuitansi", "kwitansi", "tagihan siswa", "cetak kuitansi", "bukti bayar"],
    supported_intents: ["LIST_MENU", "DIRECT_LINK"],
    allowed_params: [
      {
        key: "filter[name]",
        endpoint: "/api/smart-search/siswa",
        mode: "search",
        query_param: "q",
      },
      {
        key: "filter[ng_class_level_id]",
        endpoint: "/api/smart-search/kelas",
        mode: "list",
      },
    ],
  },
  {
    id: "invoice_students_detail",
    title: "Detail Invoice & Kuitansi Siswa",
    path: "/ng_invoice_students/detail/:id",
    description: "Halaman rincian tagihan per siswa, detail kwitansi dan status pembayaran",
    keywords: ["detail invoice", "detail tagihan", "rincian spp siswa", "detail kuitansi"],
    supported_intents: ["DIRECT_LINK"],
    allowed_params: [
      {
        key: "id",
        endpoint: "/api/smart-search/siswa",
        mode: "search",
        query_param: "q",
      },
    ],
  },
  {
    id: "status_spp",
    title: "Rekap Status Pembayaran SPP",
    path: "/ng_payment_spp_status",
    description: "Laporan matriks dan rekapitulasi status pembayaran SPP per bulan / tahun ajaran",
    keywords: ["status spp", "rekap spp", "matriks spp", "laporan spp", "pembayaran bulanan"],
    supported_intents: ["LIST_MENU", "DIRECT_LINK"],
    allowed_params: [
      {
        key: "filter[ng_class_level_id]",
        endpoint: "/api/smart-search/kelas",
        mode: "list",
      },
      {
        key: "filter[year]",
        endpoint: "/api/smart-search/academic-years",
        mode: "list",
        hint_regex: "tahun\\s*(ajaran|pelajaran)?\\s*(ini|sekarang|saat\\s*ini|aktif)|[0-9]{4}/[0-9]{4}",
      },
    ],
  },
];

export async function getRoutesManifest(
  clientId: string = "1",
  role: string = "SUPERADMIN",
  forceRefresh = false,
  auth?: string
): Promise<RoutesManifest> {
  const routesCacheKey = `smartsearch:routes:${clientId}:${role.toUpperCase()}`;

  // 1. Cek dari Cache Redis dulu (per client_id dan per role)
  if (!forceRefresh) {
    const cached = await cacheGet(routesCacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        // Format baru: { routes, active_context }
        if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.routes)) {
          return { routes: parsed.routes, active_context: parsed.active_context, degraded: parsed.degraded };
        }
        // Format lama (array routes saja)
        if (Array.isArray(parsed)) return { routes: parsed };
      } catch {}
    }
  }

  // 2. Fetch fresh manifest dari Backend App Pendidikan dengan header ACL Pintro
  if (appEducationBreaker.allow()) {
    try {
      const routesEndpoint = process.env.ROUTES_MANIFEST_ENDPOINT || "/api/smart-search/routes";
      const authToken = auth || process.env.AUTH_TOKEN;
      const res = await fetch(`${APP_EDUCATION_URL}${routesEndpoint}`, {
        headers: {
          "X-Client-Id": clientId,
          "X-User-Role": role,
          ...(authToken ? { Authorization: authToken } : {}),
        },
        signal: AbortSignal.timeout(1500),
      });

      if (res.ok) {
        appEducationBreaker.success();
        const data = await res.json();
        // Array kosong dari upstream sehat = role/tenant tanpa izin: jangan jatuh ke FALLBACK_ROUTES
        if (Array.isArray(data.routes)) {
          const manifest: RoutesManifest = {
            routes: data.routes,
            active_context: data.active_context,
          };
          await cacheSet(routesCacheKey, JSON.stringify(manifest), DEFAULT_TTL_SECONDS);
          return manifest;
        }
      } else {
        appEducationBreaker.failure();
      }
    } catch {
      // Backend mungkin belum nyala, gunakan fallback
      appEducationBreaker.failure();
    }
  }

  // 3. Fallback ke routes bawaan: tandai degraded dan cache singkat agar blip sesaat
  //    tidak mengunci tenant tanpa filter selama TTL penuh
  const fallbackManifest: RoutesManifest = { routes: FALLBACK_ROUTES, degraded: true };
  await cacheSet(routesCacheKey, JSON.stringify(fallbackManifest), DEGRADED_TTL_SECONDS);
  return fallbackManifest;
}

// Backward-compat wrapper: kembalikan hanya array routes
export async function getActiveRoutes(
  clientId: string = "1",
  role: string = "SUPERADMIN",
  forceRefresh = false
): Promise<AppRoute[]> {
  const manifest = await getRoutesManifest(clientId, role, forceRefresh);
  return manifest.routes;
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
