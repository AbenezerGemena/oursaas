import { Request, Response, NextFunction } from "express";

const DEFAULT_RATE_LIMIT = 100;
const WINDOW_MS = 60_000;

interface SlidingWindowEntry {
  timestamps: number[];
}

const store = new Map<string, SlidingWindowEntry>();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter((t) => t > now - WINDOW_MS);
    if (entry.timestamps.length === 0) {
      store.delete(key);
    }
  }
}, 30_000).unref();

function getLimit(): number {
  const envVal = process.env.API_RATE_LIMIT;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_RATE_LIMIT;
}

function getTenantKey(req: Request): string {
  const user = (req as any).session?.user;
  if (user?.id) return `user:${user.id}`;

  const apiUser = req.apiUser;
  if (apiUser?.userId) return `apiuser:${apiUser.userId}`;

  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.ip ||
    "unknown";
  return `ip:${ip}`;
}

function isExempt(path: string): boolean {
  if (path.startsWith("/api/webhooks")) return true;
  if (path.startsWith("/webhooks")) return true;
  if (path === "/api/version") return true;
  if (path === "/api/health") return true;
  if (path.startsWith("/api/agents/online")) return true;
  return false;
}

export function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith("/api")) return next();
  if (isExempt(req.path)) return next();

  const limit = getLimit();
  const key = getTenantKey(req);
  const now = Date.now();

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  entry.timestamps = entry.timestamps.filter((t) => t > now - WINDOW_MS);

  if (entry.timestamps.length >= limit) {
    const oldestInWindow = entry.timestamps[0];
    const retryAfter = Math.ceil((oldestInWindow + WINDOW_MS - now) / 1000);

    res.setHeader("Retry-After", String(retryAfter));
    res.setHeader("X-RateLimit-Limit", String(limit));
    res.setHeader("X-RateLimit-Remaining", "0");
    res.setHeader("X-RateLimit-Reset", String(Math.ceil((now + retryAfter * 1000) / 1000)));

    return res.status(429).json({
      error: "Too many requests. Please try again later.",
      retryAfter,
    });
  }

  entry.timestamps.push(now);

  res.setHeader("X-RateLimit-Limit", String(limit));
  res.setHeader("X-RateLimit-Remaining", String(limit - entry.timestamps.length));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil((now + WINDOW_MS) / 1000)));

  next();
}
