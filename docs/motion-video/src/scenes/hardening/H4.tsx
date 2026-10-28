import React from "react";
import { useCurrentFrame } from "remotion";
import { Stage } from "../../components/Stage";
import { ResultRow, StatusBadge } from "../../components/HardeningParts";
import { fadeAt } from "../../components/fade";
import { mono, theme } from "../../theme";

// Seconds synced to sceneH4.mp3: SUPERADMIN 7 at 8.0, GURU 6 at 10.2, bug 13.4, empty list 16.0, fixed 20.7, zero result 22.5.
export const H4: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Stage title="Siapa boleh lihat apa?">
      <StatusBadge status="live" />
      <div className="flex flex-col gap-4">
        <ResultRow at={8} request="tenant 1 · SUPERADMIN" result="7 halaman" />
        <ResultRow at={10.2} request="tenant 1 · GURU" result="6 halaman (tanpa spp)" />
      </div>
      <div className="mt-8 w-fit rounded-xl px-8 py-3 text-4xl font-bold" style={{ color: theme.bad, background: `${theme.bad}1a`, opacity: fadeAt(frame, 13.4) }}>
        BUG: daftar halaman kosong → semua halaman terbuka
      </div>
      <div className="mt-6 rounded-xl border-2 px-8 py-4 text-3xl leading-relaxed" style={{ fontFamily: mono, background: theme.panel, borderColor: theme.border, opacity: fadeAt(frame, 16) }}>
        <div style={{ color: theme.bad }}>- if (Array.isArray(data.routes) &amp;&amp; data.routes.length &gt; 0) {"{"}</div>
        <div style={{ color: theme.ok, opacity: fadeAt(frame, 20.7) }}>+ if (Array.isArray(data.routes)) {"{"}</div>
      </div>
      <div className="mt-6 text-4xl font-bold" style={{ color: theme.ok, opacity: fadeAt(frame, 22.5) }}>kosong = 0 hasil, bukan akses penuh</div>
    </Stage>
  );
};
