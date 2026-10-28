import React from "react";
import { useCurrentFrame } from "remotion";
import { Stage } from "../../components/Stage";
import { StatusBadge } from "../../components/HardeningParts";
import { fadeAt } from "../../components/fade";
import { mono, theme } from "../../theme";

// Seconds synced to sceneH3.mp3: app off 2.5, rung 1 10.3, rung 2 19.2, rung 3 27.7, TTL 34.2, closing 38.2.
const RUNGS = [
  { at: 10.3, title: "1 · Salinan lama (stale)", detail: "kelas K-08B tetap benar", tone: "ok" },
  { at: 19.2, title: "2 · Tanpa filter kelas", detail: "jawaban tetap keluar · degraded: true", tone: "warn" },
  { at: 27.7, title: "3 · Daftar halaman bawaan", detail: "FALLBACK_ROUTES · degraded: true", tone: "bad" },
] as const;

export const H3: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Stage title="Kalau sistem sakit">
      <StatusBadge status="live" />
      <div className="w-fit rounded-full border-2 px-8 py-2 text-4xl" style={{ fontFamily: mono, color: theme.bad, borderColor: theme.bad, opacity: fadeAt(frame, 2.5) }}>
        app-education dimatikan → tetap 200, bukan error
      </div>
      <div className="mt-8 flex flex-col gap-5">
        {RUNGS.map((r) => (
          <div key={r.title} className="rounded-xl border-2 px-8 py-4" style={{ background: theme.panel, borderColor: theme[r.tone], opacity: fadeAt(frame, r.at) }}>
            <div className="text-4xl font-bold" style={{ color: theme[r.tone] }}>{r.title}</div>
            <div className="text-3xl" style={{ fontFamily: mono, color: theme.muted }}>{r.detail}</div>
          </div>
        ))}
      </div>
      <div className="mt-8 text-4xl" style={{ fontFamily: mono, color: theme.warn, opacity: fadeAt(frame, 34.2) }}>tanda degraded hanya disimpan 20 detik</div>
      <div className="mt-4 text-4xl font-bold" style={{ opacity: fadeAt(frame, 38.2) }}>hasil kasar yang jujur &gt; error atau hasil salah</div>
    </Stage>
  );
};
