// ---------------------------------------------------------------------------
// Query normalization (runs before extraction so every param sees one canonical form)
// "kelas VIII B" / "kelas delapan b" / "kelas 8 b" -> "kelas 8b"
// ---------------------------------------------------------------------------
const GRADE_WORDS: Record<string, string> = {
  satu: "1", dua: "2", tiga: "3", empat: "4", lima: "5", enam: "6",
  tujuh: "7", delapan: "8", sembilan: "9", sepuluh: "10", sebelas: "11", "dua belas": "12",
  i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6",
  vii: "7", viii: "8", ix: "9", x: "10", xi: "11", xii: "12",
};

// Longest first so "dua belas" wins over "dua"; the section letter must be a standalone a-d.
const GRADE_RX = new RegExp(
  `\\b(${Object.keys(GRADE_WORDS)
    .sort((a, b) => b.length - a.length)
    .map((k) => k.replace(" ", "\\s+"))
    .join("|")})\\s+([a-d])\\b`,
  "g"
);

export function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(GRADE_RX, (_m, grade: string, section: string) => `${GRADE_WORDS[grade.replace(/\s+/g, " ")]}${section}`)
    .replace(/\b(\d{1,2})\s+([a-d])\b/g, "$1$2");
}
