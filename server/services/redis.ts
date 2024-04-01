import Redis from "ioredis";

let redisClient: Redis | null = null;
let connectionAttempted = false;
let isConnected = false;

function initRedis(): Redis | null {
  if (connectionAttempted) return redisClient;
  connectionAttempted = true;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.log("[Redis] REDIS_URL not set — running without Redis");
    return null;
  }

  try {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times: number) {
        if (times > 5) return null;
        return Math.min(times * 500, 3000);
      },
      lazyConnect: false,
    });

    redisClient.on("connect", () => {
      isConnected = true;
      console.log("[Redis] Connected successfully");
    });

    let redisErrorLogged = false;
    redisClient.on("error", (err: Error) => {
      if (!redisErrorLogged) {
        redisErrorLogged = true;
        console.error("[Redis] Connection error:", err.message);
      }
      isConnected = false;
    });

    redisClient.on("close", () => {
      isConnected = false;
    });
  } catch (err: any) {
    console.error("[Redis] Failed to initialize:", err.message);
    redisClient = null;
  }

  return redisClient;
}

export function getRedisClient(): Redis | null {
  if (!connectionAttempted) initRedis();
  return isConnected ? redisClient : null;
}

export function isRedisAvailable(): boolean {
  if (!connectionAttempted) initRedis();
  return isConnected && redisClient !== null;
}

export async function cacheGet(key: string): Promise<string | null> {
  const client = getRedisClient();
  if (!client) return null;
  try {
    return await client.get(key);
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
  const client = getRedisClient();
  if (!client) return false;
  try {
    if (ttlSeconds) {
      await client.set(key, value, "EX", ttlSeconds);
    } else {
      await client.set(key, value);
    }
    return true;
  } catch {
    return false;
  }
}

export async function cacheDel(key: string): Promise<boolean> {
  const client = getRedisClient();
  if (!client) return false;
  try {
    await client.del(key);
    return true;
  } catch {
    return false;
  }
}

export async function cacheGetJSON<T>(key: string): Promise<T | null> {
  const raw = await cacheGet(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function cacheSetJSON(key: string, value: unknown, ttlSeconds?: number): Promise<boolean> {
  try {
    return await cacheSet(key, JSON.stringify(value), ttlSeconds);
  } catch {
    return false;
  }
}
