import { interpolate } from "remotion";

// Opacity 0 -> 1 over 20 frames starting at second `sec` (60 fps). Scene timestamps come from Whisper word times.
export const fadeAt = (frame: number, sec: number) =>
  interpolate(frame, [sec * 60, sec * 60 + 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
