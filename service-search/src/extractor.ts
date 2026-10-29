// ---------------------------------------------------------------------------
// RAW EXTRACTION (Route-Scoped, Data-Driven dari ParamSpec)
// Regex 0ms + trigger detection. Nilai enum & token kandidat diekstrak di sini;
// pencocokan ke data master (lazy fetch + Redis) dilakukan di lazy-resolver.
// ---------------------------------------------------------------------------
import type { AppRoute, ParamSpec } from "./routes-sync.js";
import { normalizeQuery } from "./normalize.js";
import { MONTHS, resolveMonthRange } from "./date-range.js";

export interface RawExtraction {
  query: string;                    // kalimat asli (lowercased)
  tokens: string[];                 // kandidat token nama entitas (siswa/kelas/subject/dll)
  enumValues: Record<string, string>; // paramKey (mode enum) -> label value yg cocok
  timeHints: {
    hari_ini: boolean;
    bulan_ini: boolean;
    tahun_ini: boolean;             // "tahun ini"
    tahun_ajaran_ini: boolean;      // "tahun ajaran ini" / "tahun pelajaran ini"
    tahun_ajaran_lalu: boolean;     // "tahun ajaran lalu" / "sebelumnya" / "kemarin"
  };
}

// Generic Indonesian function words only. Domain words (siswa, kelas, spp, nunggak, ...) come from
// the route manifest via buildDomainVocab, so another app only has to change its data.
const BASE_STOPWORDS = new Set([
  "aku", "ingin", "yang", "dan", "dari", "mana", "saja", "bisa", "buat", "lihat", "cek",
  "ini", "itu", "belum", "sudah", "bulan", "hari", "tahun", "ajaran", "pelajaran",
  "semua", "daftar", "total", "berapa", "tolong", "tunjukkan", "buka", "data", "siapa", "apakah",
  "untuk", "pada", "dengan", "oleh", "kepada", "semester", "ada", "di", "ke", "the", "apa",
  "ibu", "bapak", "anak", "bernama", "adalah", "bertanya", "atas", "nama", "bu", "pak", "sebelumnya",
  "minggu", "kemarin", "lalu", "sekarang", "berjalan", "udah", "yg", "milik", "punya",
  ...MONTHS, // month names are time words, never entity candidates
]);

export interface DomainVocab {
  stopwords: Set<string>;
  entityAnchors: string[]; // words that introduce an entity name ("siswa budi")
  listAnchors: string[];   // words that introduce a master-list item ("kelas 7a")
  enumWords: string[];     // literal words of enum values / hint regexes
}

const wordsOf = (s: string): string[] => s.toLowerCase().match(/[a-z]{3,}/g) ?? [];
const regexWords = (rx: string): string[] => wordsOf(rx.replace(/\\./g, " "));
const resourceOf = (endpoint?: string): string => (endpoint ?? "").split("/").filter(Boolean).pop() ?? "";

// Single-word keywords of the routes that list `resource` as a standalone keyword
// (route "siswa" -> siswa, murid, santri, ...): the tenant's own names for that entity.
function anchorsFor(routes: AppRoute[], resource: string): string[] {
  if (!/^[a-z]+$/.test(resource)) return [];
  const out = new Set<string>([resource]);
  for (const r of routes) {
    const kws = r.keywords.map((k) => k.toLowerCase().trim());
    if (!kws.includes(resource)) continue;
    for (const k of kws) if (/^[a-z]{3,}$/.test(k)) out.add(k);
  }
  return [...out];
}

export function buildDomainVocab(routes: AppRoute[] = []): DomainVocab {
  const stopwords = new Set<string>(BASE_STOPWORDS);
  const enumWords = new Set<string>();
  const entity = new Set<string>();
  const list = new Set<string>();
  for (const r of routes) {
    for (const w of [...r.keywords.flatMap(wordsOf), ...wordsOf(r.title)]) stopwords.add(w);
    for (const spec of r.allowed_params || []) {
      if (spec.hint_regex) for (const w of regexWords(spec.hint_regex)) enumWords.add(w);
      if (spec.mode === "enum" && spec.values) {
        for (const rx of Object.values(spec.values)) for (const w of regexWords(rx)) enumWords.add(w);
      }
      if (spec.mode === "search") for (const w of anchorsFor(routes, resourceOf(spec.endpoint))) entity.add(w);
      if ((spec.mode ?? "list") === "list" && spec.endpoint) for (const w of anchorsFor(routes, resourceOf(spec.endpoint))) list.add(w);
    }
  }
  for (const w of enumWords) stopwords.add(w);
  for (const w of [...entity, ...list]) stopwords.add(w);
  return { stopwords, entityAnchors: [...entity], listAnchors: [...list], enumWords: [...enumWords] };
}

// Extract kandidat token kontekstual (mengikat kata setelah kata penunjuk entitas)
function extractTokens(query: string, vocab: DomainVocab): string[] {
  const lower = query.toLowerCase();
  const tokens: string[] = [];
  const stop = vocab.stopwords;
  const alt = (ws: string[]) => ws.map((w) => w.replace(/[^a-z0-9]/g, "")).filter(Boolean).join("|");

  // 1. Contextual anchors: ambil nama tepat setelah kata penunjuk entitas (dari manifest + kata umum)
  const entityAlt = alt([...vocab.entityAnchors, "anak"]);
  const stopAlt = alt([...vocab.listAnchors, ...vocab.enumWords, "semester"]);
  const studentPattern = new RegExp(
    `(?:${entityAlt}|atas\\s+nama|nama)\\s+(?:bernama\\s+)?([a-z0-9\\s]+?)(?:\\s+(?:ada|di|yang|belum|sudah${stopAlt ? "|" + stopAlt : ""})\\b|\\s*$)`,
    "i"
  );
  const studentMatch = query.match(studentPattern);
  if (studentMatch?.[1]) {
    const candidate = studentMatch[1].trim();
    // Reject phrases that contain any stopword ("kelas 7a", "nunggak"): only clean names qualify
    if (candidate.length >= 2 && !candidate.toLowerCase().split(/\s+/).some((w) => stop.has(w))) {
      tokens.push(candidate);
    }
  }

  // 2. Contextual anchors: ambil kode/nama item master tepat setelah kata penunjuknya (mis. "kelas 7a")
  if (vocab.listAnchors.length > 0) {
    const classMatch = query.match(new RegExp(`(?:${alt(vocab.listAnchors)})\\s+([a-z0-9-]+)`, "i"));
    if (classMatch?.[1]) {
      const candidate = classMatch[1].trim();
      if (!stop.has(candidate.toLowerCase())) {
        tokens.push(candidate);
      }
    }
  }

  // 3. Token individual (>=2 char & mengandung huruf — agar token seperti "8b" atau nama bebas tidak hilang)
  for (const w of lower.split(/\s+/)) {
    const clean = w.replace(/[^a-z0-9]/gi, "");
    if (clean.length >= 2 && /[a-z]/.test(clean) && !stop.has(clean)) {
      tokens.push(clean);
    }
  }

  // dedup case-insensitive
  const seen = new Set<string>();
  return tokens.filter((t) => {
    const k = t.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export interface ExtractionAudit {
  regexMatches: Array<{ param: string; matched_value: string; matched_phrase?: string; rule: string }>;
  stopwordsFiltered: string[];
}

export function extractRawParams(
  query: string,
  allowedParams: ParamSpec[] = [],
  audit?: ExtractionAudit,
  ctx: { routes?: AppRoute[]; referenceDate?: string } = {}
): RawExtraction {
  const vocab = buildDomainVocab(ctx.routes);
  const lower = normalizeQuery(query);
  const enumValues: Record<string, string> = {};

  // mode enum & date_range: cek setiap frasa regex (negation-aware: nilai label di DB, bukan hardcode)
  for (const spec of allowedParams) {
    if (((spec.mode ?? null) !== "enum" && spec.mode !== "date_range") || !spec.values) continue;
    for (const [valueKey, regexStr] of Object.entries(spec.values)) {
      // Guard: regex DB salah format -> skip value ini, jangan crash
      try {
        if (enumValues[spec.key]) continue; // first-match-wins (urutan JSON = prioritas)
        const rx = new RegExp(regexStr, "i");
        const match = lower.match(rx);
        if (match) {
          enumValues[spec.key] = valueKey;
          if (audit) {
            audit.regexMatches.push({
              param: spec.key,
              matched_value: valueKey,
              matched_phrase: match[0],
              rule: regexStr,
            });
          }
        }
      } catch {
        console.warn(`[extractor] Invalid regex for ${spec.key}=${valueKey}: ${regexStr}`);
      }
    }
  }

  // mode date_month: nomor bulan 1-12; spec pertama = awal, kedua = akhir (urutan di manifest)
  const monthSpecs = allowedParams.filter((s) => s.mode === "date_month");
  if (monthSpecs.length > 0) {
    const months = resolveMonthRange(lower, ctx.referenceDate);
    if (months) monthSpecs.forEach((spec, i) => (enumValues[spec.key] = String(months[Math.min(i, 1)])));
  }

  // Slot waktu: "tahun ajaran ini" vs "tahun ini" vs "bulan ini" vs "hari ini"
  const timeHints = {
    hari_ini: /\b(hari\s*ini)\b/i.test(lower),
    bulan_ini: /\b(bulan\s*(ini|berjalan))\b/i.test(lower),
    tahun_ini: /\btahun\s*ini\b/i.test(lower) && !/\btahun\s*(ajaran|pelajaran)\s*ini\b/i.test(lower),
    tahun_ajaran_ini:
      !/\b\d{4}\/\d{4}\b/.test(lower) &&
      (/\btahun\s*(ajaran|pelajaran)\s*(sekarang\s*)?(ini|saat\s*ini|aktif)\b/i.test(lower) ||
       /\bth(a)?n\??\s*(ajaran|pelajar\s*an|ajar)\s*(ini|sekarang|saat\s*ini|aktif)\b/i.test(lower)) &&
      // Guard: "tahun ajaran lalu/kemarin" => memang tahun ajaran LAMPAU, bukan context aktif
      !/\b(tahun|th(a)?n\??)\s*(ajaran|pelajar(?:an)|ajar)\s*(lalu|kemarin|sebelumnya)\b/i.test(lower),
    tahun_ajaran_lalu:
      !/\b\d{4}\/\d{4}\b/.test(lower) &&
      /\b(tahun|th(a)?n\??)\s*(ajaran|pelajaran|ajar)\s*(lalu|kemarin|sebelumnya)\b/i.test(lower),
  };

  const parsedTokens = extractTokens(lower, vocab);
  if (audit) {
    // Cari token yang disaring stopword
    const allWords = lower.replace(/[^a-z0-9\s]/gi, " ").split(/\s+/).filter(Boolean);
    audit.stopwordsFiltered = allWords.filter((w) => vocab.stopwords.has(w) && !parsedTokens.includes(w));
  }

  return {
    query: lower,
    tokens: parsedTokens,
    enumValues,
    timeHints,
  };
}
