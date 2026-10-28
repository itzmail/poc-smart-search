import React from "react";
import { useCurrentFrame } from "remotion";
import { DurationBar } from "../../components/DurationBar";
import { Stage } from "../../components/Stage";
import { fadeAt } from "../../components/fade";
import { fmtMs, timings } from "../../data/trace";
import { theme } from "../../theme";

// Seconds synced to scene7.mp3: recap 0.5, "hampir semuanya" 5.0, "tiga langkah lain" 6.3, "classifier" 12.0.
export const Scene7: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Stage title="Rekap">
      <div className="mb-10 text-6xl font-bold" style={{ color: theme.warn, opacity: fadeAt(frame, 0.5) }}>total {fmtMs(timings.total)}</div>
      <DurationBar
        segments={[
          { label: "classifier", ms: timings.classifier, color: theme.warn },
          { label: "extractor", ms: timings.extractor, color: theme.accent },
          { label: "resolver", ms: timings.resolver, color: theme.ok },
          { label: "dispatcher", ms: timings.dispatcher, color: theme.bad },
        ]}
        grow={180}
      />
      <div className="mt-10 text-4xl" style={{ color: theme.muted, opacity: fadeAt(frame, 12) }}>mau lebih cepat? lihat classifier</div>
    </Stage>
  );
};
