// ---------------------------------------------------------------------------
// GENERIC LAZY PARAM RESOLVER
// Resolves ParamSpec dari allowed_params route terpilih:
//   mode "list"  -> fetch 1x per client (master kecil), cache Redis TTL 30m,
//                   cocokkan token user ke item master (exact/contains/cosine)
//   mode "search" -> fetch ?q=<token> per token (data ribuan), cache per (client,key,token)
//   mode "enum"  -> nilai sudah diekstraksi regex di extractor (tanpa fetch)
// Semua fetch meneruskan X-Client-Id, X-User-Role, dan Authorization.
// ---------------------------------------------------------------------------
import pc from "picocolors";
import type { ActiveContext, AppRoute, ParamSpec } from "./routes-sync.js";
import type { RawExtraction } from "./extractor.js";
import { cacheGet, cacheSet } from "./cache/redis.js";
import { semanticSimilarity, semanticEnumMatch } from "./local-model.js";

const APP_EDUCATION_URL = process.env.APP_EDUCATION_URL || "http://127.0.0.1:3000";

// TTD default 30 menit (bisa dioverride per spec melalui field ttl di DB)
const DEFAULT_TTL = parseInt(process.env.SMARTSEARCH_MASTER_TTL || "1800", 10);

export interface MasterItem {
  id: string;
  name: string;
  code?: string;
  is_active?: number;
  wali_kelas?: string;
  kelas?: string;
  kelas_id?: string;
  nisn?: string;
  status?: string;
  raw: Record<string, any>;
}

export interface ResolvedParam {
  spec: ParamSpec;
  values: MasterItem[];
  source: "exact" | "contains" | "semantic" | "enum" | "active_context" | "search";
}

// Single-flight lock per (client, request) — mencegah stampede saat cache miss
const inFlightFetch = new Map<string, Promise<MasterItem[]>>();

function normalizeItems(json: any): MasterItem[] {
  const rows: any[] = Array.isArray(json)
    ? json
    : Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json?.items)
        ? json.items
        : [];
  return rows.map((r) => ({
    id: String(r.id ?? ""),
    name: String(r.name ?? r.nama ?? ""),
    code: r.code !== undefined ? String(r.code) : undefined,
    is_active: r.is_active !== undefined ? Number(r.is_active) : undefined,
    wali_kelas: r.wali_kelas,
    kelas: r.kelas,
    kelas_id: r.kelas_id,
    nisn: r.nisn,
    status: r.status,
    raw: r,
  }));
}

async function fetchMasterList(endpoint: string, clientId: string, role: string, auth?: string): Promise<MasterItem[]> {
  const res = await fetch(`${APP_EDUCATION_URL}${endpoint}`, {
    headers: {
      "X-Client-Id": clientId,
      "X-User-Role": role.toUpperCase(),
      ...(auth ? { Authorization: auth } : {}),
    },
    signal: AbortSignal.timeout(2500),
  });
  if (!res.ok) throw new Error(`Master fetch ${endpoint} HTTP ${res.status}`);
  return normalizeItems(await res.json());
}

async function fetchSearch(endpoint: string, queryParam: string, token: string, clientId: string, role: string, auth?: string): Promise<MasterItem[]> {
  const url = `${APP_EDUCATION_URL}${endpoint}?${queryParam || "q"}=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    headers: {
      "X-Client-Id": clientId,
      "X-User-Role": role.toUpperCase(),
      ...(auth ? { Authorization: auth } : {}),
    },
    signal: AbortSignal.timeout(2500),
  });
  if (!res.ok) throw new Error(`Search fetch ${endpoint} HTTP ${res.status}`);
  return normalizeItems(await res.json());
}

// Lazy load master list: Redis cache -> (miss) single-flight HTTP fetch -> Redis
async function lazyList(endpoint: string, specKey: string, clientId: string, role: string, auth?: string, ttl = DEFAULT_TTL): Promise<MasterItem[]> {
  const cacheKey = `smartsearch:master:${clientId}:${specKey}`;
  const cached = await cacheGet(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {}
  }

  const lockKey = cacheKey;
  const existing = inFlightFetch.get(lockKey);
  if (existing) return await existing;

  const promise = (async (): Promise<MasterItem[]> => {
    const items = await fetchMasterList(endpoint, clientId, role, auth);
    await cacheSet(cacheKey, JSON.stringify(items), ttl);
    return items;
  })().finally(() => {
    inFlightFetch.delete(lockKey);
  });
  inFlightFetch.set(lockKey, promise);
  return await promise;
}

// Lazy load hasil pencarian entity (?q=token): Redis cache per token
async function lazySearch(
  endpoint: string, queryParam: string, specKey: string, token: string,
  clientId: string, role: string, auth?: string, ttl = DEFAULT_TTL
): Promise<MasterItem[]> {
  const cacheKey = `smartsearch:lookup:${clientId}:${specKey}:${token.toLowerCase()}`;
  const cached = await cacheGet(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {}
  }

  const lockKey = cacheKey;
  const existing = inFlightFetch.get(lockKey);
  if (existing) return await existing;

  const promise = (async (): Promise<MasterItem[]> => {
    const items = await fetchSearch(endpoint, queryParam, token, clientId, role, auth);
    await cacheSet(cacheKey, JSON.stringify(items), ttl);
    return items;
  })().finally(() => {
    inFlightFetch.delete(lockKey);
  });
  inFlightFetch.set(lockKey, promise);
  return await promise;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/gi, "");
}

// Cocokkan token ke satu field item master
function tokenMatchesItem(token: string, field: string): boolean {
  const t = norm(token);
  const f = norm(field);
  if (!t || !f) return false;
  if (f === t) return true;           // exact (careful: "matematika" ✅)
  if (f.includes(t) || t.includes(f)) return true; // bidirectional contains: "siti" ⊂ "siti rahma", "matematika" ⊂ full query ✅
  return false;
}

// Regex helper aman dengan cache agar tidak melempar SyntaxError bila DB regex rusak
const regexCache = new Map<string, RegExp | null>();
function testRegexSafe(pattern: string | undefined, text: string): boolean {
  if (!pattern) return true;
  let re = regexCache.get(pattern);
  if (re === undefined) {
    try {
      re = new RegExp(pattern, "i");
    } catch {
      re = null;
    }
    regexCache.set(pattern, re);
  }
  return re ? re.test(text) : false;
}

export interface LazyResolveContext {
  clientId: string;
  role: string;
  auth?: string;
  activeContext?: ActiveContext;
}

export interface ResolveOptions {
  maxOptionsPerParam?: number;
}

// ---------------------------------------------------------------------------
// resolveParams: eksekusi seluruh ParamSpec yang diaktifkan oleh RawExtraction
// ---------------------------------------------------------------------------
export async function resolveParams(
  extraction: RawExtraction,
  specs: ParamSpec[],
  ctx: LazyResolveContext,
  opts: ResolveOptions = {}
): Promise<ResolvedParam[]> {
  const maxPerParam = opts.maxOptionsPerParam ?? 10;
  const out: ResolvedParam[] = [];

  const listParams = specs.filter((s) => (s.mode ?? "list") === "list" && s.endpoint);
  const searchParams = specs.filter((s) => s.mode === "search" && s.endpoint);

  // --- mode "list": lazy fetch master kecil DULUAN (kelas, mapel, tahun) ---
  // Hasil token yang cocok sebagai kelas/mapel akan ditandai agar tidak ditembak
  // secara mubazir ke endpoint siswa (Token Exclusion).
  const consumedTokens = new Set<string>();
  const listWork: Promise<ResolvedParam | null>[] = [];
  for (const spec of listParams) {
    if (spec.key === "academic_year_id") continue;
    // Trigger detection: hanya fetch master jika slot ini relevan di kalimat
    if (spec.hint_regex && !testRegexSafe(spec.hint_regex, extraction.query)) continue;

    listWork.push(
      lazyList(spec.endpoint!, spec.key, ctx.clientId, ctx.role, ctx.auth).then((items) => {
        const matches = matchListItems(extraction, spec, items);
        if (matches.length === 0) return null;
        // Catat token yang sudah terpakai sebagai kelas/mapel
        for (const m of matches) {
          if (m.code) consumedTokens.add(norm(m.code));
          if (m.name) consumedTokens.add(norm(m.name));
        }
        return { spec, values: matches, source: "exact" as const };
      }).catch(() => null)
    );
  }

  const resolvedLists = (await Promise.all(listWork)).filter(Boolean) as ResolvedParam[];

  // --- mode "enum": nilai dari extractor (regex negation-aware, 0 HTTP call) ---
  // Lapisan ke-2 (semantic transformers.js): bila regex DB tidak kena (frasa colloquial
  // seperti "thn ajaran sekarang", "kasih duit"), cycle similarity query vs valueKey.
  const enumFallbackWork: Promise<{ spec: ParamSpec; source: "enum" | "semantic" } | null>[] = [];
  for (const spec of specs) {
    if ((spec.mode ?? null) !== "enum" || !spec.values) continue;
    if (extraction.enumValues[spec.key]) continue;
    // Gate hint_regex (mis. periode hanya semantik aktif bila kalimat memuat kata waktu)
    if (spec.hint_regex && !testRegexSafe(spec.hint_regex, extraction.query)) continue;
    enumFallbackWork.push(
      (async () => {
        const semanticKey = await semanticEnumMatch(extraction.query, spec.values!).catch((e) => { return null; });
        if (!semanticKey) return null;
        extraction.enumValues[spec.key] = semanticKey;
        return { spec, source: "semantic" as const };
      })()
    );
  }
  const enumFallbacks = (await Promise.all(enumFallbackWork)).filter(Boolean) as { spec: ParamSpec; source: "enum" | "semantic" }[];
  // Semua slot enum yang sudah terisi (regex di atas / semantic fallback di sini)
  // masuk ke enumParams agar dispatcher memiliki label sumber + filter yang valid.
  const enumSpecs = specs.filter((s) => (s.mode ?? null) === "enum" && extraction.enumValues[s.key]);
  const enumParams = enumSpecs.map((spec) => {
    const fb = enumFallbacks.find((r) => r.spec === spec);
    return { spec, values: [] as MasterItem[], source: (fb ? fb.source : "enum") as "enum" | "semantic" };
  });

  // --- mode "search": fetch entity by token ke endpoint (HTTP + Redis cache) ---
  // Hanya menembak token yang BELUM terpakai oleh master list (misal: "8b" sudah terpakai
  // sebagai kelas_id, maka tidak akan ditembak ke /api/siswa?q=8b).
  const searchWork = searchParams.map(async (spec) => {
    if (spec.hint_regex && !testRegexSafe(spec.hint_regex, extraction.query)) return null;
    if (extraction.tokens.length === 0) return null;

    // Filter token: buang token yang sudah teridentifikasi sebagai kelas/mapel
    const availableTokens = extraction.tokens.filter((t) => !consumedTokens.has(norm(t)));
    if (availableTokens.length === 0) return null;

    // Cap 3 token distinct per param (anti-bombardir endpoint utk kalimat panjang)
    const seen = new Set<string>();
    const uniqueTokens = availableTokens.filter((t) => {
      const key = norm(t);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 3);

    const results = await Promise.all(
      uniqueTokens.map((t) => lazySearch(spec.endpoint!, spec.query_param || "q", spec.key, t, ctx.clientId, ctx.role, ctx.auth).catch(() => [] as MasterItem[]))
    );
    const merged = [...new Map(results.flat().map((item) => [item.id + item.name, item])).values()].slice(0, maxPerParam);
    if (merged.length === 0) return null;
    return { spec, values: merged, source: "search" as const };
  });

  const resolvedSearches = (await Promise.all(searchWork)).filter(Boolean) as ResolvedParam[];
  out.push(...resolvedLists, ...resolvedSearches, ...enumParams);

  // --- Slot "academic_year_id": utamakan tahun eksplisit (mis. "2024/2025") sebelum relative active context ---
  const aySpec = specs.find((s) => s.key === "academic_year_id");
  const explicitYearMatch = extraction.query.match(/\b(\d{4}\/\d{4})\b/);

  if (aySpec && aySpec.endpoint && explicitYearMatch) {
    // Explicit tahun (mis. "2024/2025") → match dari master API
    try {
      const items = await lazyList(aySpec.endpoint, aySpec.key, ctx.clientId, ctx.role, ctx.auth);
      const found = items.filter((i) => norm(i.name) === norm(explicitYearMatch[1]));
      if (found.length > 0) out.push({ spec: aySpec, values: found, source: "exact" });
    } catch {}
  } else if (aySpec && aySpec.endpoint && (extraction.timeHints.tahun_ajaran_ini || extraction.timeHints.tahun_ini) && ctx.activeContext?.academic_year_id) {
    out.push({
      spec: aySpec,
      values: [{ id: ctx.activeContext.academic_year_id, name: ctx.activeContext.tahun_ajaran || "", raw: { is_active: 1 } }],
      source: "active_context",
    });
  } else if (aySpec && aySpec.endpoint && extraction.timeHints.tahun_ajaran_ini) {
    // "tahun ajaran ini" tapi active_context kosong → fallback: master API is_active=1
    try {
      const items = await lazyList(aySpec.endpoint, aySpec.key, ctx.clientId, ctx.role, ctx.auth);
      const active = items.filter((i) => i.is_active === 1);
      if (active.length > 0) out.push({ spec: aySpec, values: active, source: "exact" });
    } catch {}
  }

  return out;
}

// Cocokkan extraction.tokens ke daftar item master (sudah di-cache)
// Untuk kelas: cek code, name, dan (jika diberikan) match_field wali_kelas.
// Untuk subject/academic_year dsb: cocokkan name (contains/exact).
function matchListItems(extraction: RawExtraction, spec: ParamSpec, items: MasterItem[]): MasterItem[] {
  // Slot waktu spesial: "tahun ajaran ini" -> item is_active=1
  if (spec.key === "academic_year_id") {
    if (extraction.timeHints.tahun_ajaran_ini || extraction.timeHints.tahun_ini) {
      const active = items.filter((i) => i.is_active === 1);
      if (active.length > 0) return active;
    }
    // Explicit: "2025/2026" -> match name
    const yearMatch = extraction.query.match(/\b(\d{4}\/\d{4})\b/);
    if (yearMatch) {
      const found = items.filter((i) => norm(i.name) === norm(yearMatch[1]));
      if (found.length > 0) return found;
    }
    return [];
  }

  const fields: ((i: MasterItem) => string)[] = [];
  // wali kelas param: match_field wali_kelas
  if (spec.match_field && spec.match_field === "wali_kelas") fields.push((i) => i.wali_kelas || "");
  fields.push((i) => i.name);
  if (spec.key === "kelas_id") fields.push((i) => i.code || "", (i) => i.id);

  const out: MasterItem[] = [];
  for (const tokenOrPhrase of [...extraction.tokens, extraction.query]) {
    for (const item of items) {
      if (out.includes(item)) continue;
      const matched = fields.some((fn) => tokenMatchesItem(tokenOrPhrase, fn(item)));
      if (matched) out.push(item);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Util utk dispatcher: build lookup map paramKey -> ResolvedParam (first)
// ---------------------------------------------------------------------------
export function indexResolvedParams(resolved: ResolvedParam[]): Record<string, ResolvedParam> {
  const map: Record<string, ResolvedParam> = {};
  for (const r of resolved) {
    if (!map[r.spec.key]) map[r.spec.key] = r;
  }
  return map;
}

export function logResolution(resolved: ResolvedParam[]) {
  for (const r of resolved) {
    console.log(
      pc.cyan(`  🔧 Lazy Param ${r.spec.key} [${r.source}] -> ${r.values.map((v) => `${v.id}#${v.name}`).join(", ") || "(enum)"}`)
    );
  }
}
