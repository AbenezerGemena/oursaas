import type { Express } from "express";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import { requireAuth } from "../middlewares/auth.middleware";
import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import {
  trainingSources,
  trainingChunks,
  trainingQaPairs,
} from "@shared/schema";
import {
  processTrainingSource,
  generateQaEmbedding,
  searchTrainingData,
  getTrainingStats,
  scrapeUrl,
} from "../services/training.service";
import multer from "multer";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/pdf",
      "text/plain",
      "text/csv",
      "text/markdown",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Unsupported file type. Use PDF, TXT, CSV, DOCX, or MD files."));
    }
  },
});

export function registerTrainingRoutes(app: Express) {

  app.get("/api/training/:siteId/sources", requireAuth, async (req, res) => {
    try {
      const sources = await db
        .select()
        .from(trainingSources)
        .where(eq(trainingSources.siteId, req.params.siteId))
        .orderBy(desc(trainingSources.createdAt));

      res.json(sources);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/training/:siteId/url", requireAuth, async (req, res) => {
    try {
      const { url, name, channelId } = req.body;
      if (!url) return res.status(400).json({ error: "URL is required" });

      const [source] = await db
        .insert(trainingSources)
        .values({
          siteId: req.params.siteId,
          channelId: channelId || null,
          type: "url",
          name: name || url,
          url,
          status: "pending",
        })
        .returning();

      processTrainingSource(source.id).catch((err) =>
        console.error("Background URL processing error:", err)
      );

      res.json(source);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post(
    "/api/training/:siteId/document",
    requireAuth,
    upload.single("file"),
    async (req, res) => {
      try {
        const file = req.file;
        if (!file) return res.status(400).json({ error: "File is required" });

        let content = "";

        if (file.mimetype === "application/pdf") {
          const uint8Array = new Uint8Array(file.buffer.buffer, file.buffer.byteOffset, file.buffer.byteLength);
          const parser = new PDFParse(uint8Array);
          await parser.load();
          const result = await parser.getText();
          content = typeof result === "string" ? result : (result?.text || "");
        } else if (file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
          const result = await mammoth.extractRawText({ buffer: file.buffer });
          content = result.value;
        } else {
          content = file.buffer.toString("utf-8");
        }

        if (!content.trim()) {
          return res.status(400).json({ error: "No text content found in file" });
        }

        const [source] = await db
          .insert(trainingSources)
          .values({
            siteId: req.params.siteId,
            channelId: req.body.channelId || null,
            type: "document",
            name: file.originalname,
            content,
            status: "pending",
          })
          .returning();

        processTrainingSource(source.id).catch((err) =>
          console.error("Background document processing error:", err)
        );

        res.json(source);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    }
  );

  app.post("/api/training/:siteId/text", requireAuth, async (req, res) => {
    try {
      const { content, name, channelId } = req.body;
      if (!content) return res.status(400).json({ error: "Content is required" });

      const [source] = await db
        .insert(trainingSources)
        .values({
          siteId: req.params.siteId,
          channelId: channelId || null,
          type: "text",
          name: name || "Custom Text",
          content,
          status: "pending",
        })
        .returning();

      processTrainingSource(source.id).catch((err) =>
        console.error("Background text processing error:", err)
      );

      res.json(source);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/training/:siteId/kb-sync", requireAuth, async (req, res) => {
    try {
      const { channelId, articles } = req.body;
      if (!articles || !Array.isArray(articles)) {
        return res.status(400).json({ error: "Articles array is required" });
      }

      const existingKbSources = await db
        .select()
        .from(trainingSources)
        .where(
          and(
            eq(trainingSources.siteId, req.params.siteId),
            eq(trainingSources.type, "knowledge_base")
          )
        );

      for (const existing of existingKbSources) {
        await db
          .delete(trainingChunks)
          .where(eq(trainingChunks.sourceId, existing.id));
      }
      await db
        .delete(trainingSources)
        .where(
          and(
            eq(trainingSources.siteId, req.params.siteId),
            eq(trainingSources.type, "knowledge_base")
          )
        );

      const kbContent = articles
        .map(
          (a: any) =>
            `## ${a.title}\n${(a.content || "").replace(/<[^>]*>/g, "")}`
        )
        .join("\n\n");

      if (!kbContent.trim()) {
        return res.json({ message: "No KB content to sync", count: 0 });
      }

      const [source] = await db
        .insert(trainingSources)
        .values({
          siteId: req.params.siteId,
          channelId: channelId || null,
          type: "knowledge_base",
          name: "Knowledge Base Articles",
          content: kbContent,
          status: "pending",
        })
        .returning();

      processTrainingSource(source.id).catch((err) =>
        console.error("Background KB sync error:", err)
      );

      res.json({ message: "KB sync started", sourceId: source.id, articleCount: articles.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/training/source/:sourceId", requireAuth, async (req, res) => {
    try {
      await db
        .delete(trainingChunks)
        .where(eq(trainingChunks.sourceId, req.params.sourceId));
      await db
        .delete(trainingSources)
        .where(eq(trainingSources.id, req.params.sourceId));

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/training/source/:sourceId/reprocess", requireAuth, async (req, res) => {
    try {
      processTrainingSource(req.params.sourceId).catch((err) =>
        console.error("Reprocessing error:", err)
      );
      res.json({ message: "Reprocessing started" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/training/:siteId/qa", requireAuth, async (req, res) => {
    try {
      const pairs = await db
        .select()
        .from(trainingQaPairs)
        .where(eq(trainingQaPairs.siteId, req.params.siteId))
        .orderBy(desc(trainingQaPairs.createdAt));

      res.json(pairs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/training/:siteId/qa", requireAuth, async (req, res) => {
    try {
      const { question, answer, category, channelId } = req.body;
      if (!question || !answer) {
        return res.status(400).json({ error: "Question and answer are required" });
      }

      const [qa] = await db
        .insert(trainingQaPairs)
        .values({
          siteId: req.params.siteId,
          channelId: channelId || null,
          question,
          answer,
          category: category || "general",
        })
        .returning();

      if (channelId) {
        generateQaEmbedding(qa.id, channelId).catch((err) =>
          console.warn("Q&A embedding error:", err)
        );
      }

      res.json(qa);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/training/qa/:qaId", requireAuth, async (req, res) => {
    try {
      const { question, answer, category, isActive, channelId } = req.body;

      const updateData: any = { updatedAt: new Date() };
      if (question !== undefined) updateData.question = question;
      if (answer !== undefined) updateData.answer = answer;
      if (category !== undefined) updateData.category = category;
      if (isActive !== undefined) updateData.isActive = isActive;

      const [updated] = await db
        .update(trainingQaPairs)
        .set(updateData)
        .where(eq(trainingQaPairs.id, req.params.qaId))
        .returning();

      if (channelId && (question || answer)) {
        generateQaEmbedding(updated.id, channelId).catch((err) =>
          console.warn("Q&A embedding update error:", err)
        );
      }

      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/training/qa/:qaId", requireAuth, async (req, res) => {
    try {
      await db
        .delete(trainingQaPairs)
        .where(eq(trainingQaPairs.id, req.params.qaId));

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/training/:siteId/stats", requireAuth, async (req, res) => {
    try {
      const stats = await getTrainingStats(req.params.siteId);
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/training/:siteId/preview", requireAuth, async (req, res) => {
    try {
      const sources = await db
        .select()
        .from(trainingSources)
        .where(eq(trainingSources.siteId, req.params.siteId))
        .orderBy(desc(trainingSources.createdAt));

      const chunks = await db
        .select({
          id: trainingChunks.id,
          sourceId: trainingChunks.sourceId,
          content: trainingChunks.content,
          metadata: trainingChunks.metadata,
          hasEmbedding: trainingChunks.embedding,
        })
        .from(trainingChunks)
        .where(eq(trainingChunks.siteId, req.params.siteId));

      const qaPairs = await db
        .select()
        .from(trainingQaPairs)
        .where(eq(trainingQaPairs.siteId, req.params.siteId))
        .orderBy(desc(trainingQaPairs.createdAt));

      res.json({
        sources,
        chunks: chunks.map((c) => ({
          ...c,
          hasEmbedding: !!c.hasEmbedding,
          contentPreview: c.content.substring(0, 200) + (c.content.length > 200 ? "..." : ""),
        })),
        qaPairs,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/training/:siteId/test-chat", requireAuth, async (req, res) => {
    try {
      const { message, channelId, widgetConfig } = req.body;
      if (!message) return res.status(400).json({ error: "Message is required" });

      const trainingData = await searchTrainingData(
        req.params.siteId,
        channelId || "",
        message
      );

      let contextBlock = "";
      if (trainingData.chunks.length > 0) {
        contextBlock += "\n\n--- TRAINING DATA CONTEXT ---\n";
        contextBlock += trainingData.chunks.join("\n\n");
      }
      if (trainingData.qaPairs.length > 0) {
        contextBlock += "\n\n--- FAQ PAIRS ---\n";
        for (const qa of trainingData.qaPairs) {
          contextBlock += `Q: ${qa.question}\nA: ${qa.answer}\n\n`;
        }
      }

      const systemPrompt =
        (widgetConfig?.systemPrompt || "You are a helpful assistant.") +
        contextBlock;

      const aiSettingResult = await db
        .select()
        .from(
          (await import("@shared/schema")).aiSettings
        )
        .where(
          eq(
            (await import("@shared/schema")).aiSettings.channelId,
            channelId || ""
          )
        )
        .limit(1);

      const activeSetting = aiSettingResult?.[0];
      if (!activeSetting?.apiKey) {
        return res.status(400).json({
          error: "No AI provider configured. Add an API key in AI Settings first.",
        });
      }

      const client = new (await import("openai")).default({
        apiKey: activeSetting.apiKey,
        baseURL: activeSetting.endpoint || "https://api.openai.com/v1",
      });

      const model = activeSetting.model || "gpt-4o-mini";
      const temperature = parseFloat(activeSetting.temperature || "0.7");
      const maxTokens = parseInt(activeSetting.maxTokens || "500");

      const completion = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
        temperature,
        max_tokens: maxTokens,
      });

      const response =
        completion.choices?.[0]?.message?.content || "No response generated.";

      res.json({
        response,
        contextUsed: {
          chunksFound: trainingData.chunks.length,
          qaPairsFound: trainingData.qaPairs.length,
        },
      });
    } catch (error: any) {
      console.error("Test chat error:", error);
      res.status(500).json({ error: error.message });
    }
  });
}
