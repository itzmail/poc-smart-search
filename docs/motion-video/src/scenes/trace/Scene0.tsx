import React from "react";
import { AbsoluteFill } from "remotion";
import { ActorDiagram } from "../../components/ActorDiagram";
import { font, theme } from "../../theme";

// Frames at 60 fps (seconds * 60), synced to scene0.mp3 word timestamps; each card appears ~0.3s before its name is spoken.
// App 6.3s, service-search 19.4s, JEV 27.6s, transformers.js 36.6s, Redis 55.9s, search_routes 63.6s, flow recap 76.0s.
const reveal = { app: 378, search: 1164, jev: 1656, tfjs: 2196, redis: 3354, db: 3816, user: 4560, link: 4560 };

export const Scene0: React.FC = () => (
  <AbsoluteFill style={{ background: theme.bg, color: theme.text, fontFamily: font }}>
    <div className="absolute left-20 top-14 text-6xl font-bold">Kenalan dengan 6 aktor</div>
    <ActorDiagram mode="full" reveal={reveal} arrowsAt={4572} />
  </AbsoluteFill>
);
