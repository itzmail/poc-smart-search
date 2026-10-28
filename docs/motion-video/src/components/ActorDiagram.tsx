import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { Cloud, Cpu, Database, Link as LinkIcon, School, Search, Table2, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { mono, theme } from "../theme";

type Actor = { id: string; icon: LucideIcon; name: string; sub: string; x: number; y: number; w: number };
type Arrow = { id: string; from: string; to: string; dy?: number; dashed?: boolean };

const H = 130;
// Canvas is 1520x760; cards are absolutely placed so arrows can be computed from the same numbers.
const actors: Actor[] = [
  { id: "user", icon: User, name: "User", sub: "", x: 0, y: 315, w: 200 },
  { id: "app", icon: School, name: "App Pendidikan", sub: ":3000", x: 280, y: 315, w: 340 },
  { id: "search", icon: Search, name: "service-search", sub: ":4000 · Bun", x: 680, y: 315, w: 360 },
  { id: "jev", icon: Cloud, name: "JEV Cloud", sub: "AI eksternal", x: 1120, y: 0, w: 400 },
  { id: "tfjs", icon: Cpu, name: "transformers.js", sub: "multilingual-e5-small · ±120 MB", x: 1120, y: 190, w: 400 },
  { id: "redis", icon: Database, name: "Redis", sub: ":6379", x: 1120, y: 380, w: 400 },
  { id: "db", icon: Table2, name: "search_routes", sub: "tabel DB", x: 1120, y: 570, w: 400 },
  { id: "link", icon: LinkIcon, name: "Link", sub: "hasil akhir", x: 680, y: 620, w: 360 },
];

const arrows: Arrow[] = [
  { id: "user-app", from: "user", to: "app" },
  { id: "app-search", from: "app", to: "search", dy: -25 },
  { id: "search-app", from: "search", to: "app", dy: 25, dashed: true },
  { id: "search-jev", from: "search", to: "jev" },
  { id: "search-tfjs", from: "search", to: "tfjs" },
  { id: "search-redis", from: "search", to: "redis" },
  { id: "search-db", from: "search", to: "db" },
  { id: "search-link", from: "search", to: "link" },
];

const byId = Object.fromEntries(actors.map((a) => [a.id, a]));
const center = (a: Actor) => ({ cx: a.x + a.w / 2, cy: a.y + H / 2 });

// Point on the card border facing the other card.
const edge = (a: Actor, b: Actor, dy = 0) => {
  const { cx: ax, cy: ay } = center(a);
  const { cx: bx, cy: by } = center(b);
  if (Math.abs(bx - ax) > Math.abs(by - ay)) return { x: bx > ax ? a.x + a.w : a.x, y: ay + dy };
  return { x: ax, y: by > ay ? a.y + H : a.y };
};

type Props = {
  mode?: "full" | "corner";
  highlight?: string; // arrow id to emphasise
  stagger?: number; // frames between cards in full mode
  reveal?: Record<string, number>; // per-actor start frame, overrides stagger (sync to narration)
  arrowsAt?: number; // frame when arrows start drawing in full mode
};

export const ActorDiagram: React.FC<Props> = ({ mode = "full", highlight, stagger = 20, reveal, arrowsAt }) => {
  const frame = useCurrentFrame();
  const full = mode === "full";
  const arrowStart = arrowsAt ?? actors.length * stagger;

  const wrapper: React.CSSProperties = full
    ? { position: "absolute", left: 200, top: 160, width: 1520, height: 760 }
    : { position: "absolute", right: 30, bottom: 30, width: 1520, height: 760, transform: "scale(0.38)", transformOrigin: "bottom right", opacity: 0.9 };

  return (
    <div style={wrapper}>
      <svg width={1520} height={760} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <marker id="head" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="context-stroke" />
          </marker>
        </defs>
        {arrows.map((ar, i) => {
          const a = byId[ar.from];
          const b = byId[ar.to];
          const p1 = edge(a, b, ar.dy);
          const p2 = edge(b, a, ar.dy);
          const p = full ? interpolate(frame, [arrowStart + i * 8, arrowStart + i * 8 + 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
          const hot = highlight === ar.id;
          const dim = highlight !== undefined && !hot;
          return (
            <line
              key={ar.id}
              x1={p1.x}
              y1={p1.y}
              x2={p1.x + (p2.x - p1.x) * p}
              y2={p1.y + (p2.y - p1.y) * p}
              stroke={hot ? theme.warn : theme.accent}
              strokeWidth={hot ? 8 : 4}
              strokeDasharray={ar.dashed ? "12 10" : undefined}
              opacity={dim ? 0.25 : 1}
              markerEnd="url(#head)"
            />
          );
        })}
      </svg>
      {actors.map((a, i) => {
        const t0 = reveal?.[a.id] ?? i * stagger;
        const o = full ? interpolate(frame, [t0, t0 + 15], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
        const Icon = a.icon;
        return (
          <div
            key={a.id}
            className="absolute flex items-center gap-4 rounded-2xl border-2 px-5"
            style={{ left: a.x, top: a.y + (1 - o) * 30, width: a.w, height: H, opacity: o, background: theme.panel, borderColor: theme.border, color: theme.text }}
          >
            <Icon size={52} color={theme.accent} strokeWidth={1.8} style={{ flexShrink: 0 }} />
            <div className="min-w-0">
              <div className="text-3xl font-semibold">{a.name}</div>
              {a.sub && (
                <div className="text-xl" style={{ color: theme.muted, fontFamily: mono }}>
                  {a.sub}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
