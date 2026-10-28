import React from "react";
import { useCurrentFrame } from "remotion";

export const Typewriter: React.FC<{ text: string; start?: number; charsPerFrame?: number }> = ({
  text,
  start = 0,
  charsPerFrame = 0.6,
}) => {
  const frame = useCurrentFrame();
  const n = Math.max(0, Math.floor((frame - start) * charsPerFrame));
  return <span>{text.slice(0, n)}</span>;
};
