import type { ActiveContext } from "./routes-sync.js";

export interface ExtractedParams {
  kelas?: string;
  semester?: string;
  status?: string;
  mapel?: string;
  format?: string;
  nama?: string;
  // Parameter waktu relatif (hanya diekstrak jika route mengizinkan)
  periode?: "hari_ini" | "bulan_ini" | "tahun_ini";
  tahun_ajaran?: string;
}

export interface ExtractOptions {
  // Route-Scoped Lazy Extraction: hanya jalankan regex utk param yang
  // terdaftar di route.allowed_params. Tanpa opsi ini = ekstrak semua (legacy).
  allowedParams?: string[];
  // Konteks kalender akademik aktif dari app (sumber kebenaran "tahun ajaran ini")
  activeContext?: ActiveContext;
}

export function extractParams(query: string, opts: ExtractOptions = {}): ExtractedParams {
  const lower = query.toLowerCase();
  const params: ExtractedParams = {};

  const allowed = opts.allowedParams;
  const want = (key: string) => !allowed || allowed.includes(key);

  // 1. Ekstraksi Kelas (e.g. 7A, 8B, 9C, kelas 8, kelas 10)
  if (want("kelas")) {
    const classMatch = lower.match(/\b(?:kelas\s*)?([789]|1[012])\s*([a-z])?\b/i);
    if (classMatch) {
      const grade = classMatch[1];
      const section = (classMatch[2] || "").toUpperCase();
      params.kelas = section ? `${grade}${section}` : grade;
    }
  }

  // 2. Ekstraksi Semester (ganjil/1, genap/2)
  if (want("semester")) {
    if (/\b(ganjil|semester\s*1|sem\s*1|satu)\b/i.test(lower)) {
      params.semester = "ganjil";
    } else if (/\b(genap|semester\s*2|sem\s*2|dua)\b/i.test(lower)) {
      params.semester = "genap";
    }
  }

  // 3. Ekstraksi Status SPP / Siswa
  if (want("status")) {
    if (/\b(nunggak|belum\s*lunas|tertunggak|tagihan|belum\s*bayar|belum\s*belajar)\b/i.test(lower)) {
      params.status = "nunggak";
    } else if (/\b(lunas|sudah\s*bayar)\b/i.test(lower)) {
      params.status = "lunas";
    } else if (/\b(aktif)\b/i.test(lower)) {
      params.status = "aktif";
    }
  }

  // 4. Ekstraksi Mata Pelajaran (Mapel)
  if (want("mapel")) {
    if (/\b(matematika|mtk)\b/i.test(lower)) params.mapel = "Matematika";
    else if (/\b(ipa|sains)\b/i.test(lower)) params.mapel = "IPA";
    else if (/\b(ips)\b/i.test(lower)) params.mapel = "IPS";
    else if (/\b(bahasa\s*indonesia|b\.?\s*indo)\b/i.test(lower)) params.mapel = "Bahasa Indonesia";
    else if (/\b(bahasa\s*inggris|b\.?\s*inggris|english)\b/i.test(lower)) params.mapel = "Bahasa Inggris";
  }

  // 5. Ekstraksi Format Output (PDF / Excel / Print)
  if (want("format")) {
    if (/\b(pdf)\b/i.test(lower)) params.format = "pdf";
    else if (/\b(excel|xlsx|csv)\b/i.test(lower)) params.format = "excel";
    else if (/\b(cetak|print)\b/i.test(lower)) params.format = "print";
  }

  // 6. Ekstraksi Nama Siswa (e.g. "siswa budi", "atas nama ani")
  if (want("nama")) {
    const nameMatch = lower.match(/(?:siswa|nama|murid)\s+([a-z\s]+?)(?:\s+(?:kelas|semester|status)|$)/i);
    if (nameMatch) {
      const rawName = nameMatch[1].trim();
      if (rawName && !["nunggak", "lunas", "aktif"].includes(rawName)) {
        params.nama = rawName.replace(/\b\w/g, (c) => c.toUpperCase());
      }
    }
  }

  // 7. Ekstraksi Periode Waktu Relatif (dihitung dari kalender, BUKAN ditebak AI)
  if (want("periode")) {
    if (/\b(hari\s*ini)\b/i.test(lower)) {
      params.periode = "hari_ini";
    } else if (/\b(bulan\s*ini|bulan\s*berjalan)\b/i.test(lower)) {
      params.periode = "bulan_ini";
    } else if (/\b(tahun\s*ini)\b/i.test(lower)) {
      params.periode = "tahun_ini";
    }
  }

  // 8. Resolusi "tahun ajaran ini" / "semester ini" dari Active Context App
  if (want("tahun_ajaran") && opts.activeContext) {
    if (/\b(tahun\s*(ajaran|pelajaran)\s*ini)\b/i.test(lower)) {
      params.tahun_ajaran = opts.activeContext.tahun_ajaran;
      // "semester ini" ikut di-resolve dari context yang sama
    }
    if (want("semester") && /\bsemester\s*ini\b/i.test(lower) && !params.semester) {
      params.semester = opts.activeContext.semester;
    }
  }

  return params;
}
