export interface ExtractedParams {
  kelas?: string;
  semester?: string;
  status?: string;
  mapel?: string;
  format?: string;
  nama?: string;
}

export function extractParams(query: string): ExtractedParams {
  const lower = query.toLowerCase();
  const params: ExtractedParams = {};

  // 1. Ekstraksi Kelas (e.g. 7A, 8B, 9C, kelas 8, kelas 10)
  const classMatch = lower.match(/\b(?:kelas\s*)?([789]|1[012])\s*([a-z])?\b/i);
  if (classMatch) {
    const grade = classMatch[1];
    const section = (classMatch[2] || "").toUpperCase();
    params.kelas = section ? `${grade}${section}` : grade;
  }

  // 2. Ekstraksi Semester (ganjil/1, genap/2)
  if (/\b(ganjil|semester\s*1|sem\s*1|satu)\b/i.test(lower)) {
    params.semester = "ganjil";
  } else if (/\b(genap|semester\s*2|sem\s*2|dua)\b/i.test(lower)) {
    params.semester = "genap";
  }

  // 3. Ekstraksi Status SPP / Siswa
  if (/\b(nunggak|belum\s*lunas|tertunggak|tagihan|belum\s*bayar)\b/i.test(lower)) {
    params.status = "nunggak";
  } else if (/\b(lunas|sudah\s*bayar)\b/i.test(lower)) {
    params.status = "lunas";
  } else if (/\b(aktif)\b/i.test(lower)) {
    params.status = "aktif";
  }

  // 4. Ekstraksi Mata Pelajaran (Mapel)
  if (/\b(matematika|mtk)\b/i.test(lower)) params.mapel = "Matematika";
  else if (/\b(ipa|sains)\b/i.test(lower)) params.mapel = "IPA";
  else if (/\b(ips)\b/i.test(lower)) params.mapel = "IPS";
  else if (/\b(bahasa\s*indonesia|b\.?\s*indo)\b/i.test(lower)) params.mapel = "Bahasa Indonesia";
  else if (/\b(bahasa\s*inggris|b\.?\s*inggris|english)\b/i.test(lower)) params.mapel = "Bahasa Inggris";

  // 5. Ekstraksi Format Output (PDF / Excel / Print)
  if (/\b(pdf)\b/i.test(lower)) params.format = "pdf";
  else if (/\b(excel|xlsx|csv)\b/i.test(lower)) params.format = "excel";
  else if (/\b(cetak|print)\b/i.test(lower)) params.format = "print";

  // 6. Ekstraksi Nama Siswa (e.g. "siswa budi", "atas nama ani")
  const nameMatch = lower.match(/(?:siswa|nama|murid)\s+([a-z\s]+?)(?:\s+(?:kelas|semester|status)|$)/i);
  if (nameMatch) {
    const rawName = nameMatch[1].trim();
    if (rawName && !["nunggak", "lunas", "aktif"].includes(rawName)) {
      params.nama = rawName.replace(/\b\w/g, (c) => c.toUpperCase());
    }
  }

  return params;
}
