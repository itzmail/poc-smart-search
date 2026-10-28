import React from "react";
import { useCurrentFrame } from "remotion";
import { Stage } from "../../components/Stage";
import { fadeAt } from "../../components/fade";
import { fmtMs, sity } from "../../data/trace";
import { mono, theme } from "../../theme";

// Seconds synced to sceneA.mp3: query 0.5, empty result 16.0, truncation 21.5, 2 students 28.0, 2 links 33.0, 632 ms 38.0, cached 41.5.
export const SceneA: React.FC = () => {
  const frame = useCurrentFrame();
  const calls = sity.trace.step3_resolver.http_calls;
  const urls = sity.options.map((o) => o.destination);
  return (
    <Stage title="Kalau nama salah ketik">
      <div className="text-5xl" style={{ fontFamily: mono, opacity: fadeAt(frame, 0.5) }}>Anak bernama Sity ada di kelas berapa?</div>
      <div className="mt-8 flex flex-col gap-3 text-4xl" style={{ fontFamily: mono }}>
        <div style={{ opacity: fadeAt(frame, 11.5) }}>/api/siswa · <span style={{ color: theme.accent }}>sity</span> → <span style={{ color: theme.bad }}>{calls[0].results_count} hasil</span></div>
        <div style={{ opacity: fadeAt(frame, 21.5) }}>potong huruf terakhir: sit<span style={{ color: theme.bad, textDecoration: "line-through" }}>y</span> → <span style={{ color: theme.accent }}>sit</span></div>
        <div style={{ opacity: fadeAt(frame, 24.5) }}>/api/siswa · sit → <span style={{ color: theme.ok }}>{calls[1].results_count} hasil</span></div>
      </div>
      <div className="mt-8 flex gap-6" style={{ opacity: fadeAt(frame, 28) }}>
        {sity.trace.step3_resolver.resolved_params.siswa_id.map((s) => (
          <div key={s.id} className="rounded-xl border-2 px-6 py-3 text-4xl" style={{ borderColor: theme.ok, background: theme.panel }}>{s.name}</div>
        ))}
      </div>
      <div className="mt-6 flex flex-col gap-2 text-3xl" style={{ fontFamily: mono, color: theme.muted, opacity: fadeAt(frame, 33) }}>
        {urls.map((u) => <div key={u}>{u}</div>)}
      </div>
      <div className="mt-6 flex items-center gap-8 text-4xl" style={{ fontFamily: mono }}>
        <span className="rounded-full px-6 py-2" style={{ background: theme.panel, color: theme.warn, opacity: fadeAt(frame, 38) }}>resolver {fmtMs(sity.trace.timings_ms.resolver)}</span>
        <span style={{ color: theme.ok, opacity: fadeAt(frame, 41.5) }}>hasil disimpan → berikutnya cepat</span>
      </div>
    </Stage>
  );
};
