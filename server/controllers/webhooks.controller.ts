import type { Request, Response } from "express";
import { OurSaasError, asyncHandler as _dHandler, oursaasLogger, HTTP_STATUS } from "@oursaas/core";
import { storage } from "../storage";
import {
  aiSettings,
  campaigns,
  insertMessageSchema,
  messages,
  subscriptions,
  transactions,
  webhookConfigs,
  plans,
  paymentProviders,
} from "@shared/schema";
import { AppError, asyncHandler } from "../middlewares/error.middleware";
import crypto from "crypto";
import { startAutomationExecutionFunction } from "./automation.controller";
import { triggerService } from "server/services/automation-execution-service";
import { WhatsAppApiService } from "server/services/whatsapp-api";
import { getWhatsAppError } from "@shared/whatsapp-error-codes";
import { db } from "server/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { triggerNotification, triggerThrottledNotification, NOTIFICATION_EVENTS } from "server/services/notification.service";
import { users } from "@shared/schema";
import axios from "axios";
import { getStripe, getRazorpay } from "../services/payment-gateway.service";

export const getWebhookConfigs = asyncHandler(
  async (req: Request, res: Response) => {
    const user = (req.session as any)?.user;
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    if (user.role === 'superadmin') {
      const configs = await storage.getWebhookConfigs();
      return res.json(configs);
    }

    const ownerId = user.role === 'team' ? user.createdBy : user.id;
    const channels = await storage.getChannelsByUserId(ownerId);
    const channelIds = channels.map((ch: any) => ch.id);
    
    const allConfigs = await storage.getWebhookConfigs();
    const filteredConfigs = allConfigs.filter(
      (config: any) => config.channelId && channelIds.includes(config.channelId)
    );
    res.json(filteredConfigs);
  }
);

export const getWebhookConfigsByChannelId = asyncHandler(
  async (req: Request, res: Response) => {
    const channelId = req.params.id;
    const user = (req.session as any)?.user;
    
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    
    if (user.role !== 'superadmin') {
      const ownerId = user.role === 'team' ? user.createdBy : user.id;
      const channels = await storage.getChannelsByUserId(ownerId);
      const channelIds = channels.map((ch: any) => ch.id);
      if (!channelIds.includes(channelId)) {
        return res.status(403).json({ error: 'Access denied to this channel' });
      }
    }
    
    console.log("Fetching webhook configs for channel ID:", channelId);
    const configs = await db.select().from(webhookConfigs).where(eq(webhookConfigs.channelId, channelId));
    res.json(configs);
  }
);

export const getGlobalWebhookUrl = asyncHandler(
  async (req: Request, res: Response) => {
    const protocol = req.headers["x-forwarded-proto"] === "https" ? "https" : "https";
    const host = req.get("host");
    const webhookUrl = `${protocol}://${host}/webhook/global`;
    res.json({ webhookUrl });
  }
);

export const createWebhookConfig = asyncHandler(
  async (req: Request, res: Response) => {
    const user = (req.session as any)?.user;
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    if (user.role !== 'superadmin') return res.status(403).json({ error: 'Only superadmin can configure webhooks' });

    const { verifyToken, appSecret, events } = req.body;

    if (!verifyToken) {
      throw new AppError(400, "Verify token is required");
    }

    const protocol = req.headers["x-forwarded-proto"] === "https" ? "https" : "https";
    const host = req.get("host");
    const webhookUrl = `${protocol}://${host}/webhook/global`;

    const config = await storage.createWebhookConfig({
      webhookUrl,
      verifyToken,
      appSecret: appSecret || "",
      events: events || [
        "messages",
        "message_status",
        "message_template_status_update",
      ],
      isActive: true,
      channelId: null,
    });

    res.status(201).json(config);
  }
);

export const updateWebhookConfig = asyncHandler(
  async (req: Request, res: Response) => {
    const user = (req.session as any)?.user;
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    if (user.role !== 'superadmin') return res.status(403).json({ error: 'Only superadmin can configure webhooks' });

    const { id } = req.params;
    const updates = req.body;

    const config = await storage.updateWebhookConfig(id, updates);
    if (!config) {
      throw new AppError(404, "Webhook config not found");
    }

    res.json(config);
  }
);

export const deleteWebhookConfig = asyncHandler(
  async (req: Request, res: Response) => {
    const user = (req.session as any)?.user;
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    if (user.role !== 'superadmin') return res.status(403).json({ error: 'Only superadmin can configure webhooks' });

    const { id } = req.params;

    const deleted = await storage.deleteWebhookConfig(id);
    if (!deleted) {
      throw new AppError(404, "Webhook config not found");
    }

    res.json({ success: true, message: "Webhook config deleted" });
  }
);

export const testWebhook = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  
  const config = await storage.getWebhookConfig(id);
  if (!config) {
    throw new AppError(404, "Webhook config not found");
  }
  
  
  const testPayload = {
    entry: [
      {
        id: "test-entry",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15550555555",
                phone_number_id: "test-phone-id",
              },
              test: true,
            },
            field: "messages",
          },
        ],
      },
    ],
  };
  
  try {
    const response = await fetch(config.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(testPayload),
    });

    
    if (!response.ok) {
      throw new AppError(
        500,
        `Test webhook failed with status ${response.status}`
      );
    }
    res.json({ success: true, message: "Test webhook sent successfully" });
  } catch (error) {
    throw new AppError(
      500,
      `Failed to send test webhook: ${(error as Error).message}`
    );
  }
});

export const handleWebhook = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      "hub.mode": mode,
      "hub.challenge": challenge,
      "hub.verify_token": verifyToken,
    } = req.query;

    const allConfigs = await storage.getWebhookConfigs();
    const activeConfig = allConfigs.find((c) => c.isActive);

    if (mode && challenge) {
      if (
        mode === "subscribe" &&
        activeConfig &&
        verifyToken === activeConfig.verifyToken
      ) {
        console.log("Webhook verified successfully");
        await storage.updateWebhookConfig(activeConfig.id, {
          lastPingAt: new Date(),
        });
        return res.send(challenge);
      }
      throw new AppError(403, "Verification failed");
    }

    const body = req.body;
    console.log("Webhook received:", JSON.stringify(body, null, 2));

    if (activeConfig) {
      await storage.updateWebhookConfig(activeConfig.id, {
        lastPingAt: new Date(),
      });
    }

    if (body.entry) {
      for (const entry of body.entry) {
        const changes = entry.changes || [];
        for (const change of changes) {
          if (change.field === "messages") {
            await handleMessageChange(change.value);
          } else if (change.field === "message_template_status_update") {
            await handleTemplateStatusUpdate(change.value, entry.id);
          } else if (change.field === "smb_message_echoes") {
            await handleSmbMessageEchoes(change.value);
          } else if (change.field === "smb_app_state_sync") {
            await handleSmbAppStateSync(change.value);
          }
        }
      }
    }

    res.sendStatus(200);
  }
);

async function handleMessageChange(value: any) {
  const { messages, contacts, metadata, statuses } = value;

  
  if (statuses && statuses.length > 0) {
    await handleMessageStatuses(statuses, metadata);
    return;
  }

  if (!messages || messages.length === 0) {
    return;
  }

  
  const phoneNumberId = metadata?.phone_number_id;
  if (!phoneNumberId) {
    console.error("No phone_number_id in webhook");
    return;
  }

  const channel = await storage.getChannelByPhoneNumberId(phoneNumberId);
  if (!channel) {
    console.error(`No channel found for phone_number_id: ${phoneNumberId}`);
    return;
  }

  const waApi = new WhatsAppApiService(channel);

  for (const message of messages) {
    const { from, id: whatsappMessageId, text, type, timestamp, interactive } = message;

    
    if (type === 'reaction' && message.reaction) {
      const emoji = message.reaction.emoji || '';
      const reactedMessageId = message.reaction.message_id;

      if (reactedMessageId) {
        const reactedMessage = await storage.getMessageByWhatsAppId(reactedMessageId);
        if (reactedMessage) {
          const existingMeta = (reactedMessage.metadata as any) || {};
          let reactions = existingMeta.reactions || [];

          if (!emoji) {
            reactions = reactions.filter((r: any) => r.from !== from);
            console.log(`Reaction removed from message ${reactedMessageId} by ${from}`);
          } else {
            reactions = reactions.filter((r: any) => r.from !== from);
            reactions.push({
              emoji,
              from,
              timestamp,
            });
            console.log(`Reaction ${emoji} added to message ${reactedMessageId} by ${from}`);
          }

          await storage.updateMessage(reactedMessage.id, {
            metadata: { ...existingMeta, reactions },
          });

          const io = (global as any).io;
          if (io) {
            io.to(`conversation:${reactedMessage.conversationId}`).emit('message_reaction', {
              conversationId: reactedMessage.conversationId,
              messageId: reactedMessage.id,
              reactions: [...reactions],
            });
          }
        }
      }
      continue;
    }

    let messageContent = "";
    let interactiveData: any = null;

    let mediaId: string | null = null;
    let mediaUrl: string | null = null;
    let mediaMimeType: string | null = null;
    let mediaSha256: string | null = null;

    if (type === "text" && text) {
      messageContent = text.body;

    } else if (type === "button" && message.button) {
      messageContent = message.button.text || "[Button reply]";
      interactiveData = { type: "button", buttonPayload: message.button.payload };

    } else if (type === "interactive" && interactive) {
      if (interactive.type === "button_reply") {
        messageContent = interactive.button_reply.title;
        interactiveData = interactive;
      } else if (interactive.type === "list_reply") {
        messageContent = interactive.list_reply.title;
        interactiveData = interactive;
      } else if (interactive.type === "nfm_reply") {
        messageContent = "[Flow reply]";
        interactiveData = { type: "nfm_reply", flowResponse: interactive.nfm_reply?.response_json };
      } else {
        messageContent = `[Interactive: ${interactive.type || "unknown"}]`;
        interactiveData = interactive;
      }

    } else if (type === "image" && message.image) {
      messageContent = message.image.caption || "[Image]";
      mediaId = message.image.id;
      mediaMimeType = message.image.mime_type;
      mediaSha256 = message.image.sha256;

    } else if (type === "document" && message.document) {
      messageContent =
        message.document.caption ||
        `[Document: ${message.document.filename || "file"}]`;
      mediaId = message.document.id;
      mediaMimeType = message.document.mime_type;
      mediaSha256 = message.document.sha256;

    } else if (type === "audio" && message.audio) {
      messageContent = "[Audio message]";
      mediaId = message.audio.id;
      mediaMimeType = message.audio.mime_type;
      mediaSha256 = message.audio.sha256;

    } else if (type === "video" && message.video) {
      messageContent = message.video.caption || "[Video]";
      mediaId = message.video.id;
      mediaMimeType = message.video.mime_type;
      mediaSha256 = message.video.sha256;

    } else if (type === "sticker" && message.sticker) {
      messageContent = "[Sticker]";
      mediaId = message.sticker.id;
      mediaMimeType = message.sticker.mime_type;
      mediaSha256 = message.sticker.sha256;

    } else if (type === "location" && message.location) {
      messageContent = message.location.name || message.location.address || "[Location]";
      interactiveData = {
        type: "location",
        latitude: message.location.latitude,
        longitude: message.location.longitude,
        name: message.location.name,
        address: message.location.address,
        url: message.location.url,
      };

    } else if (type === "location_request") {
      messageContent = "[Location request]";

    } else if (type === "contacts" && message.contacts) {
      const sharedNames = message.contacts.map((c: any) => c.name?.formatted_name || "Unknown").join(", ");
      messageContent = `[Contact: ${sharedNames}]`;
      interactiveData = { type: "contacts", sharedContacts: message.contacts };

    } else if (type === "address" && message.address) {
      messageContent = "[Address message]";
      interactiveData = { type: "address", address: message.address };

    } else if (type === "template") {
      messageContent = "[Template message]";

    } else if (type === "order" && message.order) {
      messageContent = "[Order received]";
      interactiveData = { type: "order", order: message.order };

    } else if (type === "system") {
      messageContent = message.system?.body || "[System message]";
      interactiveData = { type: "system", systemType: message.system?.type };

    } else if (type === "referral") {
      messageContent = message.text?.body || "[Referral message]";
      interactiveData = { type: "referral", referral: message.referral };

    } else if (type === "unsupported") {
      const err = message.errors?.[0];
      const errTitle = err?.title || "This message type is not supported";
      messageContent = `[Unsupported: ${errTitle}]`;
      interactiveData = {
        type: "unsupported",
        originalType: type,
        errorCode: err?.code || null,
        errorTitle: err?.title || null,
        errorDetails: err?.error_data?.details || null,
        messageKeys: Object.keys(message),
        rawWebhook: message,
      };
      console.log(`[Webhook] Unsupported message from ${from}: errorCode=${err?.code}, errorTitle=${err?.title}, payload=${JSON.stringify(message)}`);

    } else {
      messageContent = `[Unsupported: Message type "${type}" unknown]`;
      interactiveData = {
        type: "unsupported",
        originalType: type,
        messageKeys: Object.keys(message),
        rawWebhook: message,
      };
      console.log(`[Webhook] Unknown message type "${type}" from ${from}, payload=${JSON.stringify(message)}`);
    }

    
    if (mediaId) {
      try {
        mediaUrl = await waApi.fetchMediaUrl(mediaId);
      } catch (err) {
        console.error("❌ Failed to fetch media URL:", err);
      }
    }

    
    const whatsappProfileName = contacts?.find((c: any) => c.wa_id === from)?.profile?.name || from;
    let contact = await storage.getContactByPhoneAndChannel(from, channel.id);
    let isNewConversation = false;

    if (!contact) {
      contact = await storage.createContact({
        name: whatsappProfileName,
        phone: from,
        channelId: channel.id,
        source: 'whatsapp',
        createdBy: channel.createdBy || undefined,
      });
    } else if (contact.name === contact.phone && whatsappProfileName !== from) {
      await storage.updateContact(contact.id, { name: whatsappProfileName });
      contact = { ...contact, name: whatsappProfileName };
    }

    
    let conversation = await storage.getConversationByPhoneAndChannel(from, channel.id);

    if (!conversation) {
      isNewConversation = true;

      conversation = await storage.createConversation({
        contactId: contact.id,
        contactPhone: from,
        contactName: contact.name || from,
        channelId: channel.id,
        unreadCount: 1,
        lastIncomingMessageAt: new Date(),
        lastMessageText: messageContent,
        lastMessageAt: new Date(),
      });

    } else {
      const updates: any = {
        unreadCount: (conversation.unreadCount || 0) + 1,
        lastMessageAt: new Date(),
        lastIncomingMessageAt: new Date(),
        lastMessageText: messageContent,
      };
      if (conversation.contactName !== contact.name) {
        updates.contactName = contact.name;
      }
      if (!conversation.contactId && contact.id) {
        updates.contactId = contact.id;
      }
      await storage.updateConversation(conversation.id, updates);
    }

    const storedMessageType = interactiveData?.type === "unsupported" ? "unsupported" : type;

    
    const newMessage = await storage.createMessage({
      conversationId: conversation.id,
      content: messageContent,
      fromUser: false,
      direction: "inbound",
      status: "received",
      whatsappMessageId,
      messageType: storedMessageType,
      metadata: interactiveData ? JSON.stringify(interactiveData) : null,
      timestamp: new Date(parseInt(timestamp, 10) * 1000),

      mediaId,
      mediaUrl,
      mediaMimeType,
      mediaSha256,
    });

const io = (global as any).io;

if (io) {
  const channelRoom = `channel:${channel.id}`;
  const conversationRoom = `conversation:${conversation.id}`;

  const normalizedPayload = {
    type: "new-message",
    conversationId: conversation.id,
    content: messageContent, 
    createdAt: new Date().toISOString(),
    messageType: type,
    from: "whatsapp",
  };

  
  io.to(channelRoom).emit("new-message", normalizedPayload);

  
  io.to(conversationRoom).emit("new-message", normalizedPayload);

  
  if (isNewConversation) {
    io.to(channelRoom).emit("conversation_created", {
      conversation: {
        ...conversation,
        lastMessageText: messageContent,
        lastMessageAt: new Date().toISOString(),
      },
      message: {
        id: newMessage.id,
        conversationId: conversation.id,
        content: messageContent,
        messageType: type,
        createdAt: new Date().toISOString(),
      },
    });
  }

  console.log("✅ Emitted to channel + conversation rooms");
} else {
  console.error("❌ IO not initialized");
}

    try {
      if (channel.createdBy) {
        const ownerId = channel.createdBy;
        const ownerResult = await db.select().from(users).where(eq(users.id, ownerId));
        const teamMembers = await db.select().from(users).where(eq(users.createdBy, ownerId));
        const allUsers = [...ownerResult, ...teamMembers];
        const targetUserIds = [...new Set(allUsers.map((u) => u.id))];

        if (targetUserIds.length > 0) {
          const contactName = contact.name || from;
          const preview = messageContent.length > 100 ? messageContent.substring(0, 100) + "..." : messageContent;

          console.log(`🔔 Triggering new_message notification for ${targetUserIds.length} user(s)`);
          await triggerThrottledNotification({
            contactName,
            contactPhone: from,
            channelName: channel.name || channel.phoneNumber || "Unknown",
            messagePreview: preview,
          }, targetUserIds, channel.id);
          console.log(`✅ new_message notification sent`);
        }
      }
    } catch (notifError) {
      console.error("❌ Error sending new message notification:", notifError);
    }

    
    try {
      const shouldSendAiReply = await checkAndSendAiReply(
        messageContent,
        conversation,
        contact,
        waApi
      );

      if (shouldSendAiReply) {
        console.log(`AI auto reply complete for conversation ${conversation.id}`);
        continue;
      }
    } catch (err) {
      console.error("AI Error:", err);
    }

    
    try {
      const hasPendingExecution =
        triggerService.getExecutionService().hasPendingExecution(conversation.id);

      if (hasPendingExecution) {
        const result =
          await triggerService.getExecutionService().handleUserResponse(
            conversation.id,
            messageContent,
            interactiveData
          );

        if (result && result.success) {
          if (io) {
            io.to(`conversation_${conversation.id}`).emit("automation-resumed", {
              type: "automation-resumed",
              data: result,
            });
          }
          continue;
        }
      }

      if (isNewConversation) {
        await triggerService.handleNewConversation(
          conversation.id,
          channel.id,
          contact?.id
        );
      } else {
        await triggerService.handleMessageReceived(
          conversation.id,
          {
            content: messageContent,
            text: messageContent,
            body: messageContent,
            type,
            from,
            whatsappMessageId,
            timestamp,
            interactive: interactiveData,
          },
          channel.id,
          contact?.id
        );
      }

    } catch (automationError) {
      console.error("Automation Error:", automationError);

      if (io) {
        io.to(`conversation_${conversation.id}`).emit("automation-error", {
          type: "automation-error",
          error: automationError,
        });
      }
    }
  }
}

async function checkAndSendAiReply(
  messageContent: string,
  conversation: any,
  contact: any,
  whatsappApi: any
): Promise<boolean> {
  
  const getAiSettings = await db
  .select()
  .from(aiSettings)
  .where(eq(aiSettings.channelId, conversation.channelId))
  .limit(1)
  .then((res) => res[0]);
  
  if (!getAiSettings || !getAiSettings.isActive) {
    return false;
  }

  
  let triggerWords: string[] = [];

  if (Array.isArray(getAiSettings.words)) {
    triggerWords = getAiSettings.words;
  } else if (typeof getAiSettings.words === "string") {
    try {
      triggerWords = JSON.parse(getAiSettings.words);
    } catch {
      console.warn("⚠️ AI settings words not valid JSON, using empty array");
      triggerWords = [];
    }
  }

  const messageLower = messageContent.toLowerCase().trim();

  let hasMatch = false;
  if (Array.isArray(triggerWords) && triggerWords.length > 0) {
    hasMatch = triggerWords.some((word: string) =>
      messageLower.includes(word.toLowerCase().trim())
    );
  }

  if (!hasMatch) {
    const recentMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversation.id))
      .orderBy(desc(messages.timestamp))
      .limit(10);

    const hasAiHistory = recentMessages.some((msg: any) => {
      if (!msg.metadata) return false;
      try {
        const meta = typeof msg.metadata === "string" ? JSON.parse(msg.metadata) : msg.metadata;
        return meta?.aiGenerated === true;
      } catch {
        return false;
      }
    });

    if (!hasAiHistory) {
      console.log("ℹ️ No trigger word match and no AI history, skipping AI auto-reply");
      return false;
    }

    console.log(`🤖 Continuing AI conversation (existing AI history) for: "${messageContent}"`);
  } else {
    console.log(`🤖 Trigger word matched for message: "${messageContent}"`);
  }

  
  const conversationHistory = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversation.id))
    .orderBy(desc(messages.timestamp));

  
  const aiResponse = await generateAiResponse(
    messageContent,
    conversationHistory,
    contact,
    getAiSettings
  );

  if (!aiResponse) {
    console.error("❌ Failed to generate AI response");
    return false;
  }

  
  try {
    const result = await whatsappApi.sendTextMessage(
      conversation.contactPhone,
      aiResponse
    );

    
    const aiMessage = await storage.createMessage({
      conversationId: conversation.id,
      content: aiResponse,
      fromUser: true,
      direction: "outbound",
      status: "sent",
      whatsappMessageId: result.messages?.[0]?.id || null,
      messageType: "text",
      metadata: JSON.stringify({ aiGenerated: true, trigger: messageContent }),
      timestamp: new Date(),
    });

    
    await storage.updateConversation(conversation.id, {
      lastMessageAt: new Date(),
      lastMessageText: aiResponse,
    });

    
    if ((global as any).broadcastToConversation) {
      (global as any).broadcastToConversation(conversation.id, {
        type: "new-message",
        message: aiMessage,
      });

      (global as any).broadcastToConversation(conversation.id, {
        type: "ai-reply-sent",
        data: {
          messageId: aiMessage.id,
          trigger: messageContent,
          response: aiResponse,
        },
      });
    }

    return true;
  } catch (error) {
    console.error("❌ Failed to send AI reply:", error);
    throw error;
  }
}

async function generateAiResponse(
  userMessage: string,
  conversationHistory: any[],
  contact: any,
  aiSettings: any
): Promise<string | null> {
  try {
    const { provider, apiKey, model, endpoint, temperature, maxTokens } = aiSettings;

    
    const messages = [
      {
        role: "system",
        content: `You are a helpful WhatsApp assistant. Respond naturally and helpfully to customer messages. Keep responses concise and friendly. Customer name: ${contact?.name || "Customer"}`,
      },
    ];

    
    conversationHistory
      .slice(-10)
      .reverse()
      .forEach((msg) => {
        messages.push({
          role: msg.fromUser ? "assistant" : "user",
          content: msg.content,
        });
      });

    
    messages.push({
      role: "user",
      content: userMessage,
    });

    
    let aiResponse: string | null = null;

    if (provider === "openai") {
      aiResponse = await callOpenAI(
        messages,
        apiKey,
        model,
        endpoint || "https://api.openai.com/v1",
        parseFloat(temperature || "0.7"),
        parseInt(maxTokens || "2048", 10)
      );
    } else if (provider === "anthropic") {
      aiResponse = await callAnthropic(
        messages,
        apiKey,
        model,
        endpoint || "https://api.anthropic.com/v1",
        parseFloat(temperature || "0.7"),
        parseInt(maxTokens || "2048", 10)
      );
    } else {
      console.error(`Unsupported AI provider: ${provider}`);
      return null;
    }

    return aiResponse;
  } catch (error) {
    console.error("❌ Error generating AI response:", error);
    return null;
  }
}

async function callOpenAI(
  messages: any[],
  apiKey: string,
  model: string,
  endpoint: string,
  temperature: number,
  maxTokens: number
): Promise<string | null> {
  try {
    const response = await fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("OpenAI API error:", error);
      return null;
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (error) {
    console.error("OpenAI API call failed:", error);
    return null;
  }
}

async function callAnthropic(
  messages: any[],
  apiKey: string,
  model: string,
  endpoint: string,
  temperature: number,
  maxTokens: number
): Promise<string | null> {
  try {
    
    const systemMessage = messages.find((m) => m.role === "system")?.content || "";
    const conversationMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      }));

    const response = await fetch(`${endpoint}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        messages: conversationMessages,
        system: systemMessage,
        temperature,
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("Anthropic API error:", error);
      return null;
    }

    const data = await response.json();
    return data.content?.[0]?.text || null;
  } catch (error) {
    console.error("Anthropic API call failed:", error);
    return null;
  }
}

async function handleMessageStatuses(statuses: any[], metadata: any) {
  const phoneNumberId = metadata?.phone_number_id;
  if (!phoneNumberId) {
    console.error("No phone_number_id in webhook status update");
    return;
  }

  const channel = await storage.getChannelByPhoneNumberId(phoneNumberId);
  if (!channel) {
    console.error(`No channel found for phone_number_id: ${phoneNumberId}`);
    return;
  }

  for (const statusUpdate of statuses) {
    const {
      id: whatsappMessageId,
      status,
      timestamp,
      errors,
      recipient_id,
    } = statusUpdate;

    console.log(
      `📊 Message status update: ${whatsappMessageId} - ${status}`,
      errors ? `Errors: ${errors.length}` : ""
    );

    
    const message = await storage.getMessageByWhatsAppId(whatsappMessageId);
    if (!message) {
      console.log(`⚠️ Message not found for WhatsApp ID: ${whatsappMessageId}`);
      continue;
    }

    
    let messageStatus: "sent" | "delivered" | "read" | "failed" = "sent";
    let errorDetails = null;

    if (status === "sent") {
      messageStatus = "sent";
    } else if (status === "delivered") {
      messageStatus = "delivered";
    } else if (status === "read") {
      messageStatus = "read";
    } else if (status === "failed" && errors && errors.length > 0) {
      messageStatus = "failed";
      const error = errors[0];
      const enriched = getWhatsAppError(error.code);
      errorDetails = {
        code: error.code,
        title: error.title,
        message: error.message || error.details,
        description: enriched.description,
        suggestion: enriched.suggestion,
        errorData: error.error_data,
        recipientId: recipient_id,
        timestamp: timestamp,
      };

      console.error(`❌ Message failed with error:`, errorDetails);
    }

    const pricingData = statusUpdate.pricing;
    const conversationData = statusUpdate.conversation;
    const existingMetadata = (message.metadata as Record<string, any>) || {};
    const updatedMetadata = {
      ...existingMetadata,
      ...(pricingData ? { pricing: pricingData } : {}),
      ...(conversationData ? { conversation: conversationData } : {}),
    };

    const updatedMessage = await storage.updateMessage(message.id, {
      status: messageStatus,
      errorDetails: errorDetails || null,
      deliveredAt:
        messageStatus === "delivered"
          ? new Date(parseInt(timestamp, 10) * 1000)
          : message.deliveredAt,
      readAt:
        messageStatus === "read"
          ? new Date(parseInt(timestamp, 10) * 1000)
          : message.readAt,
      metadata: updatedMetadata,
      updatedAt: new Date(),
    });

    
    
    
    
    
    
    
    
    
    
    
    
    

    const io = (global as any).io;

if (io && message.conversationId) {
  const statusPayload = {
    conversationId: message.conversationId,
    messageId: message.id,
    whatsappMessageId,
    status: messageStatus,
    timestamp: new Date(parseInt(timestamp, 10) * 1000).toISOString(),
    errorDetails,
  };

  io.to(`conversation:${message.conversationId}`).emit(
    "message_status_update",
    statusPayload
  );

  if (channel?.id) {
    io.to(`channel:${channel.id}`).emit(
      "message_status_update",
      statusPayload
    );
  }

  console.log(
    "📤 message_status_update emitted to conversation + channel:",
    whatsappMessageId,
    messageStatus
  );
}

    const campaignId = (message as any).campaignId || (message.metadata as any)?.campaignId;
    if (campaignId) {
      const campaign = await storage.getCampaign(campaignId);
      if (campaign) {
        if (messageStatus === "delivered" && message.status !== "delivered") {
          await db.update(campaigns).set({
            deliveredCount: sql`COALESCE(${campaigns.deliveredCount}, 0) + 1`,
          }).where(eq(campaigns.id, campaignId));
        } else if (messageStatus === "read" && message.status !== "read") {
          await db.update(campaigns).set({
            readCount: sql`COALESCE(${campaigns.readCount}, 0) + 1`,
          }).where(eq(campaigns.id, campaignId));
        } else if (messageStatus === "failed" && message.status !== "failed") {
          await db.update(campaigns).set({
            failedCount: sql`COALESCE(${campaigns.failedCount}, 0) + 1`,
            sentCount: message.status === "sent"
              ? sql`GREATEST(COALESCE(${campaigns.sentCount}, 0) - 1, 0)`
              : campaigns.sentCount,
          }).where(eq(campaigns.id, campaignId));

          const failureReason = errorDetails
            ? `${errorDetails.title || "Error"}: ${errorDetails.message || "Unknown"} (code: ${errorDetails.code || "N/A"})`
            : "Unknown failure";
          console.error(`❌ [Campaign ${campaignId}] Message failed to ${recipient_id}: ${failureReason}`);
        }
      }
    }
  }
}

async function handleTemplateStatusUpdate(value: any, wabaId?: string) {
  const { message_template_id, message_template_name, event, reason } = value;

  console.log(
    `[Template Status] Update received: ${message_template_name} (WA ID: ${message_template_id}) - ${event}${
      reason ? ` - Reason: ${reason}` : ""
    } - WABA: ${wabaId || "unknown"}`
  );

  if (message_template_id && event) {
    let status = "PENDING";
    if (event === "APPROVED") {
      status = "APPROVED";
    } else if (event === "REJECTED") {
      status = "REJECTED";
    }

    let targetChannelId: string | null = null;

    if (wabaId) {
      const allChannels = await storage.getChannels();
      const matchedChannel = allChannels.find(
        (ch: any) => String(ch.whatsappBusinessAccountId) === String(wabaId)
      );
      if (matchedChannel) {
        targetChannelId = matchedChannel.id;
        console.log(`[Template Status] Matched WABA ${wabaId} to channel: ${matchedChannel.phoneNumber} (${targetChannelId})`);
      } else {
        console.warn(`[Template Status] No channel found for WABA ${wabaId}, falling back to global search`);
      }
    }

    let template: any = null;

    if (targetChannelId) {
      const { data: channelTemplates } = await storage.getTemplatesByChannel(targetChannelId, 1, 10000);
      const templatesList = Array.isArray(channelTemplates) ? channelTemplates : [];
      template = templatesList.find(
        (t: any) => String(t.whatsappTemplateId) === String(message_template_id)
      );
    }

    if (!template) {
      const templatesResult = await storage.getTemplates(1, 10000);
      const templatesList = Array.isArray(templatesResult) ? templatesResult : (templatesResult?.data || []);
      template = templatesList.find(
        (t: any) => String(t.whatsappTemplateId) === String(message_template_id) &&
          (!targetChannelId || t.channelId === targetChannelId)
      );
    }

    if (template) {
      const updateData: any = { status };
      if (event === "REJECTED" && reason) {
        updateData.rejectionReason = reason;
      }
      await storage.updateTemplate(template.id, updateData);
      console.log(
        `[Template Status] Updated template "${template.name}" (channel: ${template.channelId}) status to ${status}${
          reason ? ` with reason: ${reason}` : ""
        }`
      );
    } else {
      console.warn(`[Template Status] No matching template found for WA ID: ${message_template_id} in channel: ${targetChannelId || "any"}`);
    }
  }
}

export const getConversationAutomationStatus = asyncHandler(
  async (req: Request, res: Response) => {
    const { conversationId } = req.params;

    const executionService = triggerService.getExecutionService();
    const hasPending = executionService.hasPendingExecution(conversationId);
    const pendingExecutions = executionService
      .getPendingExecutions()
      .filter((pe) => pe.conversationId === conversationId);

    res.json({
      conversationId,
      hasPendingExecution: hasPending,
      pendingExecutions,
      totalPendingCount: pendingExecutions.length,
    });
  }
);

export const cancelConversationAutomation = asyncHandler(
  async (req: Request, res: Response) => {
    const { conversationId } = req.params;

    const executionService = triggerService.getExecutionService();
    const cancelled = await executionService.cancelExecution(conversationId);

    res.json({
      success: cancelled,
      conversationId,
      message: cancelled
        ? "Automation execution cancelled successfully"
        : "No pending execution found for this conversation",
    });
  }
);

export const getAllPendingExecutions = asyncHandler(
  async (req: Request, res: Response) => {
    const executionService = triggerService.getExecutionService();
    const pendingExecutions = executionService.getPendingExecutions();

    res.json({
      totalCount: pendingExecutions.length,
      executions: pendingExecutions,
    });
  }
);

export const cleanupExpiredExecutions = asyncHandler(
  async (req: Request, res: Response) => {
    const { timeoutMinutes = 30 } = req.query;
    const timeoutMs = parseInt(timeoutMinutes as string) * 60 * 1000;

    const executionService = triggerService.getExecutionService();
    const cleanedCount = await executionService.cleanupExpiredExecutions(
      timeoutMs
    );

    res.json({
      success: true,
      cleanedCount,
      message: `Cleaned up ${cleanedCount} expired executions`,
    });
  }
);

export const razorpayWebhook = async (req: Request, res: Response) => {
  try {
    const provider = await db
      .select()
      .from(paymentProviders)
      .where(and(eq(paymentProviders.providerKey, "razorpay"), eq(paymentProviders.isActive, true)))
      .limit(1);

    const webhookSecret =
      provider[0]?.config?.webhookSecret ||
      process.env.RAZORPAY_WEBHOOK_SECRET || '';
    const signature = req.headers['x-razorpay-signature'] as string;

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    if (signature !== expectedSignature) {
      return res.status(400).json({
        success: false,
        message: 'Invalid webhook signature'
      });
    }

    const event = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString()) : req.body;
    const eventType = event.event;

    console.log('Razorpay Webhook Event:', eventType);

    switch (eventType) {
      case 'payment.authorized':
        await handleRazorpayPaymentAuthorized(event);
        break;
      case 'payment.captured':
        await handleRazorpayPaymentCaptured(event);
        break;
      case 'payment.failed':
        await handleRazorpayPaymentFailed(event);
        break;
      case 'order.paid':
        await handleRazorpayOrderPaid(event);
        break;
      case 'refund.created':
        await handleRazorpayRefundCreated(event);
        break;
      case 'subscription.activated':
        await handleRazorpaySubscriptionActivated(event);
        break;
      case 'subscription.charged':
        await handleRazorpaySubscriptionCharged(event);
        break;
      case 'subscription.cancelled':
        await handleRazorpaySubscriptionCancelled(event);
        break;
      case 'subscription.halted':
        await handleRazorpaySubscriptionHalted(event);
        break;
      case 'subscription.completed':
        await handleRazorpaySubscriptionCompleted(event);
        break;
      default:
        console.log('Unhandled Razorpay event:', eventType);
    }

    res.status(200).json({ success: true, message: 'Webhook received' });
  } catch (error) {
    console.error('Razorpay webhook error:', error);
    res.status(500).json({ success: false, message: 'Webhook processing failed', error });
  }
};

export const stripeWebhook = async (req: Request, res: Response) => {
  try {
    const stripe = await getStripe();
    if (!stripe) {
      return res.status(500).json({ success: false, message: 'Stripe is not configured' });
    }

    const provider = await db
      .select()
      .from(paymentProviders)
      .where(and(eq(paymentProviders.providerKey, "stripe"), eq(paymentProviders.isActive, true)))
      .limit(1);

    const webhookSecret =
      provider[0]?.config?.webhookSecret ||
      process.env.STRIPE_WEBHOOK_SECRET || '';
    const signature = req.headers['stripe-signature'] as string;

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        webhookSecret
      );
    } catch (err: any) {
      console.error('Stripe signature verification failed:', err.message);
      return res.status(400).json({
        success: false,
        message: `Webhook signature verification failed: ${err.message}`
      });
    }

    const eventType = event.type;
    console.log('Stripe Webhook Event:', eventType);

    switch (eventType) {
      case 'payment_intent.succeeded':
        await handleStripePaymentIntentSucceeded(event.data.object);
        break;
      case 'payment_intent.payment_failed':
        await handleStripePaymentIntentFailed(event.data.object);
        break;
      case 'charge.succeeded':
        await handleStripeChargeSucceeded(event.data.object);
        break;
      case 'charge.refunded':
        await handleStripeChargeRefunded(event.data.object);
        break;
      case 'invoice.paid':
        await handleStripeInvoicePaid(event.data.object);
        break;
      case 'invoice.payment_failed':
        await handleStripeInvoicePaymentFailed(event.data.object);
        break;
      case 'customer.subscription.created':
        await handleStripeSubscriptionCreated(event.data.object);
        break;
      case 'customer.subscription.updated':
        await handleStripeSubscriptionUpdated(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await handleStripeSubscriptionDeleted(event.data.object);
        break;
      default:
        console.log('Unhandled Stripe event:', eventType);
    }

    res.status(200).json({ success: true, message: 'Webhook received' });
  } catch (error) {
    console.error('Stripe webhook error:', error);
    res.status(500).json({ success: false, message: 'Webhook processing failed', error });
  }
};

async function handleRazorpayPaymentAuthorized(event: any) {
  const payment = event.payload.payment.entity;
  console.log('Razorpay payment authorized:', payment.id);

  await updateTransactionByProviderOrderId(
    payment.order_id,
    {
      status: 'authorized',
      providerPaymentId: payment.id,
      metadata: {
        method: payment.method,
        amount: payment.amount / 100,
        currency: payment.currency
      }
    }
  );
}

async function handleRazorpayPaymentCaptured(event: any) {
  const payment = event.payload.payment.entity;
  console.log('Razorpay payment captured:', payment.id);

  const transaction =
    (await findTransactionByProviderOrderId(payment.order_id)) ||
    (await findTransactionByProviderTransactionId(payment.invoice_id));

  if (transaction) {
    await db.update(transactions)
      .set({
        status: 'completed',
        providerPaymentId: payment.id,
        paidAt: new Date(),
        metadata: {
          method: payment.method,
          amount: payment.amount / 100,
          currency: payment.currency,
          cardId: payment.card_id,
          bank: payment.bank,
          wallet: payment.wallet
        },
        updatedAt: new Date()
      })
      .where(eq(transactions.id, transaction.id));

    await createSubscriptionFromTransaction(transaction, null, "razorpay");
  }
}

async function handleRazorpayPaymentFailed(event: any) {
  const payment = event.payload.payment.entity;
  console.log('Razorpay payment failed:', payment.id);

  await updateTransactionByProviderOrderId(
    payment.order_id,
    {
      status: 'failed',
      providerPaymentId: payment.id,
      metadata: {
        errorCode: payment.error_code,
        errorDescription: payment.error_description,
        errorReason: payment.error_reason
      }
    }
  );
}

async function handleRazorpayOrderPaid(event: any) {
  const order = event.payload.order.entity;
  console.log('Razorpay order paid:', order.id);

  await updateTransactionByProviderOrderId(
    order.id,
    {
      status: 'completed',
      paidAt: new Date()
    }
  );
}

async function handleRazorpayRefundCreated(event: any) {
  const refund = event.payload.refund.entity;
  console.log('Razorpay refund created:', refund.id);

  await updateTransactionByProviderPaymentId(
    refund.payment_id,
    {
      status: 'refunded',
      refundedAt: new Date(),
      metadata: {
        refundId: refund.id,
        refundAmount: refund.amount / 100
      }
    }
  );
}

async function handleRazorpaySubscriptionActivated(event: any) {
  const sub = event.payload.subscription.entity;
  console.log('Razorpay subscription activated:', sub.id);

  const existingSub = await findSubscriptionByGatewayId(sub.id);
  if (existingSub) {
    await db.update(subscriptions)
      .set({
        status: 'active',
        gatewayStatus: sub.status || 'active',
        updatedAt: new Date()
      })
      .where(eq(subscriptions.id, existingSub.id));
    console.log('Razorpay subscription activated in DB:', existingSub.id);
  }
}

async function handleRazorpaySubscriptionCharged(event: any) {
  const sub = event.payload.subscription.entity;
  const payment = event.payload.payment?.entity;
  console.log('Razorpay subscription charged:', sub.id, 'payment:', payment?.id);

  const existingSub = await findSubscriptionByGatewayId(sub.id);
  if (existingSub) {
    let newStartDate = new Date();
    let newEndDate: Date;

    if (sub.current_end) {
      newEndDate = new Date(sub.current_end * 1000);
    } else if (sub.charge_at) {
      newEndDate = new Date(sub.charge_at * 1000);
    } else {
      newEndDate = new Date();
      if (existingSub.billingCycle === 'annual') {
        newEndDate.setFullYear(newEndDate.getFullYear() + 1);
      } else {
        newEndDate.setMonth(newEndDate.getMonth() + 1);
      }
    }

    if (sub.current_start) {
      newStartDate = new Date(sub.current_start * 1000);
    }

    await db.update(subscriptions)
      .set({
        status: 'active',
        gatewayStatus: 'active',
        startDate: newStartDate,
        endDate: newEndDate,
        autoRenew: true,
        updatedAt: new Date()
      })
      .where(eq(subscriptions.id, existingSub.id));
    console.log('Razorpay subscription renewed in DB:', existingSub.id);
  }
}

async function handleRazorpaySubscriptionCancelled(event: any) {
  const sub = event.payload.subscription.entity;
  console.log('Razorpay subscription cancelled:', sub.id);

  const existingSub = await findSubscriptionByGatewayId(sub.id);
  if (existingSub) {
    await db.update(subscriptions)
      .set({
        status: 'cancelled',
        gatewayStatus: 'cancelled',
        autoRenew: false,
        updatedAt: new Date()
      })
      .where(eq(subscriptions.id, existingSub.id));
    console.log('Razorpay subscription cancelled in DB:', existingSub.id);
  }
}

async function handleRazorpaySubscriptionHalted(event: any) {
  const sub = event.payload.subscription.entity;
  console.log('Razorpay subscription halted:', sub.id);

  const existingSub = await findSubscriptionByGatewayId(sub.id);
  if (existingSub) {
    await db.update(subscriptions)
      .set({
        status: 'active',
        gatewayStatus: 'halted',
        autoRenew: false,
        updatedAt: new Date()
      })
      .where(eq(subscriptions.id, existingSub.id));
  }
}

async function handleRazorpaySubscriptionCompleted(event: any) {
  const sub = event.payload.subscription.entity;
  console.log('Razorpay subscription completed:', sub.id);

  const existingSub = await findSubscriptionByGatewayId(sub.id);
  if (existingSub) {
    await db.update(subscriptions)
      .set({
        status: 'expired',
        gatewayStatus: 'completed',
        autoRenew: false,
        updatedAt: new Date()
      })
      .where(eq(subscriptions.id, existingSub.id));
  }
}

async function handleStripePaymentIntentSucceeded(paymentIntent: any) {
  console.log('Stripe payment intent succeeded:', paymentIntent.id);

  const transaction = await findTransactionByProviderTransactionId(paymentIntent.id);

  if (transaction) {
    await db.update(transactions)
      .set({
        status: 'completed',
        paidAt: new Date(),
        metadata: {
          paymentMethod: paymentIntent.payment_method,
          amount: paymentIntent.amount / 100,
          currency: paymentIntent.currency
        },
        updatedAt: new Date()
      })
      .where(eq(transactions.id, transaction.id));

    await createSubscriptionFromTransaction(transaction, null, "stripe");
  }
}

async function handleStripePaymentIntentFailed(paymentIntent: any) {
  console.log('Stripe payment intent failed:', paymentIntent.id);

  await updateTransactionByProviderTransactionId(
    paymentIntent.id,
    {
      status: 'failed',
      metadata: {
        errorMessage: paymentIntent.last_payment_error?.message,
        errorCode: paymentIntent.last_payment_error?.code
      }
    }
  );
}

async function handleStripeChargeSucceeded(charge: any) {
  console.log('Stripe charge succeeded:', charge.id);

  await updateTransactionByProviderTransactionId(
    charge.payment_intent,
    {
      providerPaymentId: charge.id,
      metadata: {
        cardLast4: charge.payment_method_details?.card?.last4,
        cardBrand: charge.payment_method_details?.card?.brand,
        receiptUrl: charge.receipt_url
      }
    }
  );
}

async function handleStripeChargeRefunded(charge: any) {
  console.log('Stripe charge refunded:', charge.id);

  await updateTransactionByProviderPaymentId(
    charge.id,
    {
      status: 'refunded',
      refundedAt: new Date(),
      metadata: {
        refundAmount: charge.amount_refunded / 100
      }
    }
  );
}

async function handleStripeInvoicePaid(invoice: any) {
  console.log('Stripe invoice paid:', invoice.id);

  const stripeSubId = invoice.subscription;
  if (!stripeSubId) return;

  const existingSub = await findSubscriptionByGatewayId(stripeSubId);
  if (existingSub) {
    const periodEnd = invoice.lines?.data?.[0]?.period?.end;
    const newEndDate = periodEnd ? new Date(periodEnd * 1000) : null;

    const updateData: any = {
      status: 'active',
      gatewayStatus: 'active',
      autoRenew: true,
      updatedAt: new Date()
    };
    if (newEndDate) {
      updateData.endDate = newEndDate;
      updateData.startDate = new Date();
    }

    await db.update(subscriptions)
      .set(updateData)
      .where(eq(subscriptions.id, existingSub.id));
    console.log('Stripe subscription renewed via invoice:', existingSub.id);
  }
}

async function handleStripeInvoicePaymentFailed(invoice: any) {
  console.log('Stripe invoice payment failed:', invoice.id);

  const stripeSubId = invoice.subscription;
  if (!stripeSubId) return;

  const existingSub = await findSubscriptionByGatewayId(stripeSubId);
  if (existingSub) {
    await db.update(subscriptions)
      .set({
        gatewayStatus: 'past_due',
        updatedAt: new Date()
      })
      .where(eq(subscriptions.id, existingSub.id));
    console.log('Stripe subscription marked past_due:', existingSub.id);
  }
}

async function handleStripeSubscriptionCreated(subscription: any) {
  console.log('Stripe subscription created:', subscription.id);

  const existingSub = await findSubscriptionByGatewayId(subscription.id);
  if (existingSub) {
    await db.update(subscriptions)
      .set({
        gatewayStatus: subscription.status,
        updatedAt: new Date()
      })
      .where(eq(subscriptions.id, existingSub.id));
  }
}

async function handleStripeSubscriptionUpdated(subscription: any) {
  console.log('Stripe subscription updated:', subscription.id);

  const existingSub = await findSubscriptionByGatewayId(subscription.id);
  if (existingSub) {
    const updateData: any = {
      gatewayStatus: subscription.status,
      updatedAt: new Date()
    };

    if (subscription.cancel_at_period_end) {
      updateData.autoRenew = false;
      updateData.gatewayStatus = 'cancel_at_period_end';
    }

    if (subscription.status === 'active' && !subscription.cancel_at_period_end) {
      updateData.status = 'active';
      updateData.autoRenew = true;
    }

    if (subscription.current_period_end) {
      updateData.endDate = new Date(subscription.current_period_end * 1000);
    }
    if (subscription.current_period_start) {
      updateData.startDate = new Date(subscription.current_period_start * 1000);
    }

    const newPriceId = subscription.items?.data?.[0]?.price?.id;
    if (newPriceId) {
      const matchingPlan = await db
        .select()
        .from(plans)
        .where(eq(plans.stripePriceIdMonthly, newPriceId))
        .limit(1);

      const matchingPlanAnnual = matchingPlan.length === 0
        ? await db
            .select()
            .from(plans)
            .where(eq(plans.stripePriceIdAnnual, newPriceId))
            .limit(1)
        : [];

      const plan = matchingPlan[0] || matchingPlanAnnual[0];
      if (plan && plan.id !== existingSub.planId) {
        updateData.planId = plan.id;
        updateData.billingCycle = matchingPlanAnnual.length > 0 ? 'annual' : 'monthly';
        updateData.planData = {
          name: plan.name,
          description: plan.description,
          monthlyPrice: plan.monthlyPrice,
          annualPrice: plan.annualPrice,
          permissions: plan.permissions,
          features: plan.features,
        };

        await db.update(users)
          .set({ planId: plan.id, updatedAt: new Date() })
          .where(eq(users.id, existingSub.userId));
      }
    }

    await db.update(subscriptions)
      .set(updateData)
      .where(eq(subscriptions.id, existingSub.id));
    console.log('Stripe subscription updated in DB:', existingSub.id);
  }
}

async function handleStripeSubscriptionDeleted(subscription: any) {
  console.log('Stripe subscription deleted:', subscription.id);

  const existingSub = await findSubscriptionByGatewayId(subscription.id);
  if (existingSub) {
    await db.update(subscriptions)
      .set({
        status: 'cancelled',
        gatewayStatus: 'canceled',
        autoRenew: false,
        updatedAt: new Date()
      })
      .where(eq(subscriptions.id, existingSub.id));
    console.log('Stripe subscription cancelled in DB:', existingSub.id);
  }
}

async function findSubscriptionByGatewayId(gatewayId: string) {
  const result = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.gatewaySubscriptionId, gatewayId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

async function findTransactionByProviderOrderId(orderId: string) {
  const result = await db
    .select()
    .from(transactions)
    .where(eq(transactions.providerOrderId, orderId))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

async function findTransactionByProviderTransactionId(transactionId: string) {
  const result = await db
    .select()
    .from(transactions)
    .where(eq(transactions.providerTransactionId, transactionId))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

async function findTransactionByProviderPaymentId(paymentId: string) {
  const result = await db
    .select()
    .from(transactions)
    .where(eq(transactions.providerPaymentId, paymentId))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

async function updateTransactionByProviderOrderId(orderId: string, updateData: any) {
  const transaction = await findTransactionByProviderOrderId(orderId);
  if (transaction) {
    await db.update(transactions)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(transactions.id, transaction.id));
  }
}

async function updateTransactionByProviderTransactionId(transactionId: string, updateData: any) {
  const transaction = await findTransactionByProviderTransactionId(transactionId);
  if (transaction) {
    await db.update(transactions)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(transactions.id, transaction.id));
  }
}

async function updateTransactionByProviderPaymentId(paymentId: string, updateData: any) {
  const transaction = await findTransactionByProviderPaymentId(paymentId);
  if (transaction) {
    await db.update(transactions)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(transactions.id, transaction.id));
  }
}

async function createSubscriptionFromTransaction(
  transaction: any,
  gatewaySubscriptionId?: string | null,
  gatewayProvider?: string | null
) {
  if (transaction.subscriptionId) {
    return;
  }

  const planData = await db
    .select()
    .from(plans)
    .where(eq(plans.id, transaction.planId))
    .limit(1);

  const plan = planData[0] || null;

  const startDate = new Date();
  const endDate = new Date();

  if (transaction.billingCycle === 'annual') {
    endDate.setFullYear(endDate.getFullYear() + 1);
  } else {
    endDate.setMonth(endDate.getMonth() + 1);
  }

  await db
    .update(subscriptions)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(
      and(
        eq(subscriptions.userId, transaction.userId),
        eq(subscriptions.status, 'active')
      )
    );

  const newSubscription = await db
    .insert(subscriptions)
    .values({
      userId: transaction.userId,
      planId: transaction.planId,
      planData: plan
        ? {
            name: plan.name,
            description: plan.description,
            monthlyPrice: plan.monthlyPrice,
            annualPrice: plan.annualPrice,
            permissions: plan.permissions,
            features: plan.features,
          }
        : undefined,
      status: 'active',
      billingCycle: transaction.billingCycle,
      startDate,
      endDate,
      autoRenew: true,
      currency: transaction.currency || 'USD',
      gatewaySubscriptionId: gatewaySubscriptionId || transaction.providerTransactionId || null,
      gatewayProvider: gatewayProvider || null,
      gatewayStatus: 'active',
    })
    .returning();

  await db
    .update(transactions)
    .set({ subscriptionId: newSubscription[0].id })
    .where(eq(transactions.id, transaction.id));

  if (transaction.userId) {
    await db
      .update(users)
      .set({ planId: transaction.planId, updatedAt: new Date() })
      .where(eq(users.id, transaction.userId));
  }

  console.log('Subscription created from webhook:', newSubscription[0].id);
}

export const paypalWebhook = async (req: Request, res: Response) => {
  try {
    const provider = await db
      .select()
      .from(paymentProviders)
      .where(and(eq(paymentProviders.providerKey, "paypal"), eq(paymentProviders.isActive, true)))
      .limit(1);

    if (!provider.length) {
      return res.status(400).json({ success: false, message: 'PayPal is not configured' });
    }

    const webhookId = provider[0]?.config?.webhookId || '';

    const headers = req.headers;
    const transmissionId = headers['paypal-transmission-id'] as string;
    const transmissionTime = headers['paypal-transmission-time'] as string;
    const certUrl = headers['paypal-cert-url'] as string;
    const transmissionSig = headers['paypal-transmission-sig'] as string;
    const authAlgo = headers['paypal-auth-algo'] as string;

    const parsedBody = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString()) : req.body;

    if (webhookId && transmissionId && transmissionSig) {
      try {
        const isLive = provider[0]?.config?.isLive === true;
        const baseUrl = isLive
          ? "https://api-m.paypal.com"
          : "https://api-m.sandbox.paypal.com";

        const clientId = isLive
          ? provider[0].config?.apiKey
          : provider[0].config?.apiKeyTest || provider[0].config?.apiKey;
        const clientSecret = isLive
          ? provider[0].config?.apiSecret
          : provider[0].config?.apiSecretTest || provider[0].config?.apiSecret;

        const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
        const tokenRes = await axios.post(
          `${baseUrl}/v1/oauth2/token`,
          "grant_type=client_credentials",
          { headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" } }
        );
        const accessToken = tokenRes.data.access_token;

        const verifyRes = await axios.post(
          `${baseUrl}/v1/notifications/verify-webhook-signature`,
          {
            auth_algo: authAlgo,
            cert_url: certUrl,
            transmission_id: transmissionId,
            transmission_sig: transmissionSig,
            transmission_time: transmissionTime,
            webhook_id: webhookId,
            webhook_event: parsedBody,
          },
          { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } }
        );

        if (verifyRes.data.verification_status !== 'SUCCESS') {
          console.warn('PayPal webhook signature verification failed');
          return res.status(400).json({ success: false, message: 'Invalid webhook signature' });
        }
      } catch (verifyErr) {
        console.error('PayPal webhook signature verification error:', verifyErr);
      }
    }

    const event = parsedBody;
    const eventType = event.event_type;
    const resource = event.resource;

    console.log('PayPal Webhook Event:', eventType);

    switch (eventType) {
      case 'BILLING.SUBSCRIPTION.ACTIVATED': {
        const subId = resource.id;
        const existingSub = await findSubscriptionByGatewayId(subId);
        if (existingSub) {
          await db.update(subscriptions)
            .set({
              status: 'active',
              gatewayStatus: 'ACTIVE',
              updatedAt: new Date()
            })
            .where(eq(subscriptions.id, existingSub.id));
          console.log('PayPal subscription activated:', subId);
        }
        break;
      }

      case 'PAYMENT.SALE.COMPLETED': {
        const billingAgreementId = resource.billing_agreement_id;
        if (billingAgreementId) {
          const existingSub = await findSubscriptionByGatewayId(billingAgreementId);
          if (existingSub) {
            let newEndDate = new Date();
            if (existingSub.billingCycle === 'annual') {
              newEndDate.setFullYear(newEndDate.getFullYear() + 1);
            } else {
              newEndDate.setMonth(newEndDate.getMonth() + 1);
            }

            await db.update(subscriptions)
              .set({
                status: 'active',
                gatewayStatus: 'ACTIVE',
                startDate: new Date(),
                endDate: newEndDate,
                autoRenew: true,
                updatedAt: new Date()
              })
              .where(eq(subscriptions.id, existingSub.id));
            console.log('PayPal subscription payment completed:', billingAgreementId);
          }

          const transaction = await findTransactionByProviderTransactionId(billingAgreementId);
          if (transaction) {
            await db.update(transactions)
              .set({
                status: 'completed',
                providerPaymentId: resource.id,
                paidAt: new Date(),
                metadata: {
                  amount: parseFloat(resource.amount?.total || '0'),
                  currency: resource.amount?.currency,
                },
                updatedAt: new Date()
              })
              .where(eq(transactions.id, transaction.id));

            await createSubscriptionFromTransaction(transaction, billingAgreementId, "paypal");
          }
        }
        break;
      }

      case 'BILLING.SUBSCRIPTION.CANCELLED': {
        const subId = resource.id;
        const existingSub = await findSubscriptionByGatewayId(subId);
        if (existingSub) {
          await db.update(subscriptions)
            .set({
              status: 'cancelled',
              gatewayStatus: 'CANCELLED',
              autoRenew: false,
              updatedAt: new Date()
            })
            .where(eq(subscriptions.id, existingSub.id));
          console.log('PayPal subscription cancelled:', subId);
        }
        break;
      }

      case 'BILLING.SUBSCRIPTION.SUSPENDED': {
        const subId = resource.id;
        const existingSub = await findSubscriptionByGatewayId(subId);
        if (existingSub) {
          await db.update(subscriptions)
            .set({
              gatewayStatus: 'SUSPENDED',
              autoRenew: false,
              updatedAt: new Date()
            })
            .where(eq(subscriptions.id, existingSub.id));
          console.log('PayPal subscription suspended:', subId);
        }
        break;
      }

      default:
        console.log('Unhandled PayPal event:', eventType);
    }

    res.status(200).json({ success: true, message: 'Webhook received' });
  } catch (error) {
    console.error('PayPal webhook error:', error);
    res.status(500).json({ success: false, message: 'Webhook processing failed', error });
  }
};

export const paystackWebhook = async (req: Request, res: Response) => {
  try {
    const provider = await db
      .select()
      .from(paymentProviders)
      .where(and(eq(paymentProviders.providerKey, "paystack"), eq(paymentProviders.isActive, true)))
      .limit(1);

    if (!provider.length) {
      return res.status(400).json({ success: false, message: 'Paystack is not configured' });
    }

    const secretKey =
      provider[0]?.config?.apiSecret ||
      provider[0]?.config?.apiSecretTest || '';

    const signature = req.headers['x-paystack-signature'] as string;

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));

    const expectedSignature = crypto
      .createHmac('sha512', secretKey)
      .update(rawBody)
      .digest('hex');

    if (signature !== expectedSignature) {
      return res.status(400).json({ success: false, message: 'Invalid webhook signature' });
    }

    const event = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString()) : req.body;
    const eventType = event.event;
    const data = event.data;

    console.log('Paystack Webhook Event:', eventType);

    switch (eventType) {
      case 'charge.success': {
        const reference = data.reference;
        const transaction = await findTransactionByProviderTransactionId(reference);

        if (transaction) {
          await db.update(transactions)
            .set({
              status: 'completed',
              providerPaymentId: String(data.id),
              paidAt: new Date(),
              metadata: {
                method: data.channel,
                amount: data.amount / 100,
                currency: data.currency,
                cardLast4: data.authorization?.last4,
                cardBrand: data.authorization?.brand,
                bank: data.authorization?.bank,
              },
              updatedAt: new Date()
            })
            .where(eq(transactions.id, transaction.id));

          await createSubscriptionFromTransaction(transaction, data.authorization?.authorization_code || null, "paystack");
        }
        break;
      }

      case 'subscription.create': {
        const subCode = data.subscription_code;
        const existingSub = await findSubscriptionByGatewayId(subCode);
        if (existingSub) {
          await db.update(subscriptions)
            .set({
              status: 'active',
              gatewayStatus: 'active',
              updatedAt: new Date()
            })
            .where(eq(subscriptions.id, existingSub.id));
          console.log('Paystack subscription created:', subCode);
        }
        break;
      }

      case 'subscription.not_renew': {
        const subCode = data.subscription_code;
        const existingSub = await findSubscriptionByGatewayId(subCode);
        if (existingSub) {
          await db.update(subscriptions)
            .set({
              autoRenew: false,
              gatewayStatus: 'non_renewing',
              updatedAt: new Date()
            })
            .where(eq(subscriptions.id, existingSub.id));
          console.log('Paystack subscription not renewing:', subCode);
        }
        break;
      }

      case 'subscription.disable': {
        const subCode = data.subscription_code;
        const existingSub = await findSubscriptionByGatewayId(subCode);
        if (existingSub) {
          await db.update(subscriptions)
            .set({
              status: 'cancelled',
              gatewayStatus: 'cancelled',
              autoRenew: false,
              updatedAt: new Date()
            })
            .where(eq(subscriptions.id, existingSub.id));
          console.log('Paystack subscription disabled:', subCode);
        }
        break;
      }

      default:
        console.log('Unhandled Paystack event:', eventType);
    }

    res.status(200).json({ success: true, message: 'Webhook received' });
  } catch (error) {
    console.error('Paystack webhook error:', error);
    res.status(500).json({ success: false, message: 'Webhook processing failed', error });
  }
};

export const mercadopagoWebhook = async (req: Request, res: Response) => {
  try {
    const provider = await db
      .select()
      .from(paymentProviders)
      .where(and(eq(paymentProviders.providerKey, "mercadopago"), eq(paymentProviders.isActive, true)))
      .limit(1);

    if (!provider.length) {
      return res.status(400).json({ success: false, message: 'Mercado Pago is not configured' });
    }

    const webhookSecret = provider[0]?.config?.webhookSecret || '';
    const xSignature = req.headers['x-signature'] as string;
    const xRequestId = req.headers['x-request-id'] as string;

    const parsedBody = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString()) : req.body;

    if (webhookSecret && xSignature) {
      try {
        const parts: Record<string, string> = {};
        xSignature.split(',').forEach((part: string) => {
          const [key, value] = part.trim().split('=');
          if (key && value) parts[key] = value;
        });

        const ts = parts['ts'];
        const v1 = parts['v1'];
        const dataId = req.query['data.id'] || parsedBody?.data?.id || '';

        const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
        const expectedHmac = crypto
          .createHmac('sha256', webhookSecret)
          .update(manifest)
          .digest('hex');

        if (v1 !== expectedHmac) {
          console.warn('Mercado Pago webhook signature verification failed');
          return res.status(400).json({ success: false, message: 'Invalid webhook signature' });
        }
      } catch (sigErr) {
        console.error('Mercado Pago signature verification error:', sigErr);
      }
    }

    const topic = parsedBody.type || req.query.topic;
    const action = parsedBody.action;
    const dataId = parsedBody.data?.id || req.query.id;

    console.log('Mercado Pago Webhook:', topic, action, 'dataId:', dataId);

    const accessToken =
      provider[0].config?.isLive
        ? provider[0].config?.apiSecret
        : provider[0].config?.apiSecretTest || provider[0].config?.apiSecret;

    if (topic === 'payment' && dataId) {
      try {
        const paymentRes = await axios.get(
          `https://api.mercadopago.com/v1/payments/${dataId}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const payment = paymentRes.data;

        if (payment.status === 'approved') {
          let externalRef: any = {};
          try {
            externalRef = JSON.parse(payment.external_reference || '{}');
          } catch {}

          const preapprovalId = payment.metadata?.preapproval_id || externalRef.subscriptionId;

          if (preapprovalId) {
            const existingSub = await findSubscriptionByGatewayId(preapprovalId);
            if (existingSub) {
              let newEndDate = new Date();
              if (existingSub.billingCycle === 'annual') {
                newEndDate.setFullYear(newEndDate.getFullYear() + 1);
              } else {
                newEndDate.setMonth(newEndDate.getMonth() + 1);
              }

              await db.update(subscriptions)
                .set({
                  status: 'active',
                  gatewayStatus: 'authorized',
                  startDate: new Date(),
                  endDate: newEndDate,
                  autoRenew: true,
                  updatedAt: new Date()
                })
                .where(eq(subscriptions.id, existingSub.id));
              console.log('Mercado Pago payment approved for subscription:', preapprovalId);
            }
          }

          const transaction = await findTransactionByProviderTransactionId(String(dataId));
          if (transaction) {
            await db.update(transactions)
              .set({
                status: 'completed',
                providerPaymentId: String(payment.id),
                paidAt: new Date(),
                metadata: {
                  amount: payment.transaction_amount,
                  currency: payment.currency_id,
                  paymentMethod: payment.payment_method_id,
                  paymentType: payment.payment_type_id,
                },
                updatedAt: new Date()
              })
              .where(eq(transactions.id, transaction.id));

            await createSubscriptionFromTransaction(transaction, preapprovalId || null, "mercadopago");
          }
        }
      } catch (fetchErr) {
        console.error('Mercado Pago: Error fetching payment details:', fetchErr);
      }
    }

    if ((topic === 'subscription_preapproval' || action?.includes('updated') || action?.includes('created')) && dataId) {
      try {
        const subRes = await axios.get(
          `https://api.mercadopago.com/preapproval/${dataId}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const preapproval = subRes.data;

        const existingSub = await findSubscriptionByGatewayId(String(dataId));
        if (existingSub) {
          const statusMap: Record<string, string> = {
            authorized: 'active',
            paused: 'active',
            cancelled: 'cancelled',
            pending: 'active',
          };

          const newStatus = statusMap[preapproval.status] || existingSub.status;
          const updateData: any = {
            gatewayStatus: preapproval.status,
            updatedAt: new Date()
          };

          if (preapproval.status === 'cancelled') {
            updateData.status = 'cancelled';
            updateData.autoRenew = false;
          } else if (preapproval.status === 'authorized') {
            updateData.status = 'active';
            updateData.autoRenew = true;
          } else if (preapproval.status === 'paused') {
            updateData.autoRenew = false;
          }

          await db.update(subscriptions)
            .set(updateData)
            .where(eq(subscriptions.id, existingSub.id));
          console.log('Mercado Pago subscription updated:', dataId, '->', preapproval.status);
        }
      } catch (fetchErr) {
        console.error('Mercado Pago: Error fetching preapproval details:', fetchErr);
      }
    }

    res.status(200).json({ success: true, message: 'Webhook received' });
  } catch (error) {
    console.error('Mercado Pago webhook error:', error);
    res.status(500).json({ success: false, message: 'Webhook processing failed', error });
  }
};

async function handleSmbMessageEchoes(value: any) {
  const { message_echoes, metadata } = value;

  if (!message_echoes || message_echoes.length === 0) {
    return;
  }

  const phoneNumberId = metadata?.phone_number_id;
  if (!phoneNumberId) {
    console.error("[smb_message_echoes] No phone_number_id in webhook");
    return;
  }

  const channel = await storage.getChannelByPhoneNumberId(phoneNumberId);
  if (!channel) {
    console.error(`[smb_message_echoes] No channel found for phone_number_id: ${phoneNumberId}`);
    return;
  }

  const waApi = new WhatsAppApiService(channel);

  for (const echo of message_echoes) {
    const { to, id: whatsappMessageId, text, type, timestamp } = echo;

    const customerPhone = to;
    if (!customerPhone) {
      console.error("[smb_message_echoes] No 'to' field in echo message");
      continue;
    }

    const existingMessage = await storage.getMessageByWhatsAppId(whatsappMessageId);
    if (existingMessage) {
      console.log(`[smb_message_echoes] Duplicate message ${whatsappMessageId}, skipping`);
      continue;
    }

    let messageContent = "";
    let mediaId: string | null = null;
    let mediaUrl: string | null = null;
    let mediaMimeType: string | null = null;
    let mediaSha256: string | null = null;

    if (type === "text" && text) {
      messageContent = text.body;
    } else if (type === "image" && echo.image) {
      messageContent = echo.image.caption || "[Image]";
      mediaId = echo.image.id;
      mediaMimeType = echo.image.mime_type;
      mediaSha256 = echo.image.sha256;
    } else if (type === "document" && echo.document) {
      messageContent = echo.document.caption || `[Document: ${echo.document.filename || "file"}]`;
      mediaId = echo.document.id;
      mediaMimeType = echo.document.mime_type;
      mediaSha256 = echo.document.sha256;
    } else if (type === "audio" && echo.audio) {
      messageContent = "[Audio message]";
      mediaId = echo.audio.id;
      mediaMimeType = echo.audio.mime_type;
      mediaSha256 = echo.audio.sha256;
    } else if (type === "video" && echo.video) {
      messageContent = echo.video.caption || "[Video]";
      mediaId = echo.video.id;
      mediaMimeType = echo.video.mime_type;
      mediaSha256 = echo.video.sha256;
    } else if (type === "location" && echo.location) {
      messageContent = `[Location: ${echo.location.latitude}, ${echo.location.longitude}]`;
    } else if (type === "contacts" && echo.contacts) {
      const contactNames = echo.contacts.map((c: any) => c.name?.formatted_name || "Contact").join(", ");
      messageContent = `[Contact: ${contactNames}]`;
    } else if (type === "sticker" && echo.sticker) {
      messageContent = "[Sticker]";
      mediaId = echo.sticker.id;
      mediaMimeType = echo.sticker.mime_type;
    } else {
      messageContent = `[${type} message]`;
    }

    if (mediaId) {
      try {
        mediaUrl = await waApi.fetchMediaUrl(mediaId);
      } catch (err) {
        console.error("[smb_message_echoes] Failed to fetch media URL:", err);
      }
    }

    let contact = await storage.getContactByPhoneAndChannel(customerPhone, channel.id);
    if (!contact) {
      contact = await storage.createContact({
        name: customerPhone,
        phone: customerPhone,
        channelId: channel.id,
        source: 'whatsapp',
        createdBy: channel.createdBy || undefined,
      });
    }

    let conversation = await storage.getConversationByPhoneAndChannel(customerPhone, channel.id);
    if (!conversation) {
      conversation = await storage.createConversation({
        contactId: contact.id,
        contactPhone: customerPhone,
        contactName: contact.name || customerPhone,
        channelId: channel.id,
        unreadCount: 0,
      });
    } else {
      await storage.updateConversation(conversation.id, {
        lastMessageAt: new Date(),
        lastMessageText: messageContent,
      });
    }

    const newMessage = await storage.createMessage({
      conversationId: conversation.id,
      content: messageContent,
      fromUser: true,
      direction: "outbound",
      status: "sent",
      whatsappMessageId,
      messageType: type,
      timestamp: new Date(parseInt(timestamp, 10) * 1000),
      mediaId,
      mediaUrl,
      mediaMimeType,
      mediaSha256,
    });

    const io = (global as any).io;
    if (io) {
      const channelRoom = `channel:${channel.id}`;
      const conversationRoom = `conversation:${conversation.id}`;

      const normalizedPayload = {
        type: "new-message",
        conversationId: conversation.id,
        content: messageContent,
        createdAt: new Date().toISOString(),
        messageType: type,
        from: "business_app",
      };

      io.to(channelRoom).emit("new-message", normalizedPayload);
      io.to(conversationRoom).emit("new-message", normalizedPayload);
      console.log("[smb_message_echoes] Emitted echo message to rooms");
    }

    console.log(`[smb_message_echoes] Stored echo message ${whatsappMessageId} to ${customerPhone} in channel ${channel.id}`);
  }
}

async function handleSmbAppStateSync(value: any) {
  const { metadata, contacts: syncContacts } = value;

  if (!syncContacts || syncContacts.length === 0) {
    console.log("[smb_app_state_sync] No contacts to sync");
    return;
  }

  const phoneNumberId = metadata?.phone_number_id;
  if (!phoneNumberId) {
    console.error("[smb_app_state_sync] No phone_number_id in webhook");
    return;
  }

  const channel = await storage.getChannelByPhoneNumberId(phoneNumberId);
  if (!channel) {
    console.error(`[smb_app_state_sync] No channel found for phone_number_id: ${phoneNumberId}`);
    return;
  }

  for (const syncContact of syncContacts) {
    const phone = syncContact.wa_id;
    const name = syncContact.profile?.name || syncContact.name?.formatted_name;

    if (!phone) continue;

    let existingContact = await storage.getContactByPhoneAndChannel(phone, channel.id);

    if (!existingContact) {
      await storage.createContact({
        name: name || phone,
        phone,
        channelId: channel.id,
        source: 'whatsapp',
        createdBy: channel.createdBy || undefined,
      });
      console.log(`[smb_app_state_sync] Created contact ${phone} for channel ${channel.id}`);
    } else if (name && existingContact.name !== name) {
      await storage.updateContact(existingContact.id, { name });
      console.log(`[smb_app_state_sync] Updated contact name ${phone} -> ${name} for channel ${channel.id}`);
    }
  }
}
