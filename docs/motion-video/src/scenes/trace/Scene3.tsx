import React from "react";
import { useCurrentFrame } from "remotion";
import { Chip } from "../../components/Chip";
import { DurationBar } from "../../components/DurationBar";
import { StepLayout } from "../../components/StepLayout";
import { fadeAt } from "../../components/fade";
import { fmtMs, q1, timings } from "../../data/trace";
import { mono, theme } from "../../theme";

const ROUTES = ["dashboard", "siswa", "nilai", "spp", "rapot", "kelas", "guru"];

// Seconds synced to scene3.mp3: result 6.2, 95% 8.4, backup 11.8, duration bar 17.0, "filter belum" 24.0.
export const Scene3: React.FC = () => {
  const frame = useCurrentFrame();
  const rest = timings.total - timings.classifier;
  return (
    <StepLayout
      step={1}
      title="Classifier"
      ms={timings.classifier}
      input={
        <div className="flex flex-wrap gap-3">
          {ROUTES.map((r) => (
            <span key={r} className="rounded-full border-2 px-5 py-2 text-3xl" style={{ fontFamily: mono, borderColor: r === "spp" && frame > 372 ? theme.ok : theme.border, color: r === "spp" && frame > 372 ? theme.ok : theme.muted }}>
              {r}
            </span>
          ))}
        </div>
      }
      process={
        <div className="flex flex-col gap-6">
          <div style={{ opacity: fadeAt(frame, 11.8) }} className="rounded-xl border-2 border-dashed px-6 py-4 text-3xl" >
            <span style={{ color: theme.warn }}>cadangan:</span> JEV gagal / lambat → transformers.js
          </div>
          <div style={{ opacity: fadeAt(frame, 17) }}>
            <DurationBar segments={[{ label: "classifier", ms: timings.classifier, color: theme.warn }, { label: "sisanya", ms: rest, color: theme.accent }]} />
          </div>
        </div>
      }
      output={
        <div className="flex flex-col gap-4" style={{ opacity: fadeAt(frame, 6.2) }}>
          <div className="text-4xl font-bold" style={{ fontFamily: mono, color: theme.ok }}>route: {q1.target_route}</div>
          <div className="text-3xl" style={{ fontFamily: mono, color: theme.muted }}>DIRECT_LINK</div>
          <div style={{ opacity: fadeAt(frame, 8.4) }}><Chip label="0.95 HIGH" tone="ok" delay={504} /></div>
          <div className="mt-4 text-3xl" style={{ opacity: fadeAt(frame, 24), color: theme.warn }}>halaman jelas, filter belum</div>
        </div>
      }
    />
  );
};
