import React from "react";
import { useCurrentFrame } from "remotion";
import { Chip } from "../../components/Chip";
import { Stage } from "../../components/Stage";
import { fadeAt } from "../../components/fade";
import { mono, theme } from "../../theme";

const Hit: React.FC<{ phrase: string; chip: string; at: number }> = ({ phrase, chip, at }) => {
  const frame = useCurrentFrame();
  const on = frame >= at * 60;
  return (
    <div className="flex items-center gap-8 text-5xl">
      <span className="rounded-xl px-6 py-2" style={{ fontFamily: mono, background: on ? `${theme.ok}33` : theme.panel, color: on ? theme.ok : theme.text }}>
        {phrase}
      </span>
      <span style={{ color: theme.muted, opacity: fadeAt(frame, at) }}>→</span>
      {on && <Chip label={chip} tone="ok" delay={at * 60} />}
    </div>
  );
};

// Seconds synced to scene4b.mp3: regex 5.0, patterns in database 6.2, "belum bayar" 9.0, "minggu ini" 15.0, final 21.9.
export const Scene4b: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Stage title="Extractor: nilai pasti">
      <div className="mb-8 rounded-xl border-2 px-8 py-4 text-3xl" style={{ fontFamily: mono, background: theme.panel, borderColor: theme.border, opacity: fadeAt(frame, 6.2) }}>
        pola regex disimpan di <span style={{ color: theme.accent }}>database</span>, bukan di kode
      </div>
      <div className="flex flex-col gap-8">
        <Hit phrase="belum bayar" chip="status=nunggak" at={9.0} />
        <Hit phrase="minggu ini" chip="periode=minggu_ini" at={15.0} />
      </div>
      <div className="mt-12 text-4xl font-bold" style={{ color: theme.ok, opacity: fadeAt(frame, 21.9) }}>
        final · tanpa tanya database · tanpa model
      </div>
    </Stage>
  );
};
