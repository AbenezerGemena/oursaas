import OpenAI from "openai";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import * as cheerio from "cheerio";
import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import {
  trainingSources,
  trainingChunks,
  trainingQaPairs,
  aiSettings,
} from "@shared/schema";

const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;

function getAIClient(apiKey: string, endpoint?: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: endpoint || "https://api.openai.com/v1",
  });
}

async function getChannelAIClient(channelId: string): Promise<OpenAI | null> {
  const [setting] = await db
    .select()
    .from(aiSettings)
    .where(
      and(eq(aiSettings.channelId, channelId), eq(aiSettings.isActive, true))
    )
    .limit(1);

  if (!setting?.apiKey) return null;
  return getAIClient(setting.apiKey, setting.endpoint || undefined);
}

function splitTextIntoChunks(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let i = 0;
  while (i < words.length) {
    const chunk = words.slice(i, i + CHUNK_SIZE).join(" ");
    if (chunk.trim()) chunks.push(chunk.trim());
    i += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
}

async function generateEmbedding(
  client: OpenAI,
  text: string
): Promise<number[]> {
  const response = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: text.substring(0, 8000),
  });
  return response.data[0].embedding;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function scrapeUrl(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
    },
    signal: AbortSignal.timeout(15000),
    redirect: "follow",
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);

  const html = await response.text();
  const $ = cheerio.load(html);

  const metaDescription = $('meta[name="description"]').attr("content") || "";
  const title = $("title").text().trim();
  const ogDescription = $('meta[property="og:description"]').attr("content") || "";

  $("script, style, nav, footer, header, aside, noscript, iframe, svg, link, meta").remove();

  let mainContent = "";
  const selectors = ["main", "article", "[role='main']", ".content", ".main-content", "#content", "#main"];
  for (const sel of selectors) {
    const text = $(sel).text().replace(/\s+/g, " ").trim();
    if (text && text.length > 100) {
      mainContent = text;
      break;
    }
  }

  if (!mainContent || mainContent.length < 50) {
    mainContent = $("body").text().replace(/\s+/g, " ").trim();
  }

  let finalContent = mainContent;
  if (finalContent.length < 50 && (metaDescription || ogDescription || title)) {
    finalContent = [title, metaDescription, ogDescription, finalContent].filter(Boolean).join(". ");
  }

  return finalContent;
}

export async function processTrainingSource(sourceId: string): Promise<void> {
  const [source] = await db
    .select()
    .from(trainingSources)
    .where(eq(trainingSources.id, sourceId));

  if (!source) throw new Error("Source not found");

  await db
    .update(trainingSources)
    .set({ status: "processing", updatedAt: new Date() })
    .where(eq(trainingSources.id, sourceId));

  try {
    let content = source.content || "";

    if (source.type === "url" && source.url) {
      content = await scrapeUrl(source.url);
    }

    if (!content.trim()) {
      await db
        .update(trainingSources)
        .set({
          status: "error",
          errorMessage: "No content found",
          updatedAt: new Date(),
        })
        .where(eq(trainingSources.id, sourceId));
      return;
    }

    await db
      .update(trainingSources)
      .set({ content, updatedAt: new Date() })
      .where(eq(trainingSources.id, sourceId));

    const chunks = splitTextIntoChunks(content);

    let aiClient: OpenAI | null = null;
    if (source.channelId) {
      aiClient = await getChannelAIClient(source.channelId);
    }

    await db
      .delete(trainingChunks)
      .where(eq(trainingChunks.sourceId, sourceId));

    for (const chunkText of chunks) {
      let embedding = null;
      if (aiClient) {
        try {
          embedding = await generateEmbedding(aiClient, chunkText);
        } catch (err) {
          console.warn("Embedding generation failed for chunk, storing without embedding");
        }
      }

      await db.insert(trainingChunks).values({
        sourceId,
        siteId: source.siteId,
        content: chunkText,
        embedding,
        metadata: {
          sourceName: source.name,
          sourceType: source.type,
          sourceUrl: source.url,
        },
      });
    }

    await db
      .update(trainingSources)
      .set({
        status: "completed",
        chunkCount: chunks.length,
        updatedAt: new Date(),
      })
      .where(eq(trainingSources.id, sourceId));
  } catch (error: any) {
    console.error("Training source processing error:", error);
    await db
      .update(trainingSources)
      .set({
        status: "error",
        errorMessage: error.message?.substring(0, 500),
        updatedAt: new Date(),
      })
      .where(eq(trainingSources.id, sourceId));
  }
}

export async function generateQaEmbedding(
  qaId: string,
  channelId: string
): Promise<void> {
  const aiClient = await getChannelAIClient(channelId);
  if (!aiClient) return;

  const [qa] = await db
    .select()
    .from(trainingQaPairs)
    .where(eq(trainingQaPairs.id, qaId));

  if (!qa) return;

  try {
    const embedding = await generateEmbedding(
      aiClient,
      `${qa.question} ${qa.answer}`
    );
    await db
      .update(trainingQaPairs)
      .set({ embedding, updatedAt: new Date() })
      .where(eq(trainingQaPairs.id, qaId));
  } catch (err) {
    console.warn("Q&A embedding generation failed:", err);
  }
}

export async function searchTrainingData(
  siteId: string,
  channelId: string,
  query: string,
  topK: number = 5
): Promise<{ chunks: string[]; qaPairs: Array<{ question: string; answer: string }> }> {
  const aiClient = channelId
    ? await getChannelAIClient(channelId)
    : null;

  let queryEmbedding: number[] | null = null;
  if (aiClient) {
    try {
      queryEmbedding = await generateEmbedding(aiClient, query);
    } catch (err) {
      console.warn("Query embedding failed, falling back to text search");
    }
  }

  const allChunks = await db
    .select()
    .from(trainingChunks)
    .where(eq(trainingChunks.siteId, siteId));

  let rankedChunks: Array<{ content: string; score: number }>;

  if (queryEmbedding && allChunks.some((c) => c.embedding)) {
    rankedChunks = allChunks
      .filter((c) => c.embedding)
      .map((c) => ({
        content: c.content,
        score: cosineSimilarity(queryEmbedding!, c.embedding as number[]),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  } else {
    const queryWords = query.toLowerCase().split(/\s+/);
    rankedChunks = allChunks
      .map((c) => {
        const lower = c.content.toLowerCase();
        const score = queryWords.filter((w) => lower.includes(w)).length;
        return { content: c.content, score };
      })
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  const allQa = await db
    .select()
    .from(trainingQaPairs)
    .where(
      and(eq(trainingQaPairs.siteId, siteId), eq(trainingQaPairs.isActive, true))
    );

  let rankedQa: Array<{ question: string; answer: string; score: number }>;

  if (queryEmbedding && allQa.some((q) => q.embedding)) {
    rankedQa = allQa
      .filter((q) => q.embedding)
      .map((q) => ({
        question: q.question,
        answer: q.answer,
        score: cosineSimilarity(queryEmbedding!, q.embedding as number[]),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  } else {
    const queryLower = query.toLowerCase();
    rankedQa = allQa
      .map((q) => {
        const score =
          q.question.toLowerCase().includes(queryLower) ||
          queryLower.includes(q.question.toLowerCase())
            ? 1
            : 0;
        return { question: q.question, answer: q.answer, score };
      })
      .filter((q) => q.score > 0)
      .slice(0, 3);
  }

  return {
    chunks: rankedChunks.map((c) => c.content),
    qaPairs: rankedQa.map((q) => ({
      question: q.question,
      answer: q.answer,
    })),
  };
}

export async function getTrainingStats(siteId: string) {
  const sources = await db
    .select()
    .from(trainingSources)
    .where(eq(trainingSources.siteId, siteId));

  const chunksCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(trainingChunks)
    .where(eq(trainingChunks.siteId, siteId));

  const qaCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(trainingQaPairs)
    .where(eq(trainingQaPairs.siteId, siteId));

  return {
    sources,
    totalChunks: Number(chunksCount[0]?.count || 0),
    totalQaPairs: Number(qaCount[0]?.count || 0),
  };
}
