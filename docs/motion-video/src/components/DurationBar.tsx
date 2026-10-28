import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { fmtMs } from "../data/trace";
import { theme } from "../theme";

export type Segment = { label: string; ms: number; color: string };

// Stacked bar, widths proportional to ms. Grows left to right over `grow` frames.
export const DurationBar: React.FC<{ segments: Segment[]; grow?: number }> = ({ segments, grow = 45 }) => {
  const frame = useCurrentFrame();
  const total = segments.reduce((a, s) => a + s.ms, 0);
  const p = interpolate(frame, [0, grow], [0, 1], { extrapolateRight: "clamp" });
  return (
    <div className="w-full">
      <div className="flex h-24 w-full overflow-hidden rounded-xl" style={{ background: theme.panel }}>
        {segments.map((s) => (
          <div key={s.label} style={{ width: `${(s.ms / total) * 100 * p}%`, background: s.color }} />
        ))}
      </div>
      <div className="mt-6 flex flex-wrap gap-x-10 gap-y-2 font-mono text-3xl">
        {segments.map((s) => (
          <span key={s.label} style={{ color: s.color }}>
            {s.label} {fmtMs(s.ms)}
          </span>
        ))}
      </div>
    </div>
  );
};
