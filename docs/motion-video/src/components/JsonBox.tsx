import React from "react";
import { theme } from "../theme";

export const JsonBox: React.FC<{ title?: string; value: unknown; size?: number }> = ({ title, value, size = 28 }) => (
  <div className="rounded-xl border-2 p-5" style={{ background: theme.panel, borderColor: theme.border }}>
    {title && (
      <div className="mb-2 text-2xl uppercase tracking-widest" style={{ color: theme.muted }}>
        {title}
      </div>
    )}
    <pre className="m-0 font-mono" style={{ fontSize: size, color: theme.text, lineHeight: 1.4 }}>
      {JSON.stringify(value, null, 2)}
    </pre>
  </div>
);
