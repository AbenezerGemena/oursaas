import { Request, Response } from "express";
import { OurSaasError, asyncHandler as _dHandler, oursaasLogger, HTTP_STATUS } from "@oursaas/core";
import { db } from "../db";
import { eq, ne, and } from "drizzle-orm";
import { aiSettings } from "@shared/schema";

export const getAISettings = async (req: Request, res: Response) => {
  try {
    const settings = await db.select().from(aiSettings);
    res.json(settings);
  } catch (error) {
    console.error("❌ Error fetching AI settings:", error);
    res.status(500).json({ error: "Failed to fetch AI settings" });
  }
};

export const getAISettingByChannelId = async (req: Request, res: Response) => {
  try {
    const { channelId } = req.params;

    console.log("Fetching AI setting for channelId:", channelId);

    const settings = await db
      .select()
      .from(aiSettings)
      .where(eq(aiSettings.channelId, channelId))
      .limit(1);

    
    
    
    
    

    return res.status(200).json(settings[0] ?? null);
  } catch (error) {
    console.error("❌ Error fetching AI setting by channelId:", error);
    return res.status(500).json({
      error: "Failed to fetch AI settings for channel",
    });
  }
};

export const createAISettings = async (req: Request, res: Response) => {
  try {
    const {
      provider,
      channelId,
      apiKey,
      model,
      endpoint,
      temperature,
      maxTokens,
      isActive,
      words
    } = req.body;

    if (!apiKey) {
      return res.status(400).json({ error: "API key is required" });
    }

    
    if (channelId) {
      const existing = await db
        .select()
        .from(aiSettings)
        .where(eq(aiSettings.channelId, channelId))
        .limit(1);

      if (existing.length > 0) {
        return res.status(400).json({
          error: "AI settings already exist for this channel",
          data: existing[0],
        });
      }
    }

    
    let wordsArray: string[] = [];
    if (typeof words === "string") {
      try {
        wordsArray = JSON.parse(words);
      } catch {
        wordsArray = words
          .split(",")
          .map((w: string) => w.trim())
          .filter(Boolean);
      }
    } else if (Array.isArray(words)) {
      wordsArray = words.map((w) => w.trim()).filter(Boolean);
    }

    
    if (isActive && channelId) {
      await db
        .update(aiSettings)
        .set({ isActive: false })
        .where(eq(aiSettings.channelId, channelId));
    }

    const [inserted] = await db
      .insert(aiSettings)
      .values({
        provider: provider || "openai",
        channelId: channelId || null,
        apiKey,
        model: model || "gpt-4o-mini",
        endpoint: endpoint || "https://api.openai.com/v1",
        temperature: temperature?.toString() || "0.7",
        maxTokens: maxTokens?.toString() || "2048",
        isActive: !!isActive,
        words: wordsArray,
      })
      .returning();

    res.status(201).json(inserted);
  } catch (error) {
    console.error("❌ Error creating AI setting:", error);
    res.status(500).json({ error: "Failed to create AI setting" });
  }
};

export const updateAISettings = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { apiKey, provider, model, endpoint, temperature, maxTokens, isActive, words } = req.body;

    const existing = await db.query.aiSettings.findFirst({
      where: (table, { eq }) => eq(table.id, id),
    });

    if (!existing) {
      return res.status(404).json({ error: "Setting not found" });
    }

    
    let wordsArray: string[] | undefined;
    if (typeof words === "string") {
      try {
        wordsArray = JSON.parse(words);
      } catch {
        wordsArray = words.split(",").map((w: string) => w.trim()).filter(Boolean);
      }
    } else if (Array.isArray(words)) {
      wordsArray = words.map((w) => w.trim()).filter(Boolean);
    }

    
    if (isActive && existing.channelId) {
      await db.update(aiSettings)
        .set({ isActive: false })
        .where(and(eq(aiSettings.channelId, existing.channelId), ne(aiSettings.id, id)));
    }

    const [updated] = await db
      .update(aiSettings)
      .set({
        provider: provider ?? existing.provider,
        apiKey: apiKey ?? existing.apiKey,
        channelId: existing.channelId,
        model: model ?? existing.model,
        endpoint: endpoint ?? existing.endpoint,
        temperature: temperature?.toString() ?? existing.temperature,
        maxTokens: maxTokens?.toString() ?? existing.maxTokens,
        isActive: isActive ?? existing.isActive,
        words: wordsArray ?? existing.words,
        updatedAt: new Date(),
      })
      .where(eq(aiSettings.id, id))
      .returning();

    res.json(updated);
  } catch (error) {
    console.error("❌ Error updating AI setting:", error);
    res.status(500).json({ error: "Failed to update AI setting" });
  }
};

export const deleteAISettings = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.delete(aiSettings).where(eq(aiSettings.id, id));
    res.json({ message: "AI setting deleted successfully" });
  } catch (error) {
    console.error("❌ Error deleting AI setting:", error);
    res.status(500).json({ error: "Failed to delete AI setting" });
  }
};
