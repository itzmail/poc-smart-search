import React from "react";
import { useCurrentFrame } from "remotion";
import { Chip } from "../../components/Chip";
import { Stage } from "../../components/Stage";
import { fadeAt } from "../../components/fade";
import { mono, theme } from "../../theme";

// Seconds synced to scene5c.mp3: skipped 6.5, exclusion 11.9, all ingredients 22.4, "link" 28.0.
export const Scene5c: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Stage title="Resolver: lewati pencarian siswa">
      <div className="flex items-center gap-8 text-5xl" style={{ fontFamily: mono, opacity: fadeAt(frame, 0.5) }}>
        <span>siswa_id</span>
        <span style={{ color: theme.bad, opacity: fadeAt(frame, 6.5) }}>✕ dilewati</span>
        <span className="rounded-full px-6 py-2 text-4xl" style={{ background: theme.panel, color: theme.warn, opacity: fadeAt(frame, 5.5) }}>0 token tersisa</span>
      </div>
      <div className="mt-8 text-4xl" style={{ color: theme.muted, opacity: fadeAt(frame, 11.9) }}>
        token exclusion: tanpa ini, 8b ikut dicari ke daftar siswa. Hasil pasti kosong, buang waktu.
      </div>
      <div className="mt-12 flex gap-6">
        <Chip label="kelas_id=K-08B" tone="ok" delay={22.4 * 60} />
        <Chip label="status=nunggak" tone="ok" delay={23.2 * 60} />
        <Chip label="periode=minggu_ini" tone="ok" delay={24 * 60} />
      </div>
    </Stage>
  );
};
