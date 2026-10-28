import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

type Props = { code: string; title: string; caption: string };

// Placeholder scene: real visuals replace this scene by scene.
export const SceneCard: React.FC<Props> = ({ code, title, caption }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 } });
  const opacity = interpolate(enter, [0, 1], [0, 1]);

  return (
    <AbsoluteFill
      style={{
        background: "#0b1020",
        color: "#e6edf7",
        fontFamily: "Inter, system-ui, sans-serif",
        justifyContent: "center",
        alignItems: "center",
        opacity,
      }}
    >
      <div style={{ fontSize: 36, color: "#7aa2f7", marginBottom: 16 }}>{code}</div>
      <div style={{ fontSize: 84, fontWeight: 700 }}>{title}</div>
      <div style={{ position: "absolute", bottom: 90, maxWidth: 1500, fontSize: 40, textAlign: "center", color: "#a9b7d0" }}>
        {caption}
      </div>
    </AbsoluteFill>
  );
};
