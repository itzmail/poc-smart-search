import React from "react";
import { useCurrentFrame } from "remotion";
import { Stage } from "../../components/Stage";
import { fadeAt } from "../../components/fade";
import { b1 } from "../../data/trace";
import { mono, theme } from "../../theme";

// Seconds synced to sceneB.mp3: "nunggak" 4.8, "pekan" 9.3, scores 18.5, margin 25.5, threshold 30.5, rejected 33.5, URL 39.0.
export const SceneB: React.FC = () => {
  const frame = useCurrentFrame();
  const t = b1.trace.step2_extractor.transformers_status.find((x) => x.param === "periode");
  const score = t?.score ?? 0;
  const margin = t?.margin ?? 0;
  const fmt = (n: number, d: number) => n.toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d });
  return (
    <Stage title="Kalau regex tidak kena">
      <div className="flex gap-6 text-6xl" style={{ fontFamily: mono }}>
        <span>spp</span>
        <span style={{ color: frame >= 4.8 * 60 ? theme.ok : theme.text }}>pekan</span>
        <span style={{ color: frame >= 9.3 * 60 ? theme.warn : theme.text }}>ini</span>
        <span style={{ color: frame >= 4.8 * 60 ? theme.ok : theme.text }}>yang nunggak</span>
      </div>
      <div className="mt-3 text-3xl" style={{ color: theme.muted, opacity: fadeAt(frame, 9.3) }}>regex tidak mengenal "pekan" → transformers.js menebak periode</div>
      <div className="mt-8 flex flex-col gap-4 text-4xl" style={{ fontFamily: mono }}>
        <div style={{ opacity: fadeAt(frame, 18.5) }}>skor teratas <span style={{ color: theme.ok }}>{fmt(score, 3)}</span></div>
        <div style={{ opacity: fadeAt(frame, 25.5) }}>selisih dengan kedua <span style={{ color: theme.bad }}>{fmt(margin, 3)}</span></div>
        <div style={{ opacity: fadeAt(frame, 30.5) }}>ambang selisih <span style={{ color: theme.warn }}>0,04</span></div>
      </div>
      <div className="mt-8 w-fit rounded-xl px-8 py-3 text-4xl font-bold" style={{ color: theme.bad, background: `${theme.bad}1a`, opacity: fadeAt(frame, 33.5) }}>DITOLAK: selisih terlalu kecil</div>
      <div className="mt-6 text-4xl" style={{ fontFamily: mono, color: theme.ok, opacity: fadeAt(frame, 39) }}>{b1.options[0].destination}</div>
    </Stage>
  );
};
