import type React from "react";
import { secondsFor } from "../config";
import { Scene0 } from "./trace/Scene0";
import { Scene1 } from "./trace/Scene1";

// `seconds` overrides the word-count estimate once the real voiceover length is known.
export type SceneDef = { code: string; title: string; caption: string; words: number; seconds?: number; component?: React.FC };

// Caption text is a placeholder; the real text lives in NARASI.md.
// `words` = narration word count per scene, counted from NARASI.md.
export const traceScenes: SceneDef[] = [
  { code: "Scene 0", title: "Kenalan dengan Aktor", caption: "Enam aktor di balik Smart Search.", words: 162, component: Scene0 },
  { code: "Scene 1", title: "Hook", caption: "Satu kalimat jadi link dalam 250 ms.", words: 28, component: Scene1 },
  { code: "Scene 2", title: "Pintu Masuk", caption: "Gate: header, batas input, rate limit.", words: 34 },
  { code: "Scene 3", title: "Step 1: Classifier", caption: "Route spp, DIRECT_LINK, 0,95 HIGH.", words: 50 },
  { code: "Scene 4a", title: "Extractor: Rapikan Kalimat", caption: "delapan b / VIII B menjadi 8b.", words: 42 },
  { code: "Scene 4b", title: "Extractor: Nilai Pasti", caption: "Regex dari database: status, periode.", words: 49 },
  { code: "Scene 4b+", title: "Extractor: Kalau Regex Tidak Kena", caption: "transformers.js: skor ≥ 0,65 dan selisih ≥ 0,04.", words: 60 },
  { code: "Scene 4c", title: "Extractor: Potong Jadi Kandidat", caption: "Chunking, stopword, token 8b.", words: 111 },
  { code: "Scene 4d", title: "Extractor: Jangan Menebak", caption: "RawExtraction diserahkan ke Resolver.", words: 46 },
  { code: "Scene 5a", title: "Resolver: Jawaban di Data", caption: "Daftar kecil dulu, pencarian besar belakangan.", words: 34 },
  { code: "Scene 5b", title: "Resolver: Cek Daftar Kelas", caption: "Redis HIT, 8b menjadi K-08B.", words: 34 },
  { code: "Scene 5c", title: "Resolver: Lewati Siswa", caption: "Token exclusion: 0 token tersisa.", words: 49 },
  { code: "Scene 6", title: "Step 4: Dispatcher", caption: "URL akhir dan skor.", words: 45 },
  { code: "Scene 7", title: "Ringkasan", caption: "Empat step, satu link.", words: 29 },
  { code: "Scene A", title: "Kasus Sity", caption: "Prefix-truncation sity → sit.", words: 86 },
  { code: "Scene B", title: "Kasus Santai", caption: "transformers.js menolak menebak.", words: 90 },
];

export const hardeningScenes: SceneDef[] = [
  { code: "H1", title: "Auth", caption: "Tanpa header → 401.", words: 41 },
  { code: "H2", title: "Batas Input & Rate Limit", caption: "q ≤ 200, body ≤ 4 KB, 120 rpm.", words: 51 },
  { code: "H3", title: "Sistem Sakit", caption: "Segar → stale → tanpa filter + degraded.", words: 92 },
  { code: "H4", title: "ACL", caption: "Manifest kosong berarti nol route.", words: 52 },
  { code: "H5", title: "Yang Belum", caption: "ACL endpoint data mock belum ditegakkan.", words: 42 },
];

export const durations = (scenes: SceneDef[], fps: number) =>
  scenes.map((s) => (s.seconds ?? secondsFor(s.words)) * fps);
