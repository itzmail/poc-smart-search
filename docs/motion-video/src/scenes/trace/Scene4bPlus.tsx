import React from "react";
import { useCurrentFrame } from "remotion";
import { Stage } from "../../components/Stage";
import { fadeAt } from "../../components/fade";
import { mono, theme } from "../../theme";

const Layer: React.FC<{ name: string; state: string; color: string; at: number }> = ({ name, state, color, at }) => {
  const frame = useCurrentFrame();
  return (
    <div className="flex items-center justify-between rounded-2xl border-2 px-10 py-6 text-5xl" style={{ borderColor: color, opacity: fadeAt(frame, at), background: `${color}14` }}>
      <span style={{ fontFamily: mono }}>{name}</span>
      <span className="font-bold" style={{ color }}>{state}</span>
    </div>
  );
};

// Seconds synced to scene4b+.mp3: layer 2 appears 5.2, rules 10.5, regex hit 19.0, standby 24.4.
export const Scene4bPlus: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Stage title="Extractor: kalau regex tidak kena">
      <div className="flex flex-col gap-6">
        <Layer name="Lapis 1 · regex" state="✓ kena" color={theme.ok} at={0.5} />
        <Layer name="Lapis 2 · transformers.js" state={frame >= 24.4 * 60 ? "STANDBY · tidak dipanggil" : "banding makna"} color={frame >= 24.4 * 60 ? theme.muted : theme.accent} at={5.2} />
      </div>
      <div className="mt-10 flex gap-8 text-4xl" style={{ fontFamily: mono, opacity: fadeAt(frame, 10.5) }}>
        <span className="rounded-xl px-6 py-3" style={{ background: theme.panel, color: theme.warn }}>skor ≥ 0,65</span>
        <span className="rounded-xl px-6 py-3" style={{ background: theme.panel, color: theme.warn }}>selisih ≥ 0,04</span>
      </div>
      <div className="mt-8 text-4xl" style={{ color: theme.muted, opacity: fadeAt(frame, 15.2) }}>
        dua pilihan sama kuat → tidak menembak. Lebih baik tanpa filter.
      </div>
    </Stage>
  );
};
