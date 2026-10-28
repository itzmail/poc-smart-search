import raw from "./trace.json";

export type Timings = { classifier: number; extractor: number; resolver: number; dispatcher: number; total: number };

// Real captured trace (tenant 1, SUPERADMIN, 2026-10-28). All scene numbers come from here.
export const q1 = raw.q1;
export const sity = raw.sity;
export const b1 = raw.b1;
export const b2 = raw.b2;
export const b3 = raw.b3;

export const timings: Timings = q1.trace.timings_ms;
export const urls: string[] = q1.options.map((o) => o.destination);
export const scores: number[] = q1.options.map((o) => o.score);

export const fmtMs = (n: number) => `${n.toLocaleString("id-ID", { maximumFractionDigits: 2 })} ms`;
