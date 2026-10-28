import React from "react";
import { useCurrentFrame } from "remotion";
import { Stage } from "../../components/Stage";
import { fadeAt } from "../../components/fade";
import { mono, theme } from "../../theme";

// Seconds synced to scene5a.mp3: "malas" 6.0, order 10.0, small list 11.5, big search 16.0.
export const Scene5a: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Stage title="Resolver: jawaban ada di data">
      <div className="text-4xl" style={{ color: theme.warn, opacity: fadeAt(frame, 6) }}>malas dengan sengaja · ambil data hanya kalau perlu</div>
      <div className="mt-12 flex items-center gap-10 text-5xl">
        <div className="rounded-2xl border-2 px-10 py-8" style={{ fontFamily: mono, borderColor: theme.ok, opacity: fadeAt(frame, 11.5) }}>
          daftar kecil <span style={{ color: theme.muted }}>(kelas)</span>
        </div>
        <span style={{ color: theme.accent, opacity: fadeAt(frame, 14) }}>→</span>
        <div className="rounded-2xl border-2 px-10 py-8" style={{ fontFamily: mono, borderColor: theme.border, opacity: fadeAt(frame, 16) }}>
          pencarian besar <span style={{ color: theme.muted }}>(siswa)</span>
        </div>
      </div>
    </Stage>
  );
};
