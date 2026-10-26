// ---------------------------------------------------------------------------
// RAW EXTRACTION (Route-Scoped, Data-Driven dari ParamSpec)
// Regex 0ms + trigger detection. Nilai enum & token kandidat diekstrak di sini;
// pencocokan ke data master (lazy fetch + Redis) dilakukan di lazy-resolver.
// ---------------------------------------------------------------------------
import type { ParamSpec } from "./routes-sync.js";

export interface RawExtraction {
  query: string;                    // kalimat asli (lowercased)
  tokens: string[];                 // kandidat token nama entitas (siswa/kelas/subject/dll)
  enumValues: Record<string, string>; // paramKey (mode enum) -> label value yg cocok
  timeHints: {
    hari_ini: boolean;
    bulan_ini: boolean;
    tahun_ini: boolean;             // "tahun ini"
    tahun_ajaran_ini: boolean;      // "tahun ajaran ini" / "tahun pelajaran ini"
  };
}

const STOPWORDS = new Set([
  "aku", "ingin", "yang", "dan", "dari", "mana", "saja", "bisa", "buat", "lihat", "cek",
  "ini", "itu", "belum", "sudah", "bayar", "bulan", "hari", "tahun", "ajaran", "pelajaran",
  "nunggak", "lunas", "tagihan", "tunggakan", "cetak", "semua", "daftar", "rekap", "total",
  "berapa", "tolong", "tunjukkan", "buka", "data", "status", "siapa", "apakah", "aktif",
  "semester", "kelas", "ruang", "rombel", "tingkat", "ada", "di", "ke", "the", "apa",
  "wali", "guru", "ibu", "bapak", "murid", "santri", "siswa", "profil", "biodata", "adalah", "bertanya",
  "spp", "syahriah", "kas", "nilai", "rapot", "rapor", "uang", "duit", "riwayat",
  "minggu", "kemarin", "lalu", "sekarang", "berjalan", "udah", "yg", "milik", "punya", "format", "pdf", "excel",
]);

// Extract kandidat token kontekstual (mengikat kata setelah kata penunjuk entitas)
function extractTokens(query: string): string[] {
  const lower = query.toLowerCase();
  const tokens: string[] = [];

  // 1. Contextual anchors: ambil nama tepat setelah kata penunjuk peran (siswa/murid/anak/dll)
  const studentPattern = /(?:siswa|student|murid|santri|anak|atas\s+nama|nama)\s+([a-z0-9\s]+?)(?:\s+(?:ada|di|kelas|semester|status|yang|lunas|nunggak|belum|sudah|$))/i;
  const studentMatch = query.match(studentPattern);
  if (studentMatch?.[1]) {
    const candidate = studentMatch[1].trim();
    if (candidate.length >= 2 && !STOPWORDS.has(candidate.toLowerCase())) {
      tokens.push(candidate);
    }
  }

  // 2. Contextual anchors: ambil kode/nama kelas tepat setelah kata "kelas/rombel/ruang"
  const classPattern = /(?:kelas|rombel|ruang|tingkat)\s+([a-z0-9-]+)/i;
  const classMatch = query.match(classPattern);
  if (classMatch?.[1]) {
    const candidate = classMatch[1].trim();
    if (!STOPWORDS.has(candidate.toLowerCase())) {
      tokens.push(candidate);
    }
  }

  // 3. Token individual (>=2 char & mengandung huruf — agar token seperti "8b" atau nama bebas tidak hilang)
  for (const w of lower.split(/\s+/)) {
    const clean = w.replace(/[^a-z0-9]/gi, "");
    if (clean.length >= 2 && /[a-z]/.test(clean) && !STOPWORDS.has(clean)) {
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

export function extractRawParams(query: string, allowedParams: ParamSpec[] = []): RawExtraction {
  const lower = query.toLowerCase();
  const enumValues: Record<string, string> = {};

  // mode enum: cek setiap frasa regex (negation-aware: nilai label di DB, bukan hardcode)
  for (const spec of allowedParams) {
    if ((spec.mode ?? null) !== "enum" || !spec.values) continue;
    for (const [valueKey, regexStr] of Object.entries(spec.values)) {
      // Guard: regex DB salah format -> skip value ini, jangan crash
      try {
        if (enumValues[spec.key]) continue; // first-match-wins (urutan JSON = prioritas)
        if (new RegExp(regexStr, "i").test(lower)) {
          enumValues[spec.key] = valueKey;
        }
      } catch {
        console.warn(`[extractor] Invalid regex for ${spec.key}=${valueKey}: ${regexStr}`);
      }
    }
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
  };

  return {
    query: lower,
    tokens: extractTokens(lower),
    enumValues,
    timeHints,
  };
}
