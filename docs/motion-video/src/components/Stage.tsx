import React from "react";
import { AbsoluteFill } from "remotion";
import { ActorDiagram } from "./ActorDiagram";
import { font, theme } from "../theme";

// Full-frame scene shell: title on top, free content, actor diagram in the corner.
export const Stage: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <AbsoluteFill className="px-20 pt-14" style={{ background: theme.bg, color: theme.text, fontFamily: font }}>
    <div className="mb-10 text-6xl font-bold">{title}</div>
    {children}
    <ActorDiagram mode="corner" />
  </AbsoluteFill>
);
