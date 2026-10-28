import React from "react";
import { AbsoluteFill } from "remotion";
import { ActorDiagram } from "../../components/ActorDiagram";
import { font, theme } from "../../theme";

// Frames at 60 fps, loosely synced to the narration order: App, service-search, JEV, transformers.js, Redis, search_routes.
const reveal = { app: 180, search: 540, jev: 1000, tfjs: 1400, redis: 1900, db: 2250, user: 2560, link: 2560 };

export const Scene0: React.FC = () => (
  <AbsoluteFill style={{ background: theme.bg, color: theme.text, fontFamily: font }}>
    <div className="absolute left-20 top-14 text-6xl font-bold">Kenalan dengan 6 aktor</div>
    <ActorDiagram mode="full" reveal={reveal} arrowsAt={2560} />
  </AbsoluteFill>
);
