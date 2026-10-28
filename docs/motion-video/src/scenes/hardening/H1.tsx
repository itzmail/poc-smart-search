import React from "react";
import { Stage } from "../../components/Stage";
import { ResultRow, StatusBadge } from "../../components/HardeningParts";

// Seconds synced to sceneH1.mp3: no header 5.9, one header 9.2, fake params 12.8.
export const H1: React.FC = () => (
  <Stage title="Siapa yang masuk?">
    <StatusBadge status="live" />
    <div className="flex flex-col gap-5">
      <ResultRow at={5.9} request="tanpa header" result="401" tone="bad" />
      <ResultRow at={9.2} request="hanya X-Client-Id" result="401" tone="bad" />
      <ResultRow at={12.8} request="?client_id=9&role=SUPERADMIN di alamat" result="diabaikan" tone="warn" />
    </div>
  </Stage>
);
