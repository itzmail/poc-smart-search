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
//   "date_month" -> nomor bulan 1-12 dari hint waktu; spec pertama = awal, kedua = akhir (tanpa endpoint)
//   "text"       -> teks bebas, tidak di-resolve (tanpa endpoint)
// time_slot (opsional): menandai param list sebagai tahun ajaran, agar "tahun ajaran ini/lalu"
//   diselesaikan dari active_context / master (tanpa menebak nama key).
export interface ParamSpec {
  key: string;
  endpoint?: string;
  mode?: "list" | "search" | "enum" | "date_range" | "date_month" | "text";
  time_slot?: "academic_year";
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
  type: string;
  id: string;
  code?: string;
  name: string;
  detail_url?: string;
  list_url: string;
  meta?: any;
}

const APP_EDUCATION_URL = process.env.APP_EDUCATION_URL || "http://127.0.0.1:3000";

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
        // Array kosong dari upstream sehat = role/tenant tanpa izin: jangan dianggap gagal
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
      // Backend mungkin belum nyala
      appEducationBreaker.failure();
    }
  }

  // 3. Upstream tidak tersedia: tidak ada route hardcode, kembalikan kosong + degraded
  const degradedManifest: RoutesManifest = { routes: [], degraded: true };
  await cacheSet(routesCacheKey, JSON.stringify(degradedManifest), DEGRADED_TTL_SECONDS);
  return degradedManifest;
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
