import { Redis } from "ioredis";
import pc from "picocolors";

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
export const DEFAULT_TTL_SECONDS = 1800; // 30 Menit

// In-Memory Fallback Map jika Redis server offline
const memoryStore = new Map<string, { val: string; expireAt: number }>();

let redisClient: Redis | null = null;
let isConnected = false;

try {
  redisClient = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 800,
    lazyConnect: true,
  });

  redisClient.on("connect", () => {
    isConnected = true;
    console.log(pc.green(`⚡ [Cache] Terkoneksi ke Redis di ${REDIS_URL}`));
  });

  redisClient.on("error", () => {
    if (isConnected) {
      console.log(pc.yellow(`⚠️  [Cache] Koneksi Redis terputus. Fallback ke In-Memory Cache.`));
    }
    isConnected = false;
  });

  // Coba connect non-blocking
  redisClient.connect().catch(() => {
    isConnected = false;
  });
} catch {
  isConnected = false;
}

export async function cacheGet(key: string): Promise<string | null> {
  if (isConnected && redisClient) {
    try {
      return await redisClient.get(key);
    } catch {
      // Fallback ke memory jika redis read gagal
    }
  }

  const item = memoryStore.get(key);
  if (!item) return null;
  if (Date.now() > item.expireAt) {
    memoryStore.delete(key);
    return null;
  }
  return item.val;
}

export async function cacheSet(
  key: string,
  value: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): Promise<void> {
  if (isConnected && redisClient) {
    try {
      await redisClient.set(key, value, "EX", ttlSeconds);
      return;
    } catch {
      // Fallback
    }
  }

  memoryStore.set(key, {
    val: value,
    expireAt: Date.now() + ttlSeconds * 1000,
  });
}

export function getCacheStatus(): { engine: "redis" | "memory"; ttl_minutes: number } {
  return {
    engine: isConnected ? "redis" : "memory",
    ttl_minutes: DEFAULT_TTL_SECONDS / 60,
  };
}
