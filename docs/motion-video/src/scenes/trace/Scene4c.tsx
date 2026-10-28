import React from "react";
import { useCurrentFrame } from "remotion";
import { Stage } from "../../components/Stage";
import { fadeAt } from "../../components/fade";
import { mono, theme } from "../../theme";

type W = { t: string; kind: "stop" | "used" | "cand" | "class" };
const WORDS: W[] = [
  { t: "siapa", kind: "stop" },
  { t: "yang", kind: "stop" },
  { t: "belum bayar", kind: "used" },
  { t: "minggu ini", kind: "used" },
  { t: "untuk", kind: "stop" },
  { t: "kelas", kind: "class" },
  { t: "8b", kind: "cand" },
];

const Rule: React.FC<{ n: string; text: string; at: number }> = ({ n, text, at }) => {
  const frame = useCurrentFrame();
  return (
    <div className="flex gap-6 text-4xl" style={{ opacity: fadeAt(frame, at) }}>
      <span style={{ color: theme.accent }}>{n}</span>
      <span>{text}</span>
    </div>
  );
};

// Seconds synced to scene4c.mp3: chunks 3.6, three paths 8.1/14.2/20.6/25.4, stopwords 30.0, used filters 37.6, one token 42.5.
export const Scene4c: React.FC = () => {
  const frame = useCurrentFrame();
  const stopAt = 30 * 60;
  const usedAt = 37.6 * 60;
  const color = (w: W) => {
    if (w.kind === "stop" && frame >= stopAt) return theme.border;
    if (w.kind === "used" && frame >= usedAt) return theme.border;
    if (w.kind === "cand" && frame >= 20.6 * 60) return theme.ok;
    return theme.text;
  };
  return (
    <Stage title="Extractor: potong jadi kandidat">
      <div className="mb-10 flex flex-wrap gap-4" style={{ opacity: fadeAt(frame, 3.6) }}>
        {WORDS.map((w) => (
          <span key={w.t} className="rounded-xl border-2 px-6 py-3 text-5xl" style={{ fontFamily: mono, color: color(w), borderColor: color(w) === theme.border ? theme.border : theme.accent }}>
            {w.t}
          </span>
        ))}
      </div>
      <div className="flex flex-col gap-5">
        <Rule n="1" text="kata setelah siswa / murid / anak bernama → nama siswa" at={14.2} />
        <Rule n="2" text="kata setelah kelas → kode kelas (di sini: 8b)" at={20.6} />
        <Rule n="3" text="kata lain yang punya huruf → kandidat" at={25.4} />
      </div>
      <div className="mt-10 text-4xl font-bold" style={{ color: theme.ok, opacity: fadeAt(frame, 42.5) }}>
        tersisa 1 kandidat: 8b → disebut token
      </div>
    </Stage>
  );
};
