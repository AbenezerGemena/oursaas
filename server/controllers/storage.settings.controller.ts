import { Request, Response } from "express";
import { OurSaasError, asyncHandler as _dHandler, oursaasLogger, HTTP_STATUS } from "@oursaas/core";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { storageSettings } from "@shared/schema";
import { S3Client, HeadBucketCommand } from "@aws-sdk/client-s3";

export const getStorageSettings = async (req: Request, res: Response) => {
  try {
    const [settings] = await db.select().from(storageSettings);
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch storage settings" });
  }
};

export const getActiveStorage = async (req: Request, res: Response) => {
  try {
    const active = await db
      .select()
      .from(storageSettings)
      .where(eq(storageSettings.isActive, true))
      .limit(1);
    res.json(active[0] || null);
  } catch {
    res.status(500).json({ error: "Failed to fetch active storage" });
  }
};

export const updateStorageSetting = async (req: Request, res: Response) => {
  try {
    const {
      id,
      spaceName,
      endpoint,
      region,
      accessKey,
      secretKey,
      isActive,
    } = req.body;

    if (!spaceName || !endpoint || !region || !accessKey || !secretKey) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (isActive) {
      
      await db.update(storageSettings).set({ isActive: false });
    }

    if (id) {
      
      await db
        .update(storageSettings)
        .set({
          spaceName,
          endpoint,
          region,
          accessKey,
          secretKey,
          isActive,
          updatedAt: new Date(),
        })
        .where(eq(storageSettings.id, id));
    } else {
      
      await db.insert(storageSettings).values({
        spaceName,
        endpoint,
        region,
        accessKey,
        secretKey,
        isActive,
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Storage update error:", error);
    res.status(500).json({ error: "Failed to update storage" });
  }
};

export const testStorageConnection = async (req: Request, res: Response) => {
  try {
    const [config] = await db
      .select()
      .from(storageSettings)
      .where(eq(storageSettings.isActive, true))
      .limit(1);

    if (!config) {
      return res.json({ success: false, status: "offline", error: "No active storage configuration found" });
    }

    let cleanEndpoint = config.endpoint.trim().replace(/\/$/, '');
    if (!/^https?:\/\//i.test(cleanEndpoint)) {
      cleanEndpoint = `https://${cleanEndpoint}`;
    }
    const urlParts = new URL(cleanEndpoint);
    const hostParts = urlParts.host.split('.');
    if (hostParts.length > 3) {
      hostParts.shift();
      urlParts.host = hostParts.join('.');
      cleanEndpoint = urlParts.toString();
    }

    const s3Client = new S3Client({
      endpoint: cleanEndpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      forcePathStyle: false,
    });

    try {
      await s3Client.send(new HeadBucketCommand({ Bucket: config.spaceName }));
      return res.json({ success: true, status: "online" });
    } finally {
      s3Client.destroy();
    }
  } catch (error: any) {
    const message = error?.name === "NotFound"
      ? "Bucket not found"
      : error?.name === "CredentialsProviderError" || error?.Code === "InvalidAccessKeyId"
        ? "Invalid credentials"
        : error?.message || "Connection failed";
    return res.json({ success: false, status: "offline", error: message });
  }
};

export const deleteStorageSetting = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.delete(storageSettings).where(eq(storageSettings.id, id));
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to delete storage" });
  }
};
