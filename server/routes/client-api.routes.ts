import type { Express } from "express";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import { Request, Response } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { db } from "../db";
import { eq, and, desc, sql } from "drizzle-orm";
import * as schema from "@shared/schema";
import { requireAuth } from "../middlewares/auth.middleware";

export function registerClientApiRoutes(app: Express) {
  app.post("/api/api-keys", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const { name, channelId, permissions } = req.body;

      if (!name) {
        return res.status(400).json({ success: false, error: "Name is required" });
      }

      const apiKey = crypto.randomBytes(32).toString("hex");
      const secret = crypto.randomBytes(32).toString("hex");
      const secretHash = bcrypt.hashSync(secret, 10);

      const [created] = await db
        .insert(schema.clientApiKeys)
        .values({
          userId: user.id,
          channelId: channelId || null,
          name,
          apiKey,
          secretHash,
          permissions: permissions || [],
          isActive: true,
        })
        .returning();

      return res.status(201).json({
        success: true,
        data: {
          id: created.id,
          name: created.name,
          apiKey,
          secret,
          channelId: created.channelId,
          permissions: created.permissions,
          createdAt: created.createdAt,
          note: "Store the secret securely. It will not be shown again.",
        },
      });
    } catch (error) {
      console.error("Error creating API key:", error);
      return res.status(500).json({ success: false, error: "Failed to create API key" });
    }
  });

  app.get("/api/api-keys", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user!;

      const keys = await db
        .select({
          id: schema.clientApiKeys.id,
          name: schema.clientApiKeys.name,
          apiKey: schema.clientApiKeys.apiKey,
          channelId: schema.clientApiKeys.channelId,
          permissions: schema.clientApiKeys.permissions,
          isActive: schema.clientApiKeys.isActive,
          lastUsedAt: schema.clientApiKeys.lastUsedAt,
          requestCount: schema.clientApiKeys.requestCount,
          monthlyRequestCount: schema.clientApiKeys.monthlyRequestCount,
          createdAt: schema.clientApiKeys.createdAt,
          revokedAt: schema.clientApiKeys.revokedAt,
        })
        .from(schema.clientApiKeys)
        .where(eq(schema.clientApiKeys.userId, user.id))
        .orderBy(desc(schema.clientApiKeys.createdAt));

      return res.json({ success: true, data: keys });
    } catch (error) {
      console.error("Error listing API keys:", error);
      return res.status(500).json({ success: false, error: "Failed to list API keys" });
    }
  });

  app.post("/api/api-keys/:id/revoke", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const { id } = req.params;

      const [key] = await db
        .select()
        .from(schema.clientApiKeys)
        .where(
          and(
            eq(schema.clientApiKeys.id, id),
            eq(schema.clientApiKeys.userId, user.id)
          )
        )
        .limit(1);

      if (!key) {
        return res.status(404).json({ success: false, error: "API key not found" });
      }

      if (key.revokedAt) {
        return res.status(400).json({ success: false, error: "API key is already revoked" });
      }

      await db
        .update(schema.clientApiKeys)
        .set({ isActive: false, revokedAt: new Date() })
        .where(eq(schema.clientApiKeys.id, id));

      return res.json({ success: true, data: { message: "API key revoked successfully" } });
    } catch (error) {
      console.error("Error revoking API key:", error);
      return res.status(500).json({ success: false, error: "Failed to revoke API key" });
    }
  });

  app.get("/api/api-keys/usage", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user!;

      const keys = await db
        .select({
          id: schema.clientApiKeys.id,
          name: schema.clientApiKeys.name,
          requestCount: schema.clientApiKeys.requestCount,
          monthlyRequestCount: schema.clientApiKeys.monthlyRequestCount,
          lastUsedAt: schema.clientApiKeys.lastUsedAt,
          createdAt: schema.clientApiKeys.createdAt,
          isActive: schema.clientApiKeys.isActive,
        })
        .from(schema.clientApiKeys)
        .where(eq(schema.clientApiKeys.userId, user.id))
        .orderBy(desc(schema.clientApiKeys.createdAt));

      const [totalUsage] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.clientApiUsageLogs)
        .where(eq(schema.clientApiUsageLogs.userId, user.id));

      const activeKeys = keys.filter((k: any) => k.isActive).length;
      const revokedKeys = keys.filter((k: any) => !k.isActive).length;
      const monthlyRequests = keys.reduce((sum: number, k: any) => sum + (k.monthlyRequestCount || 0), 0);
      const totalRequests = totalUsage?.total || 0;

      return res.json({
        success: true,
        data: {
          keys,
          totalRequests,
          monthlyRequests,
          activeKeys,
          revokedKeys,
        },
      });
    } catch (error) {
      console.error("Error fetching API key usage:", error);
      return res.status(500).json({ success: false, error: "Failed to fetch usage statistics" });
    }
  });
}
