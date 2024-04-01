import { db } from "../db";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import { webhookConfigs, messages, conversations, contacts, messageQueue, templates, channels, users, aiSettings, sites } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import { triggerThrottledNotification, NOTIFICATION_EVENTS } from "./notification.service";
import OpenAI from "openai";
import { searchTrainingData } from "./training.service";
import { WhatsAppApiService } from "./whatsapp-api";

export interface WebhookMessage {
  from: string;
  id: string;
  timestamp: string;
  text?: {
    body: string;
  };
  type: string;
  image?: {
    id: string;
    mime_type: string;
    sha256?: string;
    caption?: string;
  };
  video?: {
    id: string;
    mime_type: string;
    sha256?: string;
    caption?: string;
  };
  audio?: {
    id: string;
    mime_type: string;
    sha256?: string;
    voice?: boolean;
  };
  sticker?: {
    id: string;
    mime_type: string;
    sha256?: string;
    animated?: boolean;
  };
  document?: {
    id: string;
    mime_type: string;
    sha256?: string;
    filename: string;
    caption?: string;
  };
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
    url?: string;
  };
  contacts?: Array<{
    name: {
      formatted_name: string;
      first_name?: string;
      last_name?: string;
    };
    phones?: Array<{
      phone: string;
      type?: string;
    }>;
    emails?: Array<{
      email: string;
      type?: string;
    }>;
    org?: {
      company?: string;
      title?: string;
    };
  }>;
  errors?: Array<{
    code: number;
    title: string;
    message?: string;
    error_data?: {
      details: string;
    };
  }>;
}

export interface WebhookStatus {
  id: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: string;
  recipient_id: string;
  conversation?: {
    id: string;
    origin?: {
      type: "marketing_lite" | "marketing" | "utility" | "authentication" | "service" | "referral_conversion" | string;
    };
  };
  pricing?: {
    billable: boolean;
    pricing_model: string;
    category: "marketing_lite" | "marketing" | "utility" | "authentication" | "service" | string;
  };
  errors?: Array<{
    code: number;
    title: string;
    message: string;
  }>;
}

export class WebhookHandler {
  
  static verifySignature(
    rawBody: string,
    signature: string,
    appSecret: string
  ): boolean {
    const expectedSignature = crypto
      .createHmac("sha256", appSecret)
      .update(rawBody)
      .digest("hex");
    
    return `sha256=${expectedSignature}` === signature;
  }

  
  static async handleVerification(
    mode: string,
    verifyToken: string,
    challenge: string,
    expectedToken: string
  ): Promise<{ verified: boolean; challenge?: string }> {
    if (mode === "subscribe" && verifyToken === expectedToken) {
      console.log("Webhook verified successfully");
      return { verified: true, challenge };
    }
    
    console.error("Webhook verification failed");
    return { verified: false };
  }

  
  static async processWebhook(body: any): Promise<void> {
    if (body.object !== "whatsapp_business_account") {
      throw new Error("Invalid webhook object type");
    }

    for (const entry of body.entry) {
      const wabaId = entry.id;
      
      for (const change of entry.changes) {
        const value = change.value;
        const field = change.field;

        if (field === "messages") {
          
          if (value.messages) {
            const contactProfiles = value.contacts || [];
            for (const message of value.messages) {
              const profile = contactProfiles.find((c: any) => c.wa_id === message.from);
              const profileName = profile?.profile?.name || null;
              await this.handleIncomingMessage(
                value.metadata.phone_number_id,
                message,
                profileName
              );
            }
          }

          
          if (value.statuses) {
            for (const status of value.statuses) {
              await this.handleStatusUpdate(status);
            }
          }
        } else if (field === "message_template_status_update") {
          
          await this.handleTemplateStatusUpdate(value);
        } else if (field === "account_alerts") {
          await this.handleAccountAlert(value);
        } else if (field === "account_update") {
          await this.handleAccountUpdate(entry.id, value);
        }
      }
    }
  }

  
  private static async handleIncomingMessage(
    phoneNumberId: string,
    message: WebhookMessage,
    profileName?: string | null
  ): Promise<void> {
    try {
      
      const channel = await db
        .select()
        .from(channels)
        .where(eq(channels.phoneNumberId, phoneNumberId))
        .limit(1);

      const channelId = channel.length > 0 ? channel[0].id : null;

      if (!channelId) {
        console.warn(`⚠️ No channel found for phoneNumberId: ${phoneNumberId}. Message from ${message.from} will be stored without channel scope.`);
      }

      
      let contact;
      if (channelId) {
        const existingContact = await db
          .select()
          .from(contacts)
          .where(and(eq(contacts.channelId, channelId), eq(contacts.phone, message.from)))
          .limit(1);
        contact = existingContact;
      } else {
        const existingContact = await db
          .select()
          .from(contacts)
          .where(eq(contacts.phone, message.from))
          .limit(1);
        contact = existingContact;
      }

      if (contact.length === 0) {
        const displayName = profileName || message.from;
        const insertData: any = {
          name: displayName,
          phone: message.from,
          lastContact: new Date(),
          source: "whatsapp",
        };
        if (channelId) insertData.channelId = channelId;
        if (channel.length > 0 && channel[0].createdBy) insertData.createdBy = channel[0].createdBy;

        const [newContact] = await db
          .insert(contacts)
          .values(insertData)
          .returning();
        contact = [newContact];
      } else {
        const updateData: any = { lastContact: new Date() };
        if (profileName && (contact[0].name === contact[0].phone || contact[0].name === message.from)) {
          updateData.name = profileName;
        }
        await db
          .update(contacts)
          .set(updateData)
          .where(eq(contacts.id, contact[0].id));
        if (updateData.name) {
          contact[0].name = updateData.name;
        }
      }

      
      let conversation;
      if (channelId) {
        conversation = await db
          .select()
          .from(conversations)
          .where(and(eq(conversations.channelId, channelId), eq(conversations.contactId, contact[0].id)))
          .limit(1);
      } else {
        conversation = await db
          .select()
          .from(conversations)
          .where(eq(conversations.contactId, contact[0].id))
          .limit(1);
      }

      
      let content = "";
      let mediaId: string | undefined;
      let mediaMimeType: string | undefined;
      let mediaSha256: string | undefined;
      let metadata: Record<string, any> | undefined;

      switch (message.type) {
        case "text":
          content = message.text?.body || "";
          break;

        case "image":
          content = message.image?.caption || "[Image]";
          mediaId = message.image?.id;
          mediaMimeType = message.image?.mime_type;
          mediaSha256 = message.image?.sha256;
          break;

        case "video":
          content = message.video?.caption || "[Video]";
          mediaId = message.video?.id;
          mediaMimeType = message.video?.mime_type;
          mediaSha256 = message.video?.sha256;
          break;

        case "audio":
          content = "[Audio]";
          mediaId = message.audio?.id;
          mediaMimeType = message.audio?.mime_type;
          mediaSha256 = message.audio?.sha256;
          metadata = { voice: message.audio?.voice || false };
          break;

        case "sticker":
          content = "[Sticker]";
          mediaId = message.sticker?.id;
          mediaMimeType = message.sticker?.mime_type;
          mediaSha256 = message.sticker?.sha256;
          metadata = { animated: message.sticker?.animated || false };
          break;

        case "document":
          content = message.document?.caption || `[Document: ${message.document?.filename || "Unknown"}]`;
          mediaId = message.document?.id;
          mediaMimeType = message.document?.mime_type;
          mediaSha256 = message.document?.sha256;
          metadata = { fileName: message.document?.filename };
          break;

        case "location":
          content = message.location?.name || message.location?.address || "[Location]";
          metadata = {
            latitude: message.location?.latitude,
            longitude: message.location?.longitude,
            locationName: message.location?.name,
            locationAddress: message.location?.address,
            locationUrl: message.location?.url,
          };
          break;

        case "contacts":
          if (message.contacts && message.contacts.length > 0) {
            const names = message.contacts.map(c => c.name.formatted_name).join(", ");
            content = `[Contact: ${names}]`;
            metadata = { sharedContacts: message.contacts };
          } else {
            content = "[Contact]";
          }
          break;

        case "button":
          content = (message as any).button?.text || "[Button reply]";
          metadata = { buttonPayload: (message as any).button?.payload };
          break;

        case "interactive": {
          const interactive = (message as any).interactive;
          if (interactive?.type === "list_reply") {
            content = interactive.list_reply?.title || "[List reply]";
            metadata = { listReplyId: interactive.list_reply?.id, listReplyDescription: interactive.list_reply?.description };
          } else if (interactive?.type === "button_reply") {
            content = interactive.button_reply?.title || "[Button reply]";
            metadata = { buttonReplyId: interactive.button_reply?.id };
          } else if (interactive?.type === "nfm_reply") {
            content = "[Flow reply]";
            metadata = { flowResponse: interactive.nfm_reply?.response_json };
          } else {
            content = `[Interactive: ${interactive?.type || "unknown"}]`;
          }
          break;
        }

        case "order":
          content = "[Order received]";
          metadata = { order: (message as any).order };
          break;

        case "system":
          content = (message as any).system?.body || "[System message]";
          metadata = { systemType: (message as any).system?.type, systemIdentity: (message as any).system?.identity };
          break;

        case "referral":
          content = message.text?.body || "[Referral message]";
          metadata = { referral: (message as any).referral };
          break;

        case "reaction": {
          const emoji = (message as any).reaction?.emoji || '';
          const reactedMessageId = (message as any).reaction?.message_id;
          if (reactedMessageId) {
            const reactedMsg = await db.select().from(messages).where(eq(messages.whatsappMessageId, reactedMessageId)).limit(1);
            if (reactedMsg.length > 0) {
              const existingMeta = (reactedMsg[0].metadata as any) || {};
              let reactions = existingMeta.reactions || [];
              if (!emoji) {
                reactions = reactions.filter((r: any) => r.from !== message.from);
              } else {
                reactions = reactions.filter((r: any) => r.from !== message.from);
                reactions.push({ emoji, from: message.from, timestamp: message.timestamp });
              }
              await db.update(messages).set({ metadata: { ...existingMeta, reactions } }).where(eq(messages.id, reactedMsg[0].id));
            }
          }
          return;
        }

        case "location_request":
          content = "[Location request]";
          break;

        case "address":
          content = "[Address message]";
          metadata = { type: "address", address: (message as any).address };
          break;

        case "template":
          content = "[Template message]";
          break;

        case "unsupported":
          if (message.errors && message.errors.length > 0) {
            const err = message.errors[0];
            content = `[Unsupported: ${err.title || "This message type is not supported"}]`;
            metadata = { type: "unsupported", originalType: "unsupported", errorCode: err.code, errorTitle: err.title, errorDetails: err.error_data?.details, rawWebhook: message };
          } else {
            content = "[This message type is not yet supported]";
            metadata = { type: "unsupported", originalType: "unsupported", rawWebhook: message };
          }
          break;

        default:
          content = `[Unsupported: Message type "${message.type}" unknown]`;
          metadata = { type: "unsupported", originalType: message.type, rawWebhook: message };
          break;
      }

      let mediaUrl: string | undefined;
      if (mediaId && channel.length > 0) {
        try {
          const waApi = new WhatsAppApiService(channel[0]);
          mediaUrl = await waApi.fetchMediaUrl(mediaId);
        } catch (err) {
          console.error("Failed to fetch media URL in webhook-handler:", err);
        }
      }

      
      const whatsappTimestamp = message.timestamp
        ? new Date(parseInt(message.timestamp) * 1000)
        : new Date();

      const now = new Date();
      const contactName = contact[0].name || message.from;

      
      if (conversation.length === 0) {
        const convInsert: any = {
          contactId: contact[0].id,
          contactPhone: message.from,
          contactName: contactName,
          lastMessageAt: now,
          lastIncomingMessageAt: now,
          lastMessageText: content.length > 200 ? content.substring(0, 200) : content,
          unreadCount: 1,
          status: "open",
          type: "whatsapp",
        };
        if (channelId) convInsert.channelId = channelId;

        const [newConversation] = await db
          .insert(conversations)
          .values(convInsert)
          .returning();
        conversation = [newConversation];
      } else {
        const currentUnread = conversation[0].unreadCount || 0;
        await db
          .update(conversations)
          .set({
            lastMessageAt: now,
            lastIncomingMessageAt: now,
            lastMessageText: content.length > 200 ? content.substring(0, 200) : content,
            contactPhone: message.from,
            contactName: contactName,
            unreadCount: currentUnread + 1,
          })
          .where(eq(conversations.id, conversation[0].id));
      }

      
      const insertValues: any = {
        conversationId: conversation[0].id,
        whatsappMessageId: message.id,
        fromUser: false,
        direction: "inbound",
        content,
        type: message.type,
        messageType: message.type,
        status: "received",
        timestamp: whatsappTimestamp,
      };
      if (mediaId) insertValues.mediaId = mediaId;
      if (mediaUrl) insertValues.mediaUrl = mediaUrl;
      if (mediaMimeType) insertValues.mediaMimeType = mediaMimeType;
      if (mediaSha256) insertValues.mediaSha256 = mediaSha256;
      if (metadata) insertValues.metadata = metadata;

      await db.insert(messages).values(insertValues);

      console.log(`[${channelId || 'no-channel'}] Received ${message.type} from ${message.from}: ${content.substring(0, 80)}`);

      
      try {
        if (channel.length > 0 && channel[0].createdBy) {
          const ownerId = channel[0].createdBy;
          const ownerAndTeam = await db
            .select()
            .from(users)
            .where(eq(users.id, ownerId));
          const teamMembers = await db
            .select()
            .from(users)
            .where(eq(users.createdBy, ownerId));
          const allUsers = [...ownerAndTeam, ...teamMembers];
          const targetUserIds = [...new Set(allUsers.map((u) => u.id))];

          if (targetUserIds.length > 0) {
            const messagePreview = content.length > 100 ? content.substring(0, 100) + "..." : content;

            await triggerThrottledNotification({
              contactName,
              contactPhone: message.from,
              channelName: channel[0].name || channel[0].phoneNumber || "Unknown",
              messagePreview,
            }, targetUserIds, channel[0].id);
          }
        }
      } catch (notifError) {
        console.error("Error sending new message notification:", notifError);
      }

      
      try {
        if (channelId && message.type === "text" && content) {
          await this.handleAIAutoReply(
            channelId,
            channel[0],
            conversation[0],
            contact[0],
            content,
            message.from
          );
        }
      } catch (aiError) {
        console.error("AI auto-reply error (non-blocking):", aiError);
      }
    } catch (error) {
      console.error("Error handling incoming message:", error);
      throw error;
    }
  }

  private static async handleAIAutoReply(
    channelId: string,
    channelData: any,
    conversation: any,
    contactData: any,
    messageContent: string,
    senderPhone: string
  ): Promise<void> {
    if (conversation.status === "assigned" && conversation.assignedTo) {
      console.log(`[AI] Skipping auto-reply - conversation already assigned to agent`);
      return;
    }

    const aiSetting = await db
      .select()
      .from(aiSettings)
      .where(and(eq(aiSettings.channelId, channelId), eq(aiSettings.isActive, true)))
      .limit(1);

    const activeAI = aiSetting?.[0];
    if (!activeAI || !activeAI.apiKey) {
      return;
    }

    let triggerWords: string[] = [];
    if (Array.isArray(activeAI.words)) {
      triggerWords = activeAI.words;
    } else if (typeof activeAI.words === "string") {
      try { triggerWords = JSON.parse(activeAI.words); } catch { triggerWords = []; }
    }

    const existingMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversation.id));

    const isFirstMessage = existingMessages.length <= 1;

    if (triggerWords.length > 0 && isFirstMessage) {
      const msgLower = messageContent.toLowerCase().trim();
      const hasMatch = triggerWords.some((word: string) =>
        msgLower.includes(word.toLowerCase().trim())
      );
      if (!hasMatch) {
        return;
      }
    }

    const channelSites = await db
      .select()
      .from(sites)
      .where(eq(sites.channelId, channelId))
      .limit(1);

    const site = channelSites[0];
    const siteId = site?.id || "";

    const conversationHistory = existingMessages
      .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .slice(-10)
      .map((msg: any) => ({
        role: msg.direction === "inbound" ? "user" as const : "assistant" as const,
        content: msg.content,
      }));

    let trainingContext = "";
    try {
      if (siteId) {
        const trainingResults = await searchTrainingData(siteId, channelId, messageContent);
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
      }
    } catch (err) {
      console.warn("[AI] Training data search failed:", err);
    }

    const unansweredCount = existingMessages.filter((m: any) =>
      m.direction === "outbound" && m.fromType === "bot" &&
      (m.content.includes("I don't have") || m.content.includes("I'm not sure") || m.content.includes("I cannot find"))
    ).length;

    const widgetCfg = site?.widgetConfig || {};
    const escalationConfig = widgetCfg.escalationRules || {};
    const maxAttempts = escalationConfig.maxAttempts || 3;

    const siteName = site?.name || channelData?.name || "our company";
    const basePrompt = widgetCfg.systemPrompt ||
      `You are a helpful, friendly customer support assistant for ${siteName}. Answer questions using the provided knowledge base. Be conversational and helpful. Keep responses concise for WhatsApp (under 300 words). If you don't know the answer, be honest about it.`;

    const escalationInstruction = `\n\nESCALATION RULES:
- If you cannot answer the user's question from the provided knowledge base/training data, you MUST start your response with "[ESCALATE_TO_AGENT]" and then provide a brief polite message explaining you're transferring them to a human agent.
- If you are unsure or the question is outside your trained knowledge, use "[ESCALATE_TO_AGENT]".
${unansweredCount >= maxAttempts - 1 ? `- The user has had ${unansweredCount} unanswered questions. If you cannot answer this one confidently, you MUST escalate with "[ESCALATE_TO_AGENT]".` : ""}
- Always try to answer from the provided knowledge base first before escalating.
- When escalating, be polite and tell the user you are transferring them to a human agent.`;

    const systemPrompt = basePrompt + trainingContext + escalationInstruction;

    const aiClient = new OpenAI({
      apiKey: activeAI.apiKey,
      baseURL: activeAI.endpoint || "https://api.openai.com/v1",
    });

    const finalModel = activeAI.model || "gpt-4o-mini";
    const finalTemp = parseFloat(activeAI.temperature || "0.7");
    const finalMaxTokens = parseInt(activeAI.maxTokens || "500");

    try {
      const completion = await aiClient.chat.completions.create({
        model: finalModel,
        messages: [
          { role: "system", content: systemPrompt.substring(0, 128000) },
          ...conversationHistory,
          { role: "user", content: messageContent },
        ],
        temperature: finalTemp,
        max_tokens: finalMaxTokens,
      });

      let aiResponse = completion.choices?.[0]?.message?.content || "";
      if (!aiResponse.trim()) return;

      let escalated = false;
      if (aiResponse.includes("[ESCALATE_TO_AGENT]")) {
        aiResponse = aiResponse.replace(/\[ESCALATE_TO_AGENT\]/g, "").trim();
        escalated = true;
      }

      if (escalated) {
        let assignedAgent: any = null;

        const teamMembers = widgetCfg.teamMembers || [];
        let validMembers = teamMembers.filter((m: any) => m.userId);

        if (validMembers.length === 0 && channelData?.createdBy) {
          const ownerAndTeam = await db
            .select({ id: users.id, name: users.name })
            .from(users)
            .where(eq(users.id, channelData.createdBy));
          const teamUsers = await db
            .select({ id: users.id, name: users.name })
            .from(users)
            .where(eq(users.createdBy, channelData.createdBy));
          const allAgents = [...ownerAndTeam, ...teamUsers];
          validMembers = allAgents.map(u => ({ userId: u.id, name: u.name }));
        }

        if (validMembers.length > 0) {
          assignedAgent = validMembers[Math.floor(Math.random() * validMembers.length)];
          await db
            .update(conversations)
            .set({ status: "assigned", assignedTo: assignedAgent.userId, updatedAt: new Date() })
            .where(eq(conversations.id, conversation.id));

          if (!aiResponse.toLowerCase().includes("transfer") && !aiResponse.toLowerCase().includes("connect")) {
            aiResponse += `\n\nI'm transferring you to ${assignedAgent.name || 'a support agent'} who will be able to help you better.`;
          }

          console.log(`[AI] Escalated WhatsApp conversation ${conversation.id} to agent ${assignedAgent.name}`);
        } else {
          await db
            .update(conversations)
            .set({ status: "pending", updatedAt: new Date() })
            .where(eq(conversations.id, conversation.id));

          if (!aiResponse.toLowerCase().includes("transfer") && !aiResponse.toLowerCase().includes("connect")) {
            aiResponse += "\n\nI'm transferring you to a human agent. Someone will get back to you shortly.";
          }
        }
      }

      const whatsappApi = new WhatsAppApiService(channelData);
      const sendResult = await whatsappApi.sendTextMessage(senderPhone, aiResponse);

      const whatsappMessageId = sendResult?.messages?.[0]?.id || null;

      await db.insert(messages).values({
        conversationId: conversation.id,
        whatsappMessageId,
        fromUser: false,
        direction: "outbound",
        content: aiResponse,
        type: "text",
        messageType: "text",
        fromType: "bot",
        status: "sent",
        timestamp: new Date(),
      });

      await db
        .update(conversations)
        .set({
          lastMessageAt: new Date(),
          lastMessageText: aiResponse.substring(0, 200),
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, conversation.id));

      const io = (global as any).io;
      if (io) {
        io.to(`channel:${channelId}`).emit("conversation_updated", {
          conversationId: conversation.id,
        });
      }

      console.log(`[AI] Auto-replied to WhatsApp message from ${senderPhone} in conversation ${conversation.id}`);
    } catch (error: any) {
      console.error("[AI] Failed to generate/send auto-reply:", error.message);

      let fallbackMembers: any[] = [];
      const teamMembers = widgetCfg.teamMembers || [];
      fallbackMembers = teamMembers.filter((m: any) => m.userId);

      if (fallbackMembers.length === 0 && channelData?.createdBy) {
        const ownerAndTeam = await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(eq(users.id, channelData.createdBy));
        const teamUsers = await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(eq(users.createdBy, channelData.createdBy));
        fallbackMembers = [...ownerAndTeam, ...teamUsers].map(u => ({ userId: u.id, name: u.name }));
      }

      if (fallbackMembers.length > 0) {
        const randomAgent = fallbackMembers[Math.floor(Math.random() * fallbackMembers.length)];
        await db
          .update(conversations)
          .set({ status: "assigned", assignedTo: randomAgent.userId, updatedAt: new Date() })
          .where(eq(conversations.id, conversation.id));
        console.log(`[AI] AI failed, assigned conversation to agent ${randomAgent.name}`);
      } else {
        await db
          .update(conversations)
          .set({ status: "pending", updatedAt: new Date() })
          .where(eq(conversations.id, conversation.id));
      }
    }
  }

  
  private static async handleStatusUpdate(status: WebhookStatus): Promise<void> {
    try {
      
      const [message] = await db
        .select()
        .from(messages)
        .where(eq(messages.whatsappMessageId, status.id))
        .limit(1);

      if (message) {
        const updateData: any = {
          status: status.status === "failed" ? "failed" : status.status,
          updatedAt: new Date(),
        };

        if (status.status === "delivered") {
          updateData.deliveredAt = new Date();
        } else if (status.status === "read") {
          updateData.readAt = new Date();
        } else if (status.status === "failed" && status.errors?.[0]) {
          updateData.errorCode = status.errors[0].code.toString();
          updateData.errorMessage = status.errors[0].message;
        }

        await db
          .update(messages)
          .set(updateData)
          .where(eq(messages.id, message.id));

        console.log(`Message ${status.id} status updated to ${status.status}`);
      }

      
      const [queueItem] = await db
        .select()
        .from(messageQueue)
        .where(eq(messageQueue.whatsappMessageId, status.id))
        .limit(1);

      if (queueItem) {
        const updateData: any = {
          status: status.status === "failed" ? "failed" : status.status,
        };

        if (status.status === "delivered") {
          updateData.deliveredAt = new Date();
        } else if (status.status === "read") {
          updateData.readAt = new Date();
        } else if (status.status === "failed" && status.errors?.[0]) {
          updateData.errorCode = status.errors[0].code.toString();
          updateData.errorMessage = status.errors[0].message;
        }

        await db
          .update(messageQueue)
          .set(updateData)
          .where(eq(messageQueue.id, queueItem.id));

        
        if (queueItem.campaignId) {
          await this.updateCampaignStats(queueItem.campaignId, status.status);
        }
      }
    } catch (error) {
      console.error("Error handling status update:", error);
      throw error;
    }
  }

  
  private static async updateCampaignStats(
    campaignId: string,
    status: string
  ): Promise<void> {
    const incrementField = {
      delivered: "deliveredCount",
      read: "readCount",
      failed: "failedCount",
    }[status];

    if (incrementField) {
      await db.execute(
        sql`UPDATE campaigns 
            SET ${sql.identifier(incrementField)} = ${sql.identifier(incrementField)} + 1 
            WHERE id = ${campaignId}`
      );
    }
  }

  
  static async handleTemplateStatusUpdate(value: any): Promise<void> {
    try {
      const { message_template_id, message_template_name, event, reason } = value;

      console.log(
        `Template ${message_template_name} status changed to ${event}`,
        reason ? `Reason: ${reason}` : ""
      );

      
      let status: string;
      switch (event) {
        case "APPROVED":
          status = "approved";
          break;
        case "REJECTED":
          status = "rejected";
          break;
        case "PENDING":
          status = "pending";
          break;
        case "DISABLED":
          status = "disabled";
          break;
        default:
          console.warn(`Unknown template status event: ${event}`);
          return;
      }

      
      const updatedTemplates = await db
        .update(templates)
        .set({ 
          status,
          updatedAt: new Date()
        })
        .where(eq(templates.whatsappTemplateId, message_template_id))
        .returning();

      const updatedTemplate = updatedTemplates[0];
      let templateRecord = updatedTemplate;
      
      if (!templateRecord) {
        const updatedByName = await db
          .update(templates)
          .set({ 
            status,
            updatedAt: new Date()
          })
          .where(eq(templates.name, message_template_name))
          .returning();
          
        if (updatedByName.length === 0) {
          console.warn(`Template not found for update: ${message_template_name} (${message_template_id})`);
        } else {
          templateRecord = updatedByName[0];
        }
      }

      if (templateRecord && (event === "APPROVED" || event === "REJECTED")) {
        try {
          const channel = await db.select().from(channels).where(eq(channels.id, templateRecord.channelId)).limit(1);
          const channelName = channel[0]?.name || "Unknown";
          const eventType = event === "APPROVED" ? NOTIFICATION_EVENTS.TEMPLATE_APPROVED : NOTIFICATION_EVENTS.TEMPLATE_REJECTED;
          const ownerId = channel[0]?.createdBy;
          let targetUserIds: string[] = [];
          if (ownerId) {
            const ownerAndTeam = await db.select().from(users).where(eq(users.id, ownerId));
            const teamMembers = await db.select().from(users).where(eq(users.createdBy, ownerId));
            const allUsers = [...ownerAndTeam, ...teamMembers];
            targetUserIds = [...new Set(allUsers.map((u: any) => u.id))];
          }
          
          if (targetUserIds.length > 0) {
            await triggerNotification(eventType, {
              templateName: message_template_name,
              templateCategory: templateRecord.category || "N/A",
              templateLanguage: templateRecord.language || "en",
              rejectionReason: reason || "No reason provided",
              channelName,
            }, targetUserIds, templateRecord.channelId || undefined);
          }
        } catch (notifError) {
          console.error("Error sending template status notification:", notifError);
        }
      }
    } catch (error) {
      console.error("Error handling template status update:", error);
      throw error;
    }
  }

  private static async handleAccountUpdate(wabaId: string, value: any): Promise<void> {
    try {
      console.log("[Webhook] account_update received:", JSON.stringify(value, null, 2));

      const phoneNumberId = value.phone_number_id;
      const event = value.event;

      if (!phoneNumberId) {
        console.warn("[Webhook] account_update missing phone_number_id");
        return;
      }

      const channelRows = await db
        .select()
        .from(channels)
        .where(eq(channels.phoneNumberId, phoneNumberId))
        .limit(1);

      if (channelRows.length === 0) {
        console.warn(`[Webhook] No channel found for phone_number_id: ${phoneNumberId}`);
        return;
      }

      const channel = channelRows[0];

      if (event === "VERIFIED_ACCOUNT" || event === "PHONE_NUMBER_NAME_UPDATE") {
        const apiVersion = process.env.WHATSAPP_API_VERSION || 'v24.0';
        const fields = 'verified_name,name_status,new_name_status';
        const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}?fields=${fields}`;
        const response = await fetch(`${url}`, {
          headers: { 'Authorization': `Bearer ${channel.accessToken}` }
        });

        if (response.ok) {
          const data = await response.json();
          const healthDetails = {
            ...(channel.healthDetails as Record<string, any> || {}),
            verified_name: typeof data.verified_name === 'string' ? data.verified_name : (channel.healthDetails as any)?.verified_name || '',
            name_status: data.name_status || 'UNKNOWN',
            new_name_status: data.new_name_status || undefined,
          };

          await db.update(channels)
            .set({ healthDetails })
            .where(eq(channels.id, channel.id));

          console.log(`[Webhook] Display name updated for channel ${channel.id}: verified_name=${data.verified_name}, name_status=${data.name_status}`);

          try {
            const { io } = await import('../socket');
            if (io) {
              io.to(`channel:${channel.id}`).emit('display_name_update', {
                channelId: channel.id,
                verified_name: data.verified_name || '',
                name_status: data.name_status || 'UNKNOWN',
                new_name_status: data.new_name_status || null,
              });

              if (channel.createdBy) {
                io.to(`user:${channel.createdBy}`).emit('display_name_update', {
                  channelId: channel.id,
                  verified_name: data.verified_name || '',
                  name_status: data.name_status || 'UNKNOWN',
                  new_name_status: data.new_name_status || null,
                });
              }
            }
          } catch (socketErr) {
            console.error("[Webhook] Socket emit error for display_name_update:", socketErr);
          }
        } else {
          console.warn(`[Webhook] Failed to fetch updated display name from Meta for phone_number_id: ${phoneNumberId}`);
        }
      } else {
        console.log(`[Webhook] Unhandled account_update event: ${event}`);
      }
    } catch (error) {
      console.error("[Webhook] Error handling account_update:", error);
    }
  }

  
  private static async handleAccountAlert(value: any): Promise<void> {
    try {
      console.warn("Account alert received:", value);
      
      
      
      
      
      
    } catch (error) {
      console.error("Error handling account alert:", error);
      throw error;
    }
  }

  
  static async updateWebhookPing(channelId: string): Promise<void> {
    await db
      .update(webhookConfigs)
      .set({ lastPingAt: new Date() })
      .where(eq(webhookConfigs.channelId, channelId));
  }
}

import { sql } from "drizzle-orm";
