import React from "react";
import { useCurrentFrame } from "remotion";
import { Stage } from "../../components/Stage";
import { fadeAt } from "../../components/fade";
import { scores, urls } from "../../data/trace";
import { mono, theme } from "../../theme";

// Seconds synced to scene6.mp3: assembly 0.5, date range 7.0, option 1 10.8, option 2 17.0, done 21.0.
export const Scene6: React.FC = () => {
  const frame = useCurrentFrame();
  const at = [10.8, 17.0];
  return (
    <Stage title="Step 4: Dispatcher">
      <div className="mb-8 text-4xl" style={{ fontFamily: mono, color: theme.muted, opacity: fadeAt(frame, 7) }}>
        periode=minggu_ini → <span style={{ color: theme.warn }}>22–28 Okt</span>
      </div>
      <div className="flex flex-col gap-6">
        {urls.map((u, i) => (
          <div key={u} className="rounded-2xl border-2 px-8 py-5" style={{ background: theme.panel, borderColor: i === 0 ? theme.ok : theme.border, opacity: fadeAt(frame, at[i]) }}>
            <div className="mb-2 text-3xl" style={{ color: i === 0 ? theme.ok : theme.muted }}>skor {scores[i]}</div>
            <div className="break-all text-3xl" style={{ fontFamily: mono }}>{u}</div>
          </div>
        ))}
      </div>
      <div className="mt-8 text-5xl font-bold" style={{ color: theme.ok, opacity: fadeAt(frame, 21) }}>1 kalimat → link</div>
    </Stage>
  );
};
