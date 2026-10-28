import React from "react";
import { useCurrentFrame } from "remotion";
import { Stage } from "../../components/Stage";
import { StatusBadge } from "../../components/HardeningParts";
import { fadeAt } from "../../components/fade";
import { mono, theme } from "../../theme";

// Seconds synced to sceneH5.mp3: unknown role 3.4, mock data pages 7.7, POC note 12.3, next work list 16.5.
const ITEMS = [
  { at: 3.4, text: "role/sekolah tak dikenal → 200 dengan 0 hasil, bukan 403" },
  { at: 7.7, text: "app contoh: /api/nilai belum cek peran (mock POC)" },
  { at: 16.5, text: "JWT, rate limit & lock terdistribusi, load test" },
];

export const H5: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Stage title="Yang belum selesai">
      <StatusBadge status="todo" />
      <div className="flex flex-col gap-5">
        {ITEMS.map((i) => (
          <div key={i.text} className="rounded-xl border-2 px-8 py-5 text-4xl" style={{ fontFamily: mono, color: theme.warn, borderColor: theme.warn, background: `${theme.warn}1a`, opacity: fadeAt(frame, i.at) }}>
            {i.text}
          </div>
        ))}
      </div>
    </Stage>
  );
};
