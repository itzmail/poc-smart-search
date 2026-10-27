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
import { semanticSimilarity, semanticEnumMatch, semanticListMatch, embedQuery, type SemanticMatchDetail } from "./local-model.js";
import type { ResolverTrace, ExtractorTrace } from "./tracer.js";
import { appEducationBreaker } from "./breaker.js";

const APP_EDUCATION_URL = process.env.APP_EDUCATION_URL || "http://127.0.0.1:3000";

// TTD default 30 menit (bisa dioverride per spec melalui field ttl di DB)
const DEFAULT_TTL = parseInt(process.env.SMARTSEARCH_MASTER_TTL || "1800", 10);

// Salinan stale master list: disajikan bila app-education gagal (stale-while-error)
const STALE_TTL = 86400;

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

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  if (!appEducationBreaker.allow()) throw new Error("app-education circuit open");
  try {
    const out = await fn();
    appEducationBreaker.success();
    return out;
  } catch (err) {
    appEducationBreaker.failure();
    throw err;
  }
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
async function lazyList(
  endpoint: string, specKey: string, clientId: string, role: string, auth?: string, ttl = DEFAULT_TTL,
  traceOps?: { redis?: Array<{ key: string; op: "GET" | "SET"; status: "HIT" | "MISS" }>; http?: Array<{ endpoint: string; param: string; query_token?: string; results_count: number }> }
): Promise<MasterItem[]> {
  const cacheKey = `smartsearch:master:${clientId}:${specKey}`;
  const cached = await cacheGet(cacheKey);
  if (cached) {
    if (traceOps?.redis) traceOps.redis.push({ key: cacheKey, op: "GET", status: "HIT" });
    try {
      return JSON.parse(cached);
    } catch {}
  }
  if (traceOps?.redis) traceOps.redis.push({ key: cacheKey, op: "GET", status: "MISS" });

  const lockKey = cacheKey;
  const existing = inFlightFetch.get(lockKey);
  if (existing) return await existing;

  const promise = (async (): Promise<MasterItem[]> => {
    let items: MasterItem[];
    try {
      items = await guarded(() => fetchMasterList(endpoint, clientId, role, auth));
    } catch (err) {
      const stale = await cacheGet(`${cacheKey}:stale`);
      if (stale) {
        try {
          return JSON.parse(stale);
        } catch {}
      }
      throw err;
    }
    if (traceOps?.http) traceOps.http.push({ endpoint, param: specKey, results_count: items.length });
    await cacheSet(cacheKey, JSON.stringify(items), ttl);
    await cacheSet(`${cacheKey}:stale`, JSON.stringify(items), STALE_TTL);
    if (traceOps?.redis) traceOps.redis.push({ key: cacheKey, op: "SET", status: "HIT" });
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
  clientId: string, role: string, auth?: string, ttl = DEFAULT_TTL,
  traceOps?: { redis?: Array<{ key: string; op: "GET" | "SET"; status: "HIT" | "MISS" }>; http?: Array<{ endpoint: string; param: string; query_token?: string; results_count: number }> }
): Promise<MasterItem[]> {
  const cacheKey = `smartsearch:lookup:${clientId}:${specKey}:${token.toLowerCase()}`;
  const cached = await cacheGet(cacheKey);
  if (cached) {
    if (traceOps?.redis) traceOps.redis.push({ key: cacheKey, op: "GET", status: "HIT" });
    try {
      return JSON.parse(cached);
    } catch {}
  }
  if (traceOps?.redis) traceOps.redis.push({ key: cacheKey, op: "GET", status: "MISS" });

  const lockKey = cacheKey;
  const existing = inFlightFetch.get(lockKey);
  if (existing) return await existing;

  const promise = (async (): Promise<MasterItem[]> => {
    let items = await guarded(() => fetchSearch(endpoint, queryParam, token, clientId, role, auth));
    if (traceOps?.http) traceOps.http.push({ endpoint, param: specKey, query_token: token, results_count: items.length });
    if (items.length === 0 && norm(token).length > FUZZY_PREFIX_LEN) {
      const prefix = norm(token).slice(0, FUZZY_PREFIX_LEN);
      const candidates = (await guarded(() => fetchSearch(endpoint, queryParam, prefix, clientId, role, auth))).slice(0, FUZZY_MAX_CANDIDATES);
      if (traceOps?.http) traceOps.http.push({ endpoint, param: specKey, query_token: prefix, results_count: candidates.length });
      items = fuzzyRank(token, candidates);
    }
    await cacheSet(cacheKey, JSON.stringify(items), ttl);
    if (traceOps?.redis) traceOps.redis.push({ key: cacheKey, op: "SET", status: "HIT" });
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

// Typo tolerance for name search: used only when the exact ?q=<token> lookup is empty.
const FUZZY_MAX_DIST = Number(process.env.FUZZY_MAX_DIST ?? 2);
const FUZZY_PREFIX_LEN = 3;
const FUZZY_MAX_CANDIDATES = 20;

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

function fuzzyMaxDist(t: string): number {
  return Math.min(t.length <= 4 ? 1 : 2, FUZZY_MAX_DIST);
}

// Edit distance between a normalized token and the closest word of a field.
function closestWordDist(t: string, field: string): number {
  return Math.min(...field.toLowerCase().split(/\s+/).map((w) => levenshtein(t, norm(w))));
}

// Keep only the candidates whose closest name word is nearest to the token; ties are all kept.
function fuzzyRank(token: string, items: MasterItem[]): MasterItem[] {
  const t = norm(token);
  const maxDist = fuzzyMaxDist(t);
  const scored = items
    .map((item) => ({ item, dist: closestWordDist(t, item.name) }))
    .filter((x) => x.dist <= maxDist);
  if (scored.length === 0) return [];
  const best = Math.min(...scored.map((x) => x.dist));
  return scored.filter((x) => x.dist === best).map((x) => x.item);
}

// Match strength of a token/phrase against one master field (0 = no match):
// 3 = exact, or the whole field appears inside the phrase ("bahasa inggris" in the query)
// 2 = token is a whole word of the field ("siti" in "Siti Rahma")
// 1 = token is only a substring of the field
function matchTier(token: string, field: string): number {
  const t = norm(token);
  const f = norm(field);
  if (!t || !f) return 0;
  if (f === t || t.includes(f)) return 3;
  if (f.includes(t)) return field.toLowerCase().split(/[^a-z0-9]+/).includes(t) ? 2 : 1;
  return 0;
}

// Abbreviation such as "mtk" -> "Matematika" or "ipa" -> "Ilmu Pengetahuan Alam":
// same first letter and the token's letters appear in order inside the field.
function isAbbreviation(token: string, field: string): boolean {
  const t = norm(token);
  const f = norm(field);
  if (t.length < 3 || !/^[a-z]+$/.test(t) || t[0] !== f[0]) return false;
  let i = 0;
  for (const c of f) if (c === t[i]) i++;
  return i === t.length;
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
  resolverTrace?: ResolverTrace;
  extractorTrace?: ExtractorTrace;
  // Out-param: di-set degraded=true bila ada fetch upstream yang gagal dan ditelan
  state?: { degraded: boolean };
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
  const rTrace = opts.resolverTrace;
  const eTrace = opts.extractorTrace;
  const markDegraded = () => {
    if (opts.state) opts.state.degraded = true;
  };

  if (rTrace) {
    rTrace.param_specs_evaluated = specs.map((s) => s.key);
  }

  const traceOps = rTrace
    ? {
        redis: rTrace.redis_operations,
        http: rTrace.http_calls,
      }
    : undefined;

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
    if (spec.hint_regex && !testRegexSafe(spec.hint_regex, extraction.query)) {
      if (rTrace) rTrace.token_exclusion.skipped_calls.push(`${spec.key} (hint_regex mismatch)`);
      continue;
    }

    listWork.push(
      lazyList(spec.endpoint!, spec.key, ctx.clientId, ctx.role, ctx.auth, DEFAULT_TTL, traceOps).then(async (items) => {
        let matches = matchListItems(extraction, spec, items);
        let source: "exact" | "semantic" = "exact";
        // Last resort: transformer, only for name-based lists (not people names via match_field)
        if (matches.length === 0 && !spec.match_field) {
          const tokens = extraction.tokens.filter((t) => /^[a-z]{4,}$/.test(norm(t))).slice(0, 3);
          const hit = await semanticListMatch(tokens, items).catch(() => null);
          const found = hit ? items.find((i) => i.id === hit.id) : undefined;
          if (found) {
            matches = [found];
            source = "semantic";
          }
        }
        if (matches.length === 0) return null;
        // Catat token yang sudah terpakai sebagai kelas/mapel
        for (const m of matches) {
          if (m.code) consumedTokens.add(norm(m.code));
          if (m.name) consumedTokens.add(norm(m.name));
        }
        return { spec, values: matches, source };
      }).catch(() => {
        markDegraded();
        return null;
      })
    );
  }

  const resolvedLists = (await Promise.all(listWork)).filter(Boolean) as ResolvedParam[];

  // --- mode "enum" & "date_range": nilai dari extractor (regex negation-aware, 0 HTTP call) ---
  // Lapisan ke-2 (semantic transformers.js): bila regex DB tidak kena (frasa colloquial
  // seperti "thn ajaran sekarang", "kasih duit"), cycle similarity query vs valueKey.
  const enumFallbackWork: Promise<{ spec: ParamSpec; source: "enum" | "semantic" } | null>[] = [];
  let queryVecP: Promise<number[] | null> | undefined; // query embedded once per request, shared by all specs
  for (const spec of specs) {
    if (((spec.mode ?? null) !== "enum" && spec.mode !== "date_range") || !spec.values) continue;
    if (extraction.enumValues[spec.key]) {
      // Regex L1 already resolved this slot -> transformers.js is in STANDBY
      if (eTrace) {
        eTrace.transformers_status.push({
          param: spec.key,
          status: "STANDBY",
          matched_value: extraction.enumValues[spec.key],
        });
      }
      continue;
    }
    // No hint_regex gate: the hand-written hint tends to miss the same colloquial phrasing the
    // regex values missed. semanticEnumMatch's score + margin thresholds guard false positives.
    enumFallbackWork.push(
      (async () => {
        let detailCapture: SemanticMatchDetail | undefined;
        queryVecP ??= embedQuery(extraction.query).catch(() => null);
        const semanticKey = await semanticEnumMatch(extraction.query, spec.values!, (detail) => {
          detailCapture = detail;
        }, await queryVecP).catch(() => null);

        if (eTrace && detailCapture) {
          eTrace.transformers_status.push({
            param: spec.key,
            status: "ENGAGED",
            score: detailCapture.bestScore,
            margin: detailCapture.margin,
            matched_value: semanticKey || undefined,
            reason: semanticKey ? "High cosine similarity" : "Below threshold or margin gate",
          });
        }

        if (!semanticKey) return null;
        extraction.enumValues[spec.key] = semanticKey;
        return { spec, source: "semantic" as const };
      })()
    );
  }
  const enumFallbacks = (await Promise.all(enumFallbackWork)).filter(Boolean) as { spec: ParamSpec; source: "enum" | "semantic" }[];
  // Semua slot enum / date_range yang sudah terisi (regex di atas / semantic fallback di sini)
  // masuk ke enumParams agar dispatcher memiliki label sumber + filter yang valid.
  const enumSpecs = specs.filter((s) => ((s.mode ?? null) === "enum" || s.mode === "date_range") && extraction.enumValues[s.key]);
  const enumParams = enumSpecs.map((spec) => {
    const fb = enumFallbacks.find((r) => r.spec === spec);
    return { spec, values: [] as MasterItem[], source: (fb ? fb.source : "enum") as "enum" | "semantic" };
  });

  // --- mode "search": fetch entity by token ke endpoint (HTTP + Redis cache) ---
  // Hanya menembak token yang BELUM terpakai oleh master list (misal: "8b" sudah terpakai
  // sebagai kelas_id, maka tidak akan ditembak ke /api/siswa?q=8b).
  const searchWork = searchParams.map(async (spec) => {
    if (spec.hint_regex && !testRegexSafe(spec.hint_regex, extraction.query)) {
      if (rTrace) rTrace.token_exclusion.skipped_calls.push(`${spec.key} (hint_regex mismatch)`);
      return null;
    }
    if (extraction.tokens.length === 0) return null;

    // Filter token: buang token yang sudah teridentifikasi sebagai kelas/mapel
    const availableTokens = extraction.tokens.filter((t) => !consumedTokens.has(norm(t)));
    if (availableTokens.length === 0) {
      if (rTrace) rTrace.token_exclusion.skipped_calls.push(`${spec.key} (0 unassigned tokens left - token exclusion)`);
      return null;
    }

    // Cap 3 token distinct per param (anti-bombardir endpoint utk kalimat panjang)
    const seen = new Set<string>();
    const uniqueTokens = availableTokens.filter((t) => {
      const key = norm(t);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 3);

    const results = await Promise.all(
      uniqueTokens.map((t) => lazySearch(spec.endpoint!, spec.query_param || "q", spec.key, t, ctx.clientId, ctx.role, ctx.auth, DEFAULT_TTL, traceOps).catch(() => {
        markDegraded();
        return [] as MasterItem[];
      }))
    );
    const merged = [...new Map(results.flat().map((item) => [item.id + item.name, item])).values()].slice(0, maxPerParam);
    if (merged.length === 0) return null;
    return { spec, values: merged, source: "search" as const };
  });

  const resolvedSearches = (await Promise.all(searchWork)).filter(Boolean) as ResolvedParam[];
  out.push(...resolvedLists, ...resolvedSearches, ...enumParams);

  if (rTrace) {
    rTrace.token_exclusion.consumed = [...consumedTokens];
    rTrace.token_exclusion.remaining = extraction.tokens.filter((t) => !consumedTokens.has(norm(t)));
  }

  // --- Slot "academic_year_id": utamakan tahun eksplisit (mis. "2024/2025") sebelum relative active context ---
  const aySpec = specs.find((s) => s.key === "academic_year_id");
  const explicitYearMatch = extraction.query.match(/\b(\d{4}\/\d{4})\b/);

  if (aySpec && aySpec.endpoint && explicitYearMatch) {
    // Explicit tahun (mis. "2024/2025") → match dari master API
    try {
      const items = await lazyList(aySpec.endpoint, aySpec.key, ctx.clientId, ctx.role, ctx.auth, DEFAULT_TTL, traceOps);
      const found = items.filter((i) => norm(i.name) === norm(explicitYearMatch[1]));
      if (found.length > 0) out.push({ spec: aySpec, values: found, source: "exact" });
    } catch {
      markDegraded();
    }
  } else if (aySpec && aySpec.endpoint && extraction.timeHints.tahun_ajaran_lalu) {
    // "tahun ajaran lalu" -> the year right after the active one (master list is newest first)
    try {
      const items = await lazyList(aySpec.endpoint, aySpec.key, ctx.clientId, ctx.role, ctx.auth, DEFAULT_TTL, traceOps);
      const activeIdx = items.findIndex((i) => i.is_active === 1);
      const previous = activeIdx >= 0 ? items[activeIdx + 1] : undefined;
      if (previous) out.push({ spec: aySpec, values: [previous], source: "exact" });
    } catch {
      markDegraded();
    }
  } else if (aySpec && aySpec.endpoint && (extraction.timeHints.tahun_ajaran_ini || extraction.timeHints.tahun_ini) && ctx.activeContext?.academic_year_id) {
    out.push({
      spec: aySpec,
      values: [{ id: ctx.activeContext.academic_year_id, name: ctx.activeContext.tahun_ajaran || "", raw: { is_active: 1 } }],
      source: "active_context",
    });
  } else if (aySpec && aySpec.endpoint && extraction.timeHints.tahun_ajaran_ini) {
    // "tahun ajaran ini" tapi active_context kosong → fallback: master API is_active=1
    try {
      const items = await lazyList(aySpec.endpoint, aySpec.key, ctx.clientId, ctx.role, ctx.auth, DEFAULT_TTL, traceOps);
      const active = items.filter((i) => i.is_active === 1);
      if (active.length > 0) out.push({ spec: aySpec, values: active, source: "exact" });
    } catch {
      markDegraded();
    }
  }

  if (rTrace) {
    for (const r of out) {
      rTrace.resolved_params[r.spec.key] = r.values.map((v) => ({ id: v.id, name: v.name }));
    }
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
  const fuzzyFields = [...fields]; // codes/ids are too short for typo matching
  if (spec.key === "kelas_id") fields.push((i) => i.code || "", (i) => i.id);

  // Rank each item by its best field/token match, keep only the top tier:
  // "bahasa inggris" must not also return "Bahasa Indonesia", but equal-tier ties
  // (two people named "Siti") are all kept.
  const abbrevOk = spec.key !== "kelas_id" && !spec.match_field;
  const scored: { item: MasterItem; score: number }[] = [];
  for (const item of items) {
    let score = 0;
    for (const tokenOrPhrase of [...extraction.tokens, extraction.query]) {
      for (const fn of fields) {
        score = Math.max(score, matchTier(tokenOrPhrase, fn(item)));
        if (abbrevOk && tokenOrPhrase !== extraction.query && isAbbreviation(tokenOrPhrase, fn(item))) {
          score = Math.max(score, 0.5);
        }
      }
    }
    if (score > 0) scored.push({ item, score });
  }
  if (scored.length === 0) return fuzzyMatchListItems(extraction.tokens, fuzzyFields, items);
  const best = Math.max(0, ...scored.map((s) => s.score));
  const top = scored.filter((s) => s.score === best).map((s) => s.item);
  if (top.length < 2) return top;
  // Tied on a shared word ("bahasa"): a leftover token no tied item contains exactly
  // ("inggirs") is a typo, so let fuzzy pick among the tied items.
  const residual = extraction.tokens.filter((tk) => {
    const t = norm(tk);
    return t.length >= 4 && /^[a-z]+$/.test(t) && !top.some((i) => fuzzyFields.some((fn) => closestWordDist(t, fn(i)) === 0));
  });
  const narrowed = residual.length > 0 ? fuzzyMatchListItems(residual, fuzzyFields, top) : [];
  return narrowed.length > 0 ? narrowed : top;
}

// Last resort when nothing matched exactly: typo tolerance ("matematka", "sitti" vs wali "Siti").
// Only tokens of 4+ letters, and only the nearest distance is kept (ties all shown).
function fuzzyMatchListItems(tokens: string[], fields: ((i: MasterItem) => string)[], items: MasterItem[]): MasterItem[] {
  const scored: { item: MasterItem; dist: number }[] = [];
  for (const item of items) {
    let dist = Infinity;
    for (const token of tokens) {
      const t = norm(token);
      if (t.length < 4 || !/^[a-z]+$/.test(t)) continue;
      for (const fn of fields) {
        const d = closestWordDist(t, fn(item));
        if (d <= fuzzyMaxDist(t)) dist = Math.min(dist, d);
      }
    }
    if (dist < Infinity) scored.push({ item, dist });
  }
  const best = Math.min(Infinity, ...scored.map((s) => s.dist));
  return scored.filter((s) => s.dist === best).map((s) => s.item);
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
