import React from "react";
import { useCurrentFrame } from "remotion";
import { Stage } from "../../components/Stage";
import { fadeAt } from "../../components/fade";
import { q1 } from "../../data/trace";
import { mono, theme } from "../../theme";

// Seconds synced to scene5b.mp3: Redis 2.5, match 5.2, K-08B 10.5, "terpakai" 17.0.
export const Scene5b: React.FC = () => {
  const frame = useCurrentFrame();
  const r = q1.trace.step3_resolver;
  return (
    <Stage title="Resolver: cek daftar kelas">
      <div className="flex gap-10 text-4xl" style={{ fontFamily: mono, opacity: fadeAt(frame, 2.5) }}>
        <span className="rounded-xl px-6 py-3" style={{ background: theme.panel, color: theme.ok }}>Redis: {r.redis_operations[0].status}</span>
        <span className="rounded-xl px-6 py-3" style={{ background: theme.panel, color: theme.ok }}>http_calls: []</span>
      </div>
      <div className="mt-12 flex items-center gap-10 text-6xl" style={{ fontFamily: mono }}>
        <span style={{ opacity: fadeAt(frame, 5.2) }}>8b</span>
        <span style={{ color: theme.accent, opacity: fadeAt(frame, 8.5) }}>→</span>
        <span style={{ color: theme.ok, opacity: fadeAt(frame, 10.5) }}>K-08B · Kelas 8B</span>
      </div>
      <div className="mt-10 w-fit rounded-full border-2 px-8 py-2 text-4xl" style={{ borderColor: theme.warn, color: theme.warn, opacity: fadeAt(frame, 17) }}>
        8b ditandai terpakai
      </div>
    </Stage>
  );
};
