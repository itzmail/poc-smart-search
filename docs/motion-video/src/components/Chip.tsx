import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";

type Tone = "default" | "ok" | "warn" | "bad";
const tones: Record<Tone, string> = { default: theme.accent, ok: theme.ok, warn: theme.warn, bad: theme.bad };

// Pops in at `delay` frames. Used for filter chips like status=nunggak.
export const Chip: React.FC<{ label: string; tone?: Tone; delay?: number }> = ({ label, tone = "default", delay = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 14 } });
  const c = tones[tone];
  return (
    <span
      className="inline-block rounded-full border-2 px-5 py-2 font-mono text-4xl"
      style={{ color: c, borderColor: c, background: `${c}1a`, transform: `scale(${s})`, opacity: s }}
    >
      {label}
    </span>
  );
};
