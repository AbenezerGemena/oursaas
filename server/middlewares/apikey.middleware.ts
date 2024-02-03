import { Request, Response, NextFunction } from "express";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import { db } from "../db";
import { eq, and, gt, sql } from "drizzle-orm";
import { clientApiKeys, clientApiUsageLogs, subscriptions, channels } from "@shared/schema";
import bcrypt from "bcryptjs";

declare global {
  namespace Express {
    interface Request {
      apiUser?: {
        userId: string;
        channelId: string | null;
        apiKeyId: string;
        permissions: string[];
      };
    }
  }
}

export const requireApiKey = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiKey = req.headers["x-api-key"] as string;
    const apiSecret = req.headers["x-api-secret"] as string;

    if (!apiKey || !apiSecret) {
      return res.status(401).json({ success: false, error: "Missing API key or secret" });
    }

    const [keyRecord] = await db
      .select()
      .from(clientApiKeys)
      .where(
        and(
          eq(clientApiKeys.apiKey, apiKey),
          eq(clientApiKeys.isActive, true)
        )
      )
      .limit(1);

    if (!keyRecord) {
      return res.status(401).json({ success: false, error: "Invalid API key" });
    }

    if (keyRecord.revokedAt) {
      return res.status(401).json({ success: false, error: "API key has been revoked" });
    }

    const secretValid = await bcrypt.compare(apiSecret, keyRecord.secretHash);
    if (!secretValid) {
      return res.status(401).json({ success: false, error: "Invalid API secret" });
    }

    const [subscription] = await db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, keyRecord.userId),
          eq(subscriptions.status, "active")
        )
      )
      .limit(1);

    let apiRequestsPerMonth = 10000;
    let apiRateLimitPerMinute = 60;

    if (subscription) {
      const planData = subscription.planData as any;
      if (planData?.permissions?.apiRequestsPerMonth) {
        apiRequestsPerMonth = parseInt(planData.permissions.apiRequestsPerMonth, 10) || 10000;
      }
      if (planData?.permissions?.apiRateLimitPerMinute) {
        apiRateLimitPerMinute = parseInt(planData.permissions.apiRateLimitPerMinute, 10) || 60;
      }
    }

    const now = new Date();
    let currentMonthlyCount = keyRecord.monthlyRequestCount || 0;

    if (!keyRecord.monthlyResetAt || new Date(keyRecord.monthlyResetAt) < now) {
      currentMonthlyCount = 0;
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      await db
        .update(clientApiKeys)
        .set({ monthlyRequestCount: 0, monthlyResetAt: nextMonth })
        .where(eq(clientApiKeys.id, keyRecord.id));
    }

    if (currentMonthlyCount >= apiRequestsPerMonth) {
      return res.status(429).json({
        success: false,
        error: "Monthly API request limit exceeded",
        limit: apiRequestsPerMonth,
        used: currentMonthlyCount,
      });
    }

    const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);
    const [rateLimitResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(clientApiUsageLogs)
      .where(
        and(
          eq(clientApiUsageLogs.apiKeyId, keyRecord.id),
          gt(clientApiUsageLogs.createdAt, oneMinuteAgo)
        )
      );

    const recentRequests = rateLimitResult?.count || 0;
    if (recentRequests >= apiRateLimitPerMinute) {
      return res.status(429).json({
        success: false,
        error: "Rate limit exceeded. Try again later.",
        limit: apiRateLimitPerMinute,
        retryAfter: 60,
      });
    }

    let resolvedChannelId = keyRecord.channelId;

    if (!resolvedChannelId) {
      const headerChannelId = req.headers["x-channel-id"] as string;
      const queryChannelId = req.query.channel_id as string;
      const overrideChannelId = headerChannelId || queryChannelId;

      if (overrideChannelId) {
        const [ch] = await db
          .select({ id: channels.id, createdBy: channels.createdBy })
          .from(channels)
          .where(eq(channels.id, overrideChannelId))
          .limit(1);

        if (!ch) {
          return res.status(404).json({ success: false, error: "Channel not found" });
        }

        if (ch.createdBy !== keyRecord.userId) {
          return res.status(403).json({ success: false, error: "Channel does not belong to this API key's owner" });
        }

        resolvedChannelId = ch.id;
      }
    }

    req.apiUser = {
      userId: keyRecord.userId,
      channelId: resolvedChannelId,
      apiKeyId: keyRecord.id,
      permissions: (keyRecord.permissions as string[]) || [],
    };

    db.update(clientApiKeys)
      .set({
        lastUsedAt: now,
        requestCount: sql`${clientApiKeys.requestCount} + 1`,
        monthlyRequestCount: sql`${clientApiKeys.monthlyRequestCount} + 1`,
      })
      .where(eq(clientApiKeys.id, keyRecord.id))
      .then(() => {})
      .catch((err: any) => console.error("Failed to update API key usage:", err));

    const startTime = Date.now();
    res.on("finish", () => {
      const responseTime = Date.now() - startTime;
      db.insert(clientApiUsageLogs)
        .values({
          apiKeyId: keyRecord.id,
          userId: keyRecord.userId,
          channelId: keyRecord.channelId,
          endpoint: req.originalUrl,
          method: req.method,
          statusCode: res.statusCode,
          responseTime,
          ipAddress: (req.headers["x-forwarded-for"] as string)?.split(",")[0] || req.ip || null,
        })
        .then(() => {})
        .catch((err: any) => console.error("Failed to log API usage:", err));
    });

    next();
  } catch (error) {
    console.error("API key authentication error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};

const ALL_API_PERMISSIONS = [
  "messages.send",
  "messages.read",
  "contacts.read",
  "contacts.write",
  "templates.read",
  "campaigns.read",
  "account.read",
  "webhooks.manage",
];

export const requirePermission = (...requiredPermissions: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.apiUser) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const userPermissions = req.apiUser.permissions;
    const effectivePermissions = userPermissions && userPermissions.length > 0
      ? userPermissions
      : ALL_API_PERMISSIONS;

    const hasPermission = requiredPermissions.some((p) => effectivePermissions.includes(p));
    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        error: "Insufficient permissions",
        required: requiredPermissions,
      });
    }

    next();
  };
};
