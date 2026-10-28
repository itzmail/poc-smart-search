import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { ActorDiagram } from "../../components/ActorDiagram";
import { Typewriter } from "../../components/Typewriter";
import { fmtMs, q1, urls } from "../../data/trace";
import { font, mono, theme } from "../../theme";

const QUERY = "Siapa yang belum bayar spp minggu ini untuk kelas 8B";
const STEPS = ["Classifier", "Extractor", "Resolver", "Dispatcher"];

// Frames at 60 fps synced to scene1.mp3: query typed 1.9-4.9s, "seperempat detik" 6.5s, "link" 7.9s, "4 langkah" 12.2s.
const fade =(frame: number, at: number) => interpolate(frame, [at, at + 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

export const Scene1: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill className="px-20 pt-20" style={{ background: theme.bg, color: theme.text, fontFamily: font }}>
      <div className="rounded-2xl border-2 px-10 py-8 text-6xl" style={{ background: theme.panel, borderColor: theme.accent }}>
        <Typewriter text={QUERY} start={114} charsPerFrame={0.3} />
      </div>
      <div className="mt-10 flex flex-col gap-4" style={{ opacity: fade(frame, 474) }}>
        {urls.map((u, i) => (
          <div key={u} className="truncate text-3xl" style={{ fontFamily: mono, color: i === 0 ? theme.ok : theme.muted }}>
            {u}
          </div>
        ))}
      </div>
      <div
        className="mt-10 w-fit rounded-full px-10 py-3 text-6xl font-bold"
        style={{ opacity: fade(frame, 384), background: theme.panel, color: theme.warn, fontFamily: mono }}
      >
        {fmtMs(q1.meta.latency_ms)}
      </div>
      <div className="mt-14 flex gap-8">
        {STEPS.map((s, i) => (
          <div
            key={s}
            className="flex h-40 w-80 flex-col items-center justify-center rounded-2xl border-2 border-dashed text-3xl"
            style={{ opacity: fade(frame, 732 + i * 20), borderColor: theme.border, color: theme.muted }}
          >
            <div style={{ color: theme.accent }}>Step {i + 1}</div>
            {s}
          </div>
        ))}
      </div>
      <ActorDiagram mode="corner" />
    </AbsoluteFill>
  );
};
