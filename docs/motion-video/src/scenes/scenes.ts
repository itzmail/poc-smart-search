import type React from "react";
import { secondsFor } from "../config";
import { H1 } from "./hardening/H1";
import { H2 } from "./hardening/H2";
import { H3 } from "./hardening/H3";
import { H4 } from "./hardening/H4";
import { H5 } from "./hardening/H5";
import { Scene0 } from "./trace/Scene0";
import { Scene1 } from "./trace/Scene1";
import { Scene2 } from "./trace/Scene2";
import { Scene3 } from "./trace/Scene3";
import { Scene4a } from "./trace/Scene4a";
import { Scene4b } from "./trace/Scene4b";
import { Scene4bPlus } from "./trace/Scene4bPlus";
import { Scene4c } from "./trace/Scene4c";
import { Scene4d } from "./trace/Scene4d";
import { Scene5a } from "./trace/Scene5a";
import { Scene5b } from "./trace/Scene5b";
import { Scene5c } from "./trace/Scene5c";
import { Scene6 } from "./trace/Scene6";
import { Scene7 } from "./trace/Scene7";
import { SceneA } from "./trace/SceneA";
import { SceneB } from "./trace/SceneB";

// `seconds` overrides the word-count estimate once the real voiceover length is known.
export type SceneDef = { code: string; title: string; caption: string; words: number; seconds?: number; audio?: string; component?: React.FC };

// Caption text is a placeholder; the real text lives in NARASI.md.
// `words` = narration word count per scene, counted from NARASI.md.
export const traceScenes: SceneDef[] = [
  { code: "Scene 0", title: "Kenalan dengan Aktor", caption: "Enam aktor di balik Smart Search.", words: 162, seconds: 91.2, audio: "audio/scene0.mp3", component: Scene0 },
  { code: "Scene 1", title: "Hook", caption: "Satu kalimat jadi link dalam 250 ms.", words: 28, seconds: 14.4, audio: "audio/scene1.mp3", component: Scene1 },
  { code: "Scene 2", title: "Pintu Masuk", caption: "Gate: header, batas input, rate limit.", words: 34, seconds: 15.9, audio: "audio/scene2.mp3", component: Scene2 },
  { code: "Scene 3", title: "Step 1: Classifier", caption: "Route spp, DIRECT_LINK, 0,95 HIGH.", words: 50, seconds: 27.4, audio: "audio/scene3.mp3", component: Scene3 },
  { code: "Scene 4a", title: "Extractor: Rapikan Kalimat", caption: "delapan b / VIII B menjadi 8b.", words: 42, seconds: 24.7, audio: "audio/scene4a.mp3", component: Scene4a },
  { code: "Scene 4b", title: "Extractor: Nilai Pasti", caption: "Regex dari database: status, periode.", words: 49, seconds: 27.7, audio: "audio/scene4b.mp3", component: Scene4b },
  { code: "Scene 4b+", title: "Extractor: Kalau Regex Tidak Kena", caption: "transformers.js: skor ≥ 0,65 dan selisih ≥ 0,04.", words: 60, seconds: 30.8, audio: "audio/scene4b+.mp3", component: Scene4bPlus },
  { code: "Scene 4c", title: "Extractor: Potong Jadi Kandidat", caption: "Chunking, stopword, token 8b.", words: 111, seconds: 50.5, audio: "audio/scene4c.mp3", component: Scene4c },
  { code: "Scene 4d", title: "Extractor: Jangan Menebak", caption: "RawExtraction diserahkan ke Resolver.", words: 46, seconds: 25.0, audio: "audio/scene4d.mp3", component: Scene4d },
  { code: "Scene 5a", title: "Resolver: Jawaban di Data", caption: "Daftar kecil dulu, pencarian besar belakangan.", words: 34, seconds: 20.2, audio: "audio/scene5a.mp3", component: Scene5a },
  { code: "Scene 5b", title: "Resolver: Cek Daftar Kelas", caption: "Redis HIT, 8b menjadi K-08B.", words: 34, seconds: 20.9, audio: "audio/scene5b.mp3", component: Scene5b },
  { code: "Scene 5c", title: "Resolver: Lewati Siswa", caption: "Token exclusion: 0 token tersisa.", words: 49, seconds: 29.5, audio: "audio/scene5c.mp3", component: Scene5c },
  { code: "Scene 6", title: "Step 4: Dispatcher", caption: "URL akhir dan skor.", words: 45, seconds: 27.2, audio: "audio/scene6.mp3", component: Scene6 },
  { code: "Scene 7", title: "Ringkasan", caption: "Empat step, satu link.", words: 29, seconds: 15.9, audio: "audio/scene7.mp3", component: Scene7 },
  { code: "Scene A", title: "Kasus Sity", caption: "Prefix-truncation sity → sit.", words: 86, seconds: 45.9, audio: "audio/sceneA.mp3", component: SceneA },
  { code: "Scene B", title: "Kasus Santai", caption: "transformers.js menolak menebak.", words: 90, seconds: 47.4, audio: "audio/sceneB.mp3", component: SceneB },
];

export const hardeningScenes: SceneDef[] = [
  { code: "H1", title: "Auth", caption: "Tanpa header → 401.", words: 41, seconds: 20.7, audio: "audio/sceneH1.mp3", component: H1 },
  { code: "H2", title: "Batas Input & Rate Limit", caption: "q ≤ 200, body ≤ 4 KB, 120 rpm.", words: 51, seconds: 28.7, audio: "audio/sceneH2.mp3", component: H2 },
  { code: "H3", title: "Sistem Sakit", caption: "Segar → stale → tanpa filter + degraded.", words: 92, seconds: 43.4, audio: "audio/sceneH3.mp3", component: H3 },
  { code: "H4", title: "ACL", caption: "Manifest kosong berarti nol route.", words: 52, seconds: 27.3, audio: "audio/sceneH4.mp3", component: H4 },
  { code: "H5", title: "Yang Belum", caption: "ACL endpoint data mock belum ditegakkan.", words: 42, seconds: 18.8, audio: "audio/sceneH5.mp3", component: H5 },
];

export const durations = (scenes: SceneDef[], fps: number) =>
  scenes.map((s) => Math.round((s.seconds ?? secondsFor(s.words)) * fps));
