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

/**
 * Presence without Redis.
 *
 * Redis is optional, and the previous fallbacks were wrong in a way that looked
 * like a scaling note rather than a bug: `markOffline` always answered "that was
 * the last tab", so closing one of four open tabs marked the person offline for
 * everyone, and everybody always read as offline. A single instance can hold
 * this in memory perfectly well.
 */
const localPresence = new Map<string, Set<string>>();

export async function markOnline(userId: string, socketId: string) {
  if (!redis) {
    const set = localPresence.get(userId) ?? new Set<string>();
    set.add(socketId);
    localPresence.set(userId, set);
    return;
  }
  await redis.sadd(`${PRESENCE_KEY}:${userId}`, socketId);
  await redis.expire(`${PRESENCE_KEY}:${userId}`, 60 * 60 * 12);
}

/** Returns true only when this was the person's last open connection. */
export async function markOffline(userId: string, socketId: string): Promise<boolean> {
  if (!redis) {
    const set = localPresence.get(userId);
    if (!set) return true;
    set.delete(socketId);
    if (set.size === 0) {
      localPresence.delete(userId);
      return true;
    }
    return false;
  }
  await redis.srem(`${PRESENCE_KEY}:${userId}`, socketId);
  const remaining = await redis.scard(`${PRESENCE_KEY}:${userId}`);
  return remaining === 0;
}

export async function onlineUserIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  if (!redis) {
    return new Set(ids.filter((id) => (localPresence.get(id)?.size ?? 0) > 0));
  }
  const pipeline = redis.pipeline();
  ids.forEach((id) => pipeline.scard(`${PRESENCE_KEY}:${id}`));
  const results = await pipeline.exec();
  const online = new Set<string>();
  results?.forEach(([err, count], index) => {
    if (!err && typeof count === "number" && count > 0) online.add(ids[index]);
  });
  return online;
}
