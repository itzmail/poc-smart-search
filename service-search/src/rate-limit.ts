// Token bucket in-process per key. Per-instance saja; versi Redis ditunda
// sampai topologi Redis diputuskan.
const RPM = parseInt(process.env.RATE_LIMIT_RPM || "120", 10);
const buckets = new Map<string, { tokens: number; updated: number }>();

// Mengembalikan 0 bila diizinkan, selain itu jumlah detik untuk Retry-After.
export function rateLimit(key: string): number {
  if (RPM <= 0) return 0;
  const now = Date.now();
  const refillPerMs = RPM / 60_000;
  const b = buckets.get(key) ?? { tokens: RPM, updated: now };
  b.tokens = Math.min(RPM, b.tokens + (now - b.updated) * refillPerMs);
  b.updated = now;
  buckets.set(key, b);
  if (b.tokens >= 1) {
    b.tokens -= 1;
    return 0;
  }
  return Math.ceil((1 - b.tokens) / refillPerMs / 1000);
}

// Bucket yang sudah penuh dibuang berkala agar Map tidak tumbuh tanpa batas
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now - b.updated > 120_000) buckets.delete(k);
}, 60_000).unref();
