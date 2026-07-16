import { Redis, type Redis as RedisType } from "ioredis";
import { config } from "../core/config.js";
import { logger } from "../core/logger.js";

// ─── Redis Client (lazy singleton) ───
let redisClient: RedisType | null = null;
let connectionAttempted = false;

export function getRedisClient(): RedisType | null {
  if (!redisClient && !connectionAttempted) {
    connectionAttempted = true;
    try {
      const client = new Redis(config.redis.url, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times: number) => {
          if (times > 3) {
            logger.warn("Redis connection retries exhausted, caching disabled.");
            return null;
          }
          return Math.min(times * 200, 1000);
        },
        enableOfflineQueue: false,
        lazyConnect: false,
      });

      client.on("connect", () => {
        logger.info("Redis client connected.");
      });

      client.on("error", (err: Error) => {
        logger.warn("Redis client error:", err.message);
      });

      client.on("close", () => {
        logger.warn("Redis client connection closed.");
      });

      redisClient = client;
    } catch (err) {
      logger.warn("Failed to initialize Redis client:", err);
      redisClient = null;
    }
  }
  return redisClient;
}

// ─── Cache helpers ───
export async function cacheGet<T>(key: string): Promise<T | null> {
  const client = getRedisClient();
  if (!client || client.status !== "ready") return null;
  try {
    const data = await client.get(key);
    if (!data) return null;
    return JSON.parse(data) as T;
  } catch (err) {
    logger.warn(`Cache get error for key "${key}":`, err);
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  const client = getRedisClient();
  if (!client || client.status !== "ready") return;
  try {
    const data = JSON.stringify(value);
    if (ttlSeconds) {
      await client.set(key, data, "EX", ttlSeconds);
    } else {
      await client.set(key, data, "EX", config.redis.ttl);
    }
  } catch (err) {
    logger.warn(`Cache set error for key "${key}":`, err);
  }
}

export async function cacheDel(key: string): Promise<void> {
  const client = getRedisClient();
  if (!client || client.status !== "ready") return;
  try {
    await client.del(key);
  } catch (err) {
    logger.warn(`Cache del error for key "${key}":`, err);
  }
}

export async function cacheDelPattern(pattern: string): Promise<void> {
  const client = getRedisClient();
  if (!client || client.status !== "ready") return;
  try {
    const keys = await client.keys(pattern);
    if (keys.length > 0) {
      await client.del(...keys);
    }
  } catch (err) {
    logger.warn(`Cache del pattern error for "${pattern}":`, err);
  }
}

// ─── Cache wrapper: get from cache or compute and store ───
export async function cacheWrap<T>(
  key: string,
  fn: () => Promise<T>,
  ttlSeconds?: number,
): Promise<T> {
  const cached = await cacheGet<T>(key);
  if (cached !== null) return cached;

  const result = await fn();
  await cacheSet(key, result, ttlSeconds);
  return result;
}

// ─── Check if Redis is available ───
export function isRedisAvailable(): boolean {
  const client = getRedisClient();
  return !!client && client.status === "ready";
}

export default {
  getRedisClient,
  cacheGet,
  cacheSet,
  cacheDel,
  cacheDelPattern,
  cacheWrap,
  isRedisAvailable,
};
