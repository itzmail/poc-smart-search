import React from "react";
import { useCurrentFrame } from "remotion";
import { fadeAt } from "./fade";
import { mono, theme } from "../theme";

type Status = "live" | "code" | "todo";
const statusStyle: Record<Status, { label: string; color: string }> = {
  live: { label: "TERUJI LIVE", color: theme.ok },
  code: { label: "KODE SAJA", color: theme.accent },
  todo: { label: "BELUM", color: theme.warn },
};

// Status badge pinned top-right so every hardening scene states how far its claim is proven.
export const StatusBadge: React.FC<{ status: Status }> = ({ status }) => {
  const { label, color } = statusStyle[status];
  return (
    <div className="absolute right-20 top-14 rounded-full border-2 px-8 py-2 text-3xl font-bold" style={{ color, borderColor: color, background: `${color}1a` }}>
      {label}
    </div>
  );
};

// One "request -> result" row that fades in at `at` seconds.
export const ResultRow: React.FC<{ at: number; request: string; result: string; tone?: "ok" | "warn" | "bad" }> = ({ at, request, result, tone = "ok" }) => {
  const frame = useCurrentFrame();
  return (
    <div className="flex items-center gap-8 rounded-xl border-2 px-8 py-4 text-4xl" style={{ fontFamily: mono, background: theme.panel, borderColor: theme.border, opacity: fadeAt(frame, at) }}>
      <span className="w-[900px] truncate">{request}</span>
      <span style={{ color: theme[tone] }}>{result}</span>
    </div>
  );
};
