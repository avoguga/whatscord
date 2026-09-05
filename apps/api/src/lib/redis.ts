import { Redis } from "ioredis";
import { env } from "../env.js";

/**
 * Redis backs the Socket.IO adapter and the presence set. It is optional:
 * without it the API still runs, but only as a single instance.
 */
export const redisEnabled = Boolean(env.REDIS_URL);

function client(role: string): Redis | null {
  if (!env.REDIS_URL) return null;
  const c = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    lazyConnect: false
  });
  c.on("error", (err) => console.error(`redis(${role}):`, err.message));
  return c;
}

export const redis = client("main");
export const redisPub = client("pub");
export const redisSub = client("sub");

const PRESENCE_KEY = "whatscord:online";

export async function markOnline(userId: string, socketId: string) {
  if (!redis) return;
  await redis.sadd(`${PRESENCE_KEY}:${userId}`, socketId);
  await redis.expire(`${PRESENCE_KEY}:${userId}`, 60 * 60 * 12);
}

export async function markOffline(userId: string, socketId: string): Promise<boolean> {
  if (!redis) return true;
  await redis.srem(`${PRESENCE_KEY}:${userId}`, socketId);
  const remaining = await redis.scard(`${PRESENCE_KEY}:${userId}`);
  return remaining === 0;
}

export async function onlineUserIds(ids: string[]): Promise<Set<string>> {
  if (!redis || ids.length === 0) return new Set();
  const pipeline = redis.pipeline();
  ids.forEach((id) => pipeline.scard(`${PRESENCE_KEY}:${id}`));
  const results = await pipeline.exec();
  const online = new Set<string>();
  results?.forEach(([err, count], index) => {
    if (!err && typeof count === "number" && count > 0) online.add(ids[index]);
  });
  return online;
}
