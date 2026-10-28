import React from "react";
import { useCurrentFrame } from "remotion";
import { JsonBox } from "../../components/JsonBox";
import { Stage } from "../../components/Stage";
import { fadeAt } from "../../components/fade";
import { theme } from "../../theme";

// Seconds synced to scene4d.mp3: question 0, handoff of 3 things 8.3, "next step" 19.0.
export const Scene4d: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Stage title="Extractor: jangan menebak">
      <div className="text-4xl" style={{ color: theme.muted }}>8b itu kelas? nama siswa? Extractor sengaja tidak menjawab.</div>
      <div className="mt-8 w-fit" style={{ opacity: fadeAt(frame, 8.3) }}>
        <JsonBox
          title="RawExtraction"
          size={36}
          value={{ enumValues: { status: "nunggak", periode: "minggu_ini" }, tokens: ["8b"] }}
        />
      </div>
      <div className="mt-8 text-4xl font-bold" style={{ color: theme.accent, opacity: fadeAt(frame, 19) }}>
        → Resolver: satu-satunya yang boleh bertanya ke data sekolah
      </div>
    </Stage>
  );
};
