import React from "react";
import { useCurrentFrame } from "remotion";
import { Stage } from "../../components/Stage";
import { fadeAt } from "../../components/fade";
import { mono, theme } from "../../theme";

// Seconds synced to scene2.mp3: headers 4.3, stamp 9.1, rejection 12.7.
export const Scene2: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Stage title="Pintu masuk">
      <div className="rounded-2xl border-2 px-10 py-8 text-5xl" style={{ fontFamily: mono, background: theme.panel, borderColor: theme.border }}>
        GET /resolve?q=…
      </div>
      <div className="mt-8 flex flex-col gap-4 text-4xl" style={{ fontFamily: mono, opacity: fadeAt(frame, 4.3) }}>
        <div style={{ color: theme.ok }}>X-Client-Id: 1 <span style={{ color: theme.muted }}>← siapa sekolahnya</span></div>
        <div style={{ color: theme.ok }}>X-User-Role: SUPERADMIN <span style={{ color: theme.muted }}>← apa perannya</span></div>
      </div>
      <div className="mt-10 w-fit rounded-full border-2 px-10 py-3 text-5xl font-bold" style={{ opacity: fadeAt(frame, 9.1), color: theme.accent, borderColor: theme.accent }}>
        tenant 1 · SUPERADMIN
      </div>
      <div className="mt-10 w-fit rounded-2xl px-10 py-4 text-5xl font-bold" style={{ opacity: fadeAt(frame, 12.7), color: theme.bad, background: `${theme.bad}1a`, fontFamily: mono }}>
        tanpa header → 401
      </div>
    </Stage>
  );
};
