import React from "react";
import { Stage } from "../../components/Stage";
import { ResultRow, StatusBadge } from "../../components/HardeningParts";

// Seconds synced to sceneH2.mp3: q 200 at 3.8, 201 at 8.3, body 12.2, rate limit 17.3, 116 ok 24.2, rejected 27.
export const H2: React.FC = () => (
  <Stage title="Seberapa banyak?">
    <StatusBadge status="live" />
    <div className="flex flex-col gap-5">
      <ResultRow at={3.8} request="q 200 karakter" result="200" />
      <ResultRow at={8.3} request="q 201 karakter" result="400 Query exceeds 200 characters" tone="bad" />
      <ResultRow at={12.2} request="body 5 KB (batas 4 KB)" result="413 Request body too large" tone="bad" />
      <ResultRow at={17.3} request="150 request beruntun (batas 120/menit)" result="116 sukses" />
      <ResultRow at={27} request="sisanya" result="34 × 429 · Retry-After: 1" tone="bad" />
    </div>
  </Stage>
);
