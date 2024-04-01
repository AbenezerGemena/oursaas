interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const MAX_LRU_SIZE = 1000;

const l1Cache = new Map<string, CacheEntry<any>>();

function evictExpired(): void {
  const now = Date.now();
  for (const [key, entry] of l1Cache) {
    if (entry.expiresAt <= now) {
      l1Cache.delete(key);
    }
  }
}

function enforceLRUSize(): void {
  if (l1Cache.size <= MAX_LRU_SIZE) return;
  const keysToDelete = l1Cache.size - MAX_LRU_SIZE;
  const iter = l1Cache.keys();
  for (let i = 0; i < keysToDelete; i++) {
    const { value: key } = iter.next();
    if (key) l1Cache.delete(key);
  }
}

setInterval(evictExpired, 60_000).unref();

let redisHelpers: {
  isRedisAvailable: () => boolean;
  cacheGet: (key: string) => Promise<string | null>;
  cacheSet: (key: string, value: string, ttl: number) => Promise<any>;
  cacheDel: (key: string) => Promise<any>;
} | null = null;

async function loadRedis(): Promise<typeof redisHelpers> {
  if (redisHelpers !== null) return redisHelpers;
  try {
    const mod = await import("./redis.js");
    if (mod && typeof mod.isRedisAvailable === "function") {
      redisHelpers = {
        isRedisAvailable: mod.isRedisAvailable,
        cacheGet: mod.cacheGet ?? (async () => null),
        cacheSet: mod.cacheSet ?? (async () => {}),
        cacheDel: mod.cacheDel ?? (async () => {}),
      };
    } else {
      redisHelpers = null;
    }
  } catch {
    redisHelpers = null;
  }
  return redisHelpers;
}

loadRedis().catch(() => {});

export async function cacheGet<T>(
  key: string,
  ttlSeconds: number,
  fetchFn: () => Promise<T>
): Promise<T> {
  const now = Date.now();

  const l1Entry = l1Cache.get(key);
  if (l1Entry && l1Entry.expiresAt > now) {
    l1Cache.delete(key);
    l1Cache.set(key, l1Entry);
    return l1Entry.value as T;
  }

  const redis = await loadRedis();
  if (redis && redis.isRedisAvailable()) {
    try {
      const raw = await redis.cacheGet(key);
      if (raw !== null) {
        const parsed = JSON.parse(raw) as T;
        l1Cache.set(key, { value: parsed, expiresAt: now + ttlSeconds * 1000 });
        enforceLRUSize();
        return parsed;
      }
    } catch {}
  }

  const value = await fetchFn();

  l1Cache.set(key, { value, expiresAt: now + ttlSeconds * 1000 });
  enforceLRUSize();

  if (redis && redis.isRedisAvailable()) {
    try {
      await redis.cacheSet(key, JSON.stringify(value), ttlSeconds);
    } catch {}
  }

  return value;
}

export async function cacheInvalidate(key: string): Promise<void> {
  l1Cache.delete(key);

  const redis = await loadRedis();
  if (redis && redis.isRedisAvailable()) {
    try {
      await redis.cacheDel(key);
    } catch {}
  }
}

export async function cacheInvalidatePrefix(prefix: string): Promise<void> {
  for (const k of l1Cache.keys()) {
    if (k.startsWith(prefix)) {
      l1Cache.delete(k);
    }
  }
}

export const CACHE_KEYS = {
  channel: (id: string | number) => `channel:${id}`,
  panelConfig: () => "panel:config",
  smtpConfig: () => "smtp:config",
  userPermissions: (userId: string | number) => `user:perms:${userId}`,
  subscriptionPlans: () => "subscription:plans",
  planById: (id: string | number) => `plan:${id}`,
} as const;

export const CACHE_TTL = {
  channel: 300,
  panelConfig: 600,
  smtpConfig: 600,
  userPermissions: 300,
  subscriptionPlans: 600,
} as const;
