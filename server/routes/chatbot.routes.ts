import { Router } from 'express';
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import type { Express } from "express";
import { storage } from 'server/storage';
import OpenAI from 'openai';
import { requireAuth } from 'server/middlewares/auth.middleware';
import { aiSettings, insertSiteSchema, panelConfig, sites, trainingQaPairs } from '@shared/schema';
import { requireSubscription } from 'server/middlewares/requireSubscription';
import { eq, and } from 'drizzle-orm';
import { db } from 'server/db';
import { searchTrainingData } from '../services/training.service';
import multer from 'multer';
import path from 'path';

function buildAIClient(aiSetting) {
  if (aiSetting.provider === "openai") {
    return new OpenAI({
      apiKey: aiSetting.apiKey,
      baseURL: aiSetting.endpoint || "https://api.openai.com/v1",
    });
  }

  
  return new OpenAI({
    apiKey: aiSetting.apiKey,
    baseURL: aiSetting.endpoint || "https://api.openai.com/v1",
  });
}

export function registerWidgetRoutes(app: Express) {
  
  
  app.use('/api/widget', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  
  app.get("/api/widget/config/:siteId", async (req, res) => {
    try {
      const { siteId } = req.params;
      const site = await storage.getSite(siteId);
      
      
      if (!site) {
        return res.status(404).json({ error: "Site not found" });
      }
      

      const [brandName] = await db
  .select({
    name: panelConfig.name
  })
  .from(panelConfig);

      
      const name = brandName?.name;
      

res.json({
  config: { ...(site.widgetConfig || {}), brandName: name },
  siteId: site.id,
  siteName: site.name,
  domain: site.domain,
});
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch widget configuration" });
    }
  });

  
  app.get("/api/widget/kb/:siteId", async (req, res) => {
    try {
      const site = await storage.getSite(req.params.siteId);
      if (!site || !site.widgetEnabled) {
        return res.status(404).json({ error: "Widget not available" });
      }
      
      const categoriesTree = await storage.getKnowledgeCategoriesTree(req.params.siteId);
      const allCategories = await storage.getKnowledgeCategories(req.params.siteId);
      const articlesMap = new Map();
      
      for (const category of allCategories) {
        const articles = await storage.getKnowledgeArticles(category.id);
        articlesMap.set(category.id, articles);
      }
      
      const processCategoryTree = (categories: any[]): any[] => {
        return categories.map(cat => ({
          id: cat.id,
          name: cat.name,
          icon: cat.icon,
          articleCount: articlesMap.get(cat.id)?.length || 0,
          articles: (articlesMap.get(cat.id) || []).map(article => ({
            id: article.id,
            title: article.title,
            preview: article.content.replace(/<[^>]*>/g, '').substring(0, 150) + '...',
          })),
          subcategories: processCategoryTree(cat.subcategories || [])
        }));
      };
      
      const kbData = {
        categories: processCategoryTree(categoriesTree)
      };
      
      res.json(kbData);
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch knowledge base" });
    }
  });

  app.get("/api/widget/qa/:siteId", async (req, res) => {
    try {
      const site = await storage.getSite(req.params.siteId);
      if (!site) {
        return res.status(404).json({ error: "Site not found" });
      }

      const qaPairs = await db
        .select({
          id: trainingQaPairs.id,
          question: trainingQaPairs.question,
          answer: trainingQaPairs.answer,
          category: trainingQaPairs.category,
        })
        .from(trainingQaPairs)
        .where(
          and(
            eq(trainingQaPairs.siteId, req.params.siteId),
            eq(trainingQaPairs.isActive, true)
          )
        );

      const categories = [...new Set(qaPairs.map(q => q.category))];
      const grouped = categories.map(cat => ({
        name: cat,
        pairs: qaPairs.filter(q => q.category === cat),
      }));

      res.json({ qaPairs, categories: grouped });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch Q&A pairs" });
    }
  });

  
  app.get("/api/widget/article/:articleId", async (req, res) => {
    try {
      const article = await storage.getKnowledgeArticle(req.params.articleId);
      if (!article) {
        return res.status(404).json({ error: "Article not found" });
      }
      
      const category = await storage.getKnowledgeCategory(article.categoryId);
      if (!category) {
        return res.status(404).json({ error: "Category not found" });
      }
      
      const site = await storage.getSite(category.siteId);
      if (!site || !site.widgetEnabled) {
        return res.status(404).json({ error: "Widget not available" });
      }
      
      res.json({
        id: article.id,
        title: article.title,
        content: article.content,
      });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch article" });
    }
  });

  
  app.post("/api/widget/contacts",requireSubscription('contacts'), async (req, res) => {
    try {
      const { siteId, name, email, phone, source } = req.body;
      console.log("widget contact body", req.body)
      const site = await storage.getSite(siteId);
      if (!site) {
        return res.status(404).json({ error: "Site not found" });
      }

      const getCreated = await storage.getChannel(site.channelId!);
      
      
      let [contact] = await storage.getContactByEmail(email);
      
      
      if (!contact) {
        contact = await storage.createContact({
          channelId: site?.channelId || null,
          name,
          email,
          phone,
          createdBy: getCreated?.createdBy || null,
          source: source || 'chat_widget',
          tags: ['widget-lead'],
        });
      }

      res.json({ success: true, contactId: contact.id });
    } catch (error: any) {
      console.error('Failed to save contact:', error);
      res.status(500).json({ error: "Failed to save contact" });
    }
  });

app.post("/api/widget/chat", async (req, res) => {
  const io = (global as any).io;

  try {
    const { siteId, channelId, sessionId, conversationId, message, visitorInfo, enableAiAutoReply } = req.body;

    if (!message || !siteId || !sessionId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const site = await storage.getSite(siteId);
    if (!site || !site.widgetEnabled) {
      return res.status(404).json({ error: "Widget not available" });
    }

    const humanKeywords = [
      "human", "agent", "person", "support", "real person", "real human",
      "representative", "talk to someone", "customer care", "customer support"
    ];
    const wantsHuman = humanKeywords.some((kw) =>
      message.toLowerCase().includes(kw)
    );

    let contact = null;
    if (visitorInfo?.email) {
      const contacts = await storage.getContactByEmail(visitorInfo.email);
      contact = contacts?.[0] || null;
      if (!contact) {
        contact = await storage.createContact({
          tenantId: site.tenantId,
          channelId: channelId || site.tenantId,
          name: visitorInfo.name || "Anonymous",
          email: visitorInfo.email,
          phone: visitorInfo.mobile || "",
          source: "chat_widget",
          tags: ["widget-user"],
        });
      } else if (visitorInfo.name && contact.name !== visitorInfo.name) {
        await storage.updateContact(contact.id, {
          name: visitorInfo.name,
          phone: visitorInfo.mobile || contact.phone,
        });
        contact = { ...contact, name: visitorInfo.name, phone: visitorInfo.mobile || contact.phone };
      }
    }

    let conversation;
    if (conversationId) {
      conversation = await storage.getConversation(conversationId);
    }

    if (!conversation && contact) {
      const contactConversations = await storage.getConversationsByContact(contact.id);
      const existingChat = contactConversations.find(
        (c: any) => c.type === "chatbot" && c.status !== "closed"
      ) || contactConversations.find(
        (c: any) => c.type === "chatbot"
      );
      if (existingChat) {
        conversation = existingChat;
      }
    }

    if (!conversation) {
      conversation = await storage.createConversation({
        channelId: channelId || null,
        contactId: contact?.id || null,
        contactName: visitorInfo?.name || "Anonymous",
        contactPhone: visitorInfo?.mobile || "",
        status: "open",
        type: "chatbot",
        sessionId: sessionId,
        tags: ["widget-chat"],
      });

      if (io) {
        io.to(`site:${channelId}`).emit("conversation_created");
      }
    } else {
      const updates: any = { updatedAt: new Date() };
      if (visitorInfo?.name && (!conversation.contactName || conversation.contactName === "Anonymous")) {
        updates.contactName = visitorInfo.name;
      }
      if (visitorInfo?.mobile && !conversation.contactPhone) {
        updates.contactPhone = visitorInfo.mobile;
      }
      if (contact && !conversation.contactId) {
        updates.contactId = contact.id;
      }
      if (Object.keys(updates).length > 1) {
        await storage.updateConversation(conversation.id, updates);
        conversation = { ...conversation, ...updates };
      }
    }

    const userMessage = await storage.createMessage({
      conversationId: conversation.id,
      content: message,
      direction: "inbound",
      fromUser: true,
      fromType: "user",
      type: "text",
      status: "received",
    });

    async function assignToRandomAgent(conv: any, siteData: any) {
      const teamMembers = siteData?.widgetConfig?.teamMembers || [];
      if (teamMembers.length === 0) return null;
      const validMembers = teamMembers.filter((m: any) => m.userId);
      if (validMembers.length === 0) return null;
      const randomAgent = validMembers[Math.floor(Math.random() * validMembers.length)];
      await storage.updateConversation(conv.id, {
        status: "assigned",
        assignedTo: randomAgent.userId,
        updatedAt: new Date(),
      });
      if (io) {
        io.to(`site:${channelId}`).emit("conversation_assigned", {
          conversationId: conv.id,
          agent: { userId: randomAgent.userId, name: randomAgent.name },
        });
      }
      return randomAgent;
    }

    let aiResponse: string | null = null;
    let aiMessageId = null;

    const isAssigned = conversation.status === "assigned" && conversation.assignedTo;

    let hasHumanAgentReplied = false;
    if (isAssigned) {
      const convMessages = await storage.getConversationMessages(conversation.id);
      hasHumanAgentReplied = convMessages.some((m: any) => m.fromType === "agent" || m.fromType === "human");
    }

    if (wantsHuman && !isAssigned) {
      const assignedAgent = await assignToRandomAgent(conversation, site);
      if (assignedAgent) {
        aiResponse = `I've connected you with ${assignedAgent.name} from our ${assignedAgent.role || 'support'} team. They'll assist you shortly.`;
      } else {
        aiResponse = "All our agents are currently offline. Please wait while we connect you soon.";
        await storage.updateConversation(conversation.id, {
          status: "pending",
          updatedAt: new Date(),
        });
      }

      const botMessage = await storage.createMessage({
        conversationId: conversation.id,
        content: aiResponse,
        direction: "outbound",
        fromUser: false,
        fromType: "bot",
        type: "text",
        status: "sent",
      });

      await storage.updateConversation(conversation.id, {
        lastMessageAt: new Date(),
        lastMessageText: aiResponse,
        updatedAt: new Date(),
      });

      return res.json({
        success: true,
        response: aiResponse,
        conversationId: conversation.id,
        messageId: botMessage.id,
        mode: "human",
      });
    }

    const shouldAIReply = enableAiAutoReply !== false;

    if (!isAssigned && !hasHumanAgentReplied && shouldAIReply) {

      const allMessages = await storage.getConversationMessages(conversation.id);
      const conversationHistory = allMessages.slice(-10).map((msg: any) => ({
        role: msg.fromUser ? "user" as const : "assistant" as const,
        content: msg.content,
      }));

      const aiSetting = await db
        .select()
        .from(aiSettings)
        .where(eq(aiSettings.channelId, channelId || ""))
        .limit(1);

      let activeAI = aiSetting?.[0];

      if (!activeAI || !activeAI.isActive) {
        await storage.updateConversation(conversation.id, {
          lastMessageAt: new Date(),
          lastMessageText: message,
          unreadCount: (conversation.unreadCount || 0) + 1,
          updatedAt: new Date(),
        });
        return res.json({
          success: true,
          response: null,
          conversationId: conversation.id,
          messageId: userMessage.id,
          mode: "no_ai",
        });
      }

      let triggerWords: string[] = [];
      if (Array.isArray(activeAI.words)) {
        triggerWords = activeAI.words;
      } else if (typeof activeAI.words === "string") {
        try { triggerWords = JSON.parse(activeAI.words); } catch { triggerWords = []; }
      }

      const isFirstMessage = allMessages.length <= 1;
      let triggerMatched = true;
      if (triggerWords.length > 0 && isFirstMessage) {
        const messageLower = message.toLowerCase().trim();
        triggerMatched = triggerWords.some((word: string) =>
          messageLower.includes(word.toLowerCase().trim())
        );
      }

      if (!triggerMatched) {
        await storage.updateConversation(conversation.id, {
          lastMessageAt: new Date(),
          lastMessageText: message,
          unreadCount: (conversation.unreadCount || 0) + 1,
          updatedAt: new Date(),
        });
        return res.json({
          success: true,
          response: null,
          conversationId: conversation.id,
          messageId: userMessage.id,
          mode: "no_trigger_match",
        });
      }

      let aiClient: OpenAI | null = null;
      if (activeAI?.apiKey) {
        aiClient = buildAIClient(activeAI);
      }

      const aiConfig = (site as any).aiTrainingConfig || {};
      const widgetCfg = (site as any).widgetConfig || {};

      const finalModel = activeAI?.model || aiConfig.model || "gpt-4o-mini";
      const finalTemp = parseFloat(activeAI?.temperature || aiConfig.temperature || "0.7");
      const finalMaxTokens = parseInt(activeAI?.maxTokens || aiConfig.maxTokens || "500");

      let trainingContext = "";
      try {
        const trainingResults = await searchTrainingData(
          site.id,
          channelId || "",
          message
        );

        if (trainingResults.chunks.length > 0) {
          trainingContext += "\n\n--- RELEVANT KNOWLEDGE BASE & TRAINING DATA ---\n";
          trainingContext += trainingResults.chunks.join("\n\n");
        }
        if (trainingResults.qaPairs.length > 0) {
          trainingContext += "\n\n--- RELEVANT FAQ PAIRS ---\n";
          for (const qa of trainingResults.qaPairs) {
            trainingContext += `Q: ${qa.question}\nA: ${qa.answer}\n\n`;
          }
        }
      } catch (err) {
        console.warn("Training data search failed:", err);
      }

      const unansweredCount = allMessages.filter((m: any) =>
        !m.fromUser && m.fromType === "bot" &&
        (m.content.includes("I don't have") || m.content.includes("I'm not sure") || m.content.includes("I cannot find"))
      ).length;

      const escalationConfig = widgetCfg.escalationRules || {};
      const escalationEnabled = escalationConfig.enabled !== false;
      const maxAttempts = escalationConfig.maxAttempts || 3;

      let escalationInstruction = "";
      if (escalationEnabled) {
        const triggerPhrases = escalationConfig.triggerPhrases || [];
        escalationInstruction = `\n\nESCALATION RULES:
- If you cannot answer the user's question from the provided knowledge base/training data, you MUST start your response with "[ESCALATE_TO_AGENT]" and then provide a brief helpful message explaining you're transferring them.
- If you are unsure or the question is outside your trained knowledge, use "[ESCALATE_TO_AGENT]".
${unansweredCount >= maxAttempts - 1 ? `- The user has had ${unansweredCount} unanswered questions. If you cannot answer this one confidently, you MUST escalate with "[ESCALATE_TO_AGENT]".` : ""}
${triggerPhrases.length > 0 ? `- If the user mentions any of these phrases, escalate immediately: ${triggerPhrases.join(", ")}` : ""}
- Always try to answer from the provided knowledge base first before escalating.
- When escalating, be polite and tell the user you are transferring them to a human agent.`;
      }

      const basePrompt = widgetCfg.systemPrompt ||
        aiConfig.systemPrompt ||
        `You are a helpful, friendly support assistant for ${site.name}. Answer questions using the provided knowledge base. Be conversational and helpful. If you don't know the answer, be honest about it.`;

      const systemPrompt = basePrompt + trainingContext + escalationInstruction;

      try {
        if (!aiClient) {
          throw new Error("AI client is not initialized. Missing API key.");
        }

        const completion = await aiClient.chat.completions.create({
          model: finalModel,
          messages: [
            { role: "system", content: systemPrompt.substring(0, 128000) },
            ...conversationHistory,
            { role: "user", content: message },
          ],
          temperature: finalTemp,
          max_tokens: finalMaxTokens,
        });

        aiResponse =
          completion.choices?.[0]?.message?.content ||
          "I'm here, but unable to generate a response right now.";

        let escalated = false;
        if (aiResponse.includes("[ESCALATE_TO_AGENT]")) {
          aiResponse = aiResponse.replace(/\[ESCALATE_TO_AGENT\]/g, "").trim();
          escalated = true;
        }

        if (escalated && escalationEnabled) {
          const assignedAgent = await assignToRandomAgent(conversation, site);
          if (assignedAgent) {
            if (!aiResponse.toLowerCase().includes("transfer") && !aiResponse.toLowerCase().includes("connect")) {
              aiResponse += `\n\nI'm transferring you to ${assignedAgent.name} from our ${assignedAgent.role || 'support'} team. They'll be with you shortly.`;
            }
          } else {
            if (!aiResponse.toLowerCase().includes("transfer") && !aiResponse.toLowerCase().includes("connect")) {
              aiResponse += "\n\nI'm transferring you to a human agent. Someone will be with you shortly.";
            }
            await storage.updateConversation(conversation.id, {
              status: "pending",
              updatedAt: new Date(),
            });
          }
        }

        const botMessage = await storage.createMessage({
          conversationId: conversation.id,
          content: aiResponse,
          direction: "outbound",
          fromUser: false,
          fromType: "bot",
          type: "text",
          status: "sent",
        });

        aiMessageId = botMessage.id;

        if (io && aiResponse) {
          io.to(`widget:${conversation.id}`).emit("new_message", {
            message: {
              id: botMessage.id,
              content: aiResponse,
              fromUser: false,
              fromType: "bot",
              createdAt: new Date(),
            },
          });
        }

      } catch (error: any) {
        console.error("AI provider error:", error.message);

        const assignedAgent = await assignToRandomAgent(conversation, site);

        aiResponse = assignedAgent
          ? `I'm having some difficulty right now. I've transferred you to ${assignedAgent.name} who will be able to help you.`
          : "I'm experiencing some issues right now. I've notified our team and someone will get back to you shortly.";

        const botMessage = await storage.createMessage({
          conversationId: conversation.id,
          content: aiResponse,
          direction: "outbound",
          fromUser: false,
          fromType: "bot",
          type: "text",
          status: "sent",
        });

        aiMessageId = botMessage.id;

        if (!assignedAgent) {
          await storage.updateConversation(conversation.id, {
            status: "pending",
            updatedAt: new Date(),
          });
        }
      }
    } else {
      aiResponse = null;
    }

    await storage.updateConversation(conversation.id, {
      lastMessageAt: new Date(),
      lastMessageText: aiResponse || message,
      unreadCount: (conversation.unreadCount || 0) + 1,
      updatedAt: new Date(),
    });

    res.json({
      success: true,
      response: aiResponse,
      conversationId: conversation.id,
      messageId: aiMessageId,
      mode: isAssigned ? "human" : "ai",
    });
  } catch (error: any) {
    console.error("Widget chat error:", error);
    res.status(500).json({
      error: "Failed to process message",
      message: error.message,
    });
  }
});

  
  app.get("/api/widget/conversation/:conversationId", async (req, res) => {
    try {
      const { conversationId } = req.params;
      const messages = await storage.getConversationMessages(conversationId);
      
      const formattedMessages = messages.map(msg => ({
        id: msg.id,
        content: msg.content,
        fromUser: msg.fromUser,
        fromType: msg.fromType,
        status: msg.status,
        createdAt: msg.createdAt,
      }));

      res.json({ messages: formattedMessages });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch conversation" });
    }
  });

  
  app.post("/api/widget/request-agent", async (req, res) => {
    try {
      const { conversationId, siteId } = req.body;

      if (!conversationId) {
        return res.status(400).json({ error: "Conversation ID required" });
      }

      const conversation = await storage.getConversation(conversationId);
      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      
      const onlineAgents = io?.getOnlineAgents?.(siteId);
      
      if (!onlineAgents || onlineAgents.length === 0) {
        
        await storage.updateConversation(conversationId, {
          status: 'pending',
          updatedAt: new Date()
        });

        
        await storage.createMessage({
          conversationId,
          content: "All agents are currently busy. You'll be connected with the next available agent.",
          direction: 'outbound',
          fromUser: false,
          fromType: 'system',
          type: 'text',
          status: 'sent'
        });

        return res.json({
          success: true,
          status: 'pending',
          message: 'No agents available. You are in queue.'
        });
      }

      
      const agent = onlineAgents[0];
      await storage.updateConversation(conversationId, {
        status: 'assigned',
        assignedTo: agent.userId,
        updatedAt: new Date()
      });

      
      await storage.createMessage({
        conversationId,
        content: `${agent.name || 'An agent'} has joined the conversation.`,
        direction: 'outbound',
        fromUser: false,
        fromType: 'system',
        type: 'text',
        status: 'sent'
      });

      
      if (io) {
        io.to(`site:${siteId}`).emit('new_conversation_assigned', {
          conversationId,
          agentId: agent.userId
        });
      }

      res.json({
        success: true,
        status: 'assigned',
        agent: {
          id: agent.userId,
          name: agent.name
        }
      });

    } catch (error: any) {
      console.error('Request agent error:', error);
      res.status(500).json({ error: "Failed to request agent" });
    }
  });

  

  app.get("/api/active-site", async (req, res) => {
    try {
      
      
      const { channelId } = req.query; 
      

      if (!channelId) {
        return res.status(400).json({ message: "No Channel fount" });
      }

      const [site] = await storage.getSitesByChannel(channelId);
      
      res.json(site);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/sites", async (req, res) => {
    try {
      
      
      
      
      
      const sites = await storage.getSites();
      res.json(sites);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/sites", requireAuth, async (req, res) => {
    try {
      const validated = insertSiteSchema.parse(req.body);
      
      if (validated.tenantId !== req.user?.tenantId && req.user?.role !== "super_admin") {
        return res.status(403).json({ message: "Access denied" });
      }
      const site = await storage.createSite(validated);
      res.json(site);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/sites/:id", requireAuth, async (req, res) => {
    try {
      
      const site = await storage.getSite(req.params.id);
      if (!site) {
        return res.status(404).json({ message: "Site not found" });
      }
      if (site.tenantId !== req.user?.tenantId && req.user?.role !== "admin") {
        return res.status(403).json({ message: "Access denied" });
      }
      
      
      const safeData: any = {};
      if (req.body.name !== undefined) safeData.name = req.body.name;
      if (req.body.domain !== undefined) safeData.domain = req.body.domain;
      if (req.body.widgetEnabled !== undefined) safeData.widgetEnabled = req.body.widgetEnabled;
      if (req.body.widgetConfig !== undefined) safeData.widgetConfig = req.body.widgetConfig;
      if (req.body.aiTrainingConfig !== undefined) safeData.aiTrainingConfig = req.body.aiTrainingConfig;
      
      const updatedSite = await storage.updateSite(req.params.id, safeData);
      res.json(updatedSite);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/get_sites", requireAuth, async (req, res) => {
    try {
      const sites = await storage.getSites();
      res.status(200).json({success: true, message: 'getting sites successfully',sites});
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

app.post('/api/widget/upload-logo', requireAuth, logoUpload.single('logo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const filename = `logo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${req.file.originalname.split('.').pop()}`;
    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    
    const fs = await import('fs');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    fs.writeFileSync(path.join(uploadDir, filename), req.file.buffer);
    
    res.json({ url: `/uploads/${filename}` });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Upload failed' });
  }
});

app.post('/api/sites/create_or_update', requireAuth, async (req, res) => {
  try {
    const validated = insertSiteSchema.parse(req.body);
    const userRole     = req.user?.role;
    
    

    
    
    

    const [existingSite]: any | undefined = await storage.getSitesByChannel(req.body.channelId);

    let site: any;

    if (existingSite) {
      
      
      

      const safeData: any = {};
      if (validated.name              !== undefined) safeData.name              = validated.name;
      if (validated.domain            !== undefined) safeData.domain            = validated.domain;
      if (validated.widgetEnabled     !== undefined) safeData.widgetEnabled     = validated.widgetEnabled;
      if (validated.widgetConfig      !== undefined) safeData.widgetConfig      = validated.widgetConfig;
      if (validated.aiTrainingConfig  !== undefined) safeData.aiTrainingConfig  = validated.aiTrainingConfig;
      
      
      site = await storage.updateSite(existingSite.id, safeData);
    } else {
      site = await storage.createSite(validated);
    }

    return res.status(200).json(site);

  } catch (error: any) {
    return res.status(400).json({ message: error.message });
  }
});

  
}
