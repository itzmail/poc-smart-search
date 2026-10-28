import React from "react";
import { useCurrentFrame } from "remotion";
import { Stage } from "../../components/Stage";
import { fadeAt } from "../../components/fade";
import { mono, theme } from "../../theme";

const VARIANTS = ["delapan b", "VIII B", "klas 8B", "kelas 8B"];

// Seconds synced to scene4a.mp3: "dirapikan" 6.5, lowercase 9.3, class variants 11.5, all become 8b 18.0.
export const Scene4a: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Stage title="Extractor: rapikan kalimat">
      <div className="flex items-center gap-12">
        <div className="flex flex-col gap-4">
          {VARIANTS.map((v, i) => (
            <div key={v} className="rounded-xl border-2 px-8 py-3 text-4xl" style={{ fontFamily: mono, background: theme.panel, borderColor: theme.border, opacity: fadeAt(frame, 11.5 + i * 0.8) }}>
              {v}
            </div>
          ))}
        </div>
        <div className="text-7xl" style={{ color: theme.accent, opacity: fadeAt(frame, 18) }}>→</div>
        <div className="rounded-2xl border-2 px-12 py-6 text-7xl font-bold" style={{ fontFamily: mono, color: theme.ok, borderColor: theme.ok, opacity: fadeAt(frame, 18) }}>
          8b
        </div>
      </div>
      <div className="mt-12 text-4xl" style={{ color: theme.muted, opacity: fadeAt(frame, 9.3) }}>
        semua huruf kecil · penulisan kelas diseragamkan
      </div>
      <div className="mt-6 text-4xl" style={{ color: theme.warn, opacity: fadeAt(frame, 20.5) }}>
        mesin tidak bingung karena beda penulisan
      </div>
    </Stage>
  );
};
