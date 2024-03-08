import type { Express } from "express";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import { Request, Response } from "express";
import { db } from "../db";
import { eq, and, desc, like, sql, gt } from "drizzle-orm";
import * as schema from "@shared/schema";
import { requireApiKey, requirePermission } from "../middlewares/apikey.middleware";
import { WhatsAppApiService } from "../services/whatsapp-api";
import crypto from "crypto";

export function registerRestApiV1Routes(app: Express) {
  app.post("/api/v1/messages/template", requireApiKey, requirePermission("messages.send"), async (req: Request, res: Response) => {
    try {
      const { userId, channelId, apiKeyId } = req.apiUser!;
      const { to, templateName, language, components } = req.body;

      if (!to || !templateName) {
        return res.status(400).json({ success: false, error: "Missing required fields: to, templateName" });
      }

      if (!channelId) {
        return res.status(400).json({ success: false, error: "No channel associated with this API key. Pass x-channel-id header or channel_id query param to specify a channel." });
      }

      const [channel] = await db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).limit(1);
      if (!channel) {
        return res.status(404).json({ success: false, error: "Channel not found" });
      }

      const result = await WhatsAppApiService.sendTemplateMessage(
        channel,
        to,
        templateName,
        components || [],
        language || "en_US"
      );

      const phone = to.replace(/\D/g, "");

      let [contact] = await db
        .select()
        .from(schema.contacts)
        .where(and(eq(schema.contacts.channelId, channelId), eq(schema.contacts.phone, phone)))
        .limit(1);

      if (!contact) {
        [contact] = await db
          .insert(schema.contacts)
          .values({
            channelId,
            phone,
            name: phone,
            source: "api",
            createdBy: userId,
          })
          .returning();
      }

      let [conversation] = await db
        .select()
        .from(schema.conversations)
        .where(
          and(
            eq(schema.conversations.channelId, channelId),
            eq(schema.conversations.contactId, contact.id)
          )
        )
        .limit(1);

      if (!conversation) {
        [conversation] = await db
          .insert(schema.conversations)
          .values({
            channelId,
            contactId: contact.id,
            contactPhone: phone,
            contactName: contact.name,
            status: "open",
          })
          .returning();
      }

      const [message] = await db
        .insert(schema.messages)
        .values({
          conversationId: conversation.id,
          fromUser: true,
          direction: "outbound",
          content: `[template: ${templateName}]`,
          type: "template",
          messageType: "template",
          status: "sent",
          whatsappMessageId: result?.messages?.[0]?.id,
          timestamp: new Date(),
          metadata: { templateName, language: language || "en_US", components },
        })
        .returning();

      await db
        .update(schema.conversations)
        .set({ lastMessageAt: new Date(), lastMessageText: `[template: ${templateName}]` })
        .where(eq(schema.conversations.id, conversation.id));

      return res.json({
        success: true,
        data: {
          messageId: message.id,
          whatsappMessageId: result?.messages?.[0]?.id,
          contactId: contact.id,
          conversationId: conversation.id,
          status: "sent",
        },
      });
    } catch (error: any) {
      console.error("REST API - Send template error:", error);
      return res.status(500).json({ success: false, error: error.message || "Failed to send template message" });
    }
  });

  app.post("/api/v1/messages/reply", requireApiKey, requirePermission("messages.send"), async (req: Request, res: Response) => {
    try {
      const { userId, channelId } = req.apiUser!;
      const { to, message: messageText } = req.body;

      if (!to || !messageText) {
        return res.status(400).json({ success: false, error: "Missing required fields: to, message" });
      }

      if (!channelId) {
        return res.status(400).json({ success: false, error: "No channel associated with this API key. Pass x-channel-id header or channel_id query param to specify a channel." });
      }

      const [channel] = await db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).limit(1);
      if (!channel) {
        return res.status(404).json({ success: false, error: "Channel not found" });
      }

      const phone = to.replace(/\D/g, "");

      const [contact] = await db
        .select()
        .from(schema.contacts)
        .where(and(eq(schema.contacts.channelId, channelId), eq(schema.contacts.phone, phone)))
        .limit(1);

      if (!contact) {
        return res.status(404).json({ success: false, error: "Contact not found. Send a template message first." });
      }

      const [conversation] = await db
        .select()
        .from(schema.conversations)
        .where(
          and(
            eq(schema.conversations.channelId, channelId),
            eq(schema.conversations.contactId, contact.id)
          )
        )
        .limit(1);

      if (!conversation) {
        return res.status(404).json({ success: false, error: "No conversation found for this contact" });
      }

      const lastIncoming = conversation.lastIncomingMessageAt
        ? new Date(conversation.lastIncomingMessageAt).getTime()
        : 0;
      const is24HourExpired = lastIncoming > 0 && Date.now() - lastIncoming > 24 * 60 * 60 * 1000;

      if (is24HourExpired || lastIncoming === 0) {
        return res.status(403).json({
          success: false,
          error: "24-hour messaging window has expired or no incoming message. Use a template message instead.",
        });
      }

      const whatsappApi = new WhatsAppApiService(channel);
      const result = await whatsappApi.sendTextMessage(phone, messageText);

      const [msg] = await db
        .insert(schema.messages)
        .values({
          conversationId: conversation.id,
          fromUser: true,
          direction: "outbound",
          content: messageText,
          type: "text",
          messageType: "text",
          status: "sent",
          whatsappMessageId: result?.messages?.[0]?.id,
          timestamp: new Date(),
          metadata: {},
        })
        .returning();

      await db
        .update(schema.conversations)
        .set({ lastMessageAt: new Date(), lastMessageText: messageText })
        .where(eq(schema.conversations.id, conversation.id));

      return res.json({
        success: true,
        data: {
          messageId: msg.id,
          whatsappMessageId: result?.messages?.[0]?.id,
          status: "sent",
        },
      });
    } catch (error: any) {
      console.error("REST API - Reply error:", error);
      return res.status(500).json({ success: false, error: error.message || "Failed to send reply" });
    }
  });

  app.get("/api/v1/messages/status/:messageId", requireApiKey, requirePermission("messages.read"), async (req: Request, res: Response) => {
    try {
      const { channelId } = req.apiUser!;
      const { messageId } = req.params;

      const [message] = await db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.id, messageId))
        .limit(1);

      if (!message) {
        return res.status(404).json({ success: false, error: "Message not found" });
      }

      if (message.conversationId) {
        const [conv] = await db
          .select()
          .from(schema.conversations)
          .where(eq(schema.conversations.id, message.conversationId))
          .limit(1);

        if (conv && conv.channelId !== channelId) {
          return res.status(403).json({ success: false, error: "Access denied" });
        }
      }

      return res.json({
        success: true,
        data: {
          id: message.id,
          whatsappMessageId: message.whatsappMessageId,
          status: message.status,
          deliveredAt: message.deliveredAt,
          readAt: message.readAt,
          errorCode: message.errorCode,
          errorMessage: message.errorMessage,
          createdAt: message.createdAt,
        },
      });
    } catch (error: any) {
      console.error("REST API - Message status error:", error);
      return res.status(500).json({ success: false, error: "Failed to get message status" });
    }
  });

  app.get("/api/v1/messages/:contactPhone", requireApiKey, requirePermission("messages.read"), async (req: Request, res: Response) => {
    try {
      const { channelId } = req.apiUser!;
      const { contactPhone } = req.params;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = parseInt(req.query.offset as string) || 0;

      if (!channelId) {
        return res.status(400).json({ success: false, error: "No channel associated with this API key. Pass x-channel-id header or channel_id query param to specify a channel." });
      }

      const phone = contactPhone.replace(/\D/g, "");

      const [contact] = await db
        .select()
        .from(schema.contacts)
        .where(and(eq(schema.contacts.channelId, channelId), eq(schema.contacts.phone, phone)))
        .limit(1);

      if (!contact) {
        return res.status(404).json({ success: false, error: "Contact not found" });
      }

      const [conversation] = await db
        .select()
        .from(schema.conversations)
        .where(
          and(
            eq(schema.conversations.channelId, channelId),
            eq(schema.conversations.contactId, contact.id)
          )
        )
        .limit(1);

      if (!conversation) {
        return res.json({ success: true, data: { messages: [], total: 0 } });
      }

      const messagesList = await db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.conversationId, conversation.id))
        .orderBy(desc(schema.messages.createdAt))
        .limit(limit)
        .offset(offset);

      const [countResult] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.messages)
        .where(eq(schema.messages.conversationId, conversation.id));

      return res.json({
        success: true,
        data: {
          messages: messagesList,
          total: countResult?.total || 0,
          limit,
          offset,
        },
      });
    } catch (error: any) {
      console.error("REST API - Message history error:", error);
      return res.status(500).json({ success: false, error: "Failed to get message history" });
    }
  });

  app.get("/api/v1/contacts", requireApiKey, requirePermission("contacts.read"), async (req: Request, res: Response) => {
    try {
      const { channelId } = req.apiUser!;
      const search = req.query.search as string;
      const groupId = req.query.groupId as string;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = parseInt(req.query.offset as string) || 0;

      if (!channelId) {
        return res.status(400).json({ success: false, error: "No channel associated with this API key. Pass x-channel-id header or channel_id query param to specify a channel." });
      }

      const conditions: any[] = [eq(schema.contacts.channelId, channelId)];
      if (search) {
        conditions.push(like(schema.contacts.name, `%${search}%`));
      }

      const contactsList = await db
        .select()
        .from(schema.contacts)
        .where(and(...conditions))
        .limit(limit)
        .offset(offset)
        .orderBy(desc(schema.contacts.createdAt));

      const [countResult] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.contacts)
        .where(and(...conditions));

      let filtered = contactsList;
      if (groupId) {
        filtered = contactsList.filter((c: any) => {
          const groups = c.groups || [];
          return Array.isArray(groups) && groups.includes(groupId);
        });
      }

      return res.json({
        success: true,
        data: {
          contacts: filtered,
          total: countResult?.total || 0,
          limit,
          offset,
        },
      });
    } catch (error: any) {
      console.error("REST API - List contacts error:", error);
      return res.status(500).json({ success: false, error: "Failed to list contacts" });
    }
  });

  app.post("/api/v1/contacts", requireApiKey, requirePermission("contacts.write"), async (req: Request, res: Response) => {
    try {
      const { userId, channelId } = req.apiUser!;
      const { phone, name, email } = req.body;

      if (!phone) {
        return res.status(400).json({ success: false, error: "Phone number is required" });
      }

      if (!channelId) {
        return res.status(400).json({ success: false, error: "No channel associated with this API key. Pass x-channel-id header or channel_id query param to specify a channel." });
      }

      const cleanPhone = phone.replace(/\D/g, "");

      const [existing] = await db
        .select()
        .from(schema.contacts)
        .where(and(eq(schema.contacts.channelId, channelId), eq(schema.contacts.phone, cleanPhone)))
        .limit(1);

      if (existing) {
        return res.status(409).json({ success: false, error: "Contact already exists", data: existing });
      }

      const [contact] = await db
        .insert(schema.contacts)
        .values({
          channelId,
          phone: cleanPhone,
          name: name || cleanPhone,
          email: email || null,
          source: "api",
          createdBy: userId,
        })
        .returning();

      return res.status(201).json({ success: true, data: contact });
    } catch (error: any) {
      console.error("REST API - Create contact error:", error);
      return res.status(500).json({ success: false, error: "Failed to create contact" });
    }
  });

  app.put("/api/v1/contacts/:id", requireApiKey, requirePermission("contacts.write"), async (req: Request, res: Response) => {
    try {
      const { channelId } = req.apiUser!;
      const { id } = req.params;
      const { name, email } = req.body;

      if (!channelId) {
        return res.status(400).json({ success: false, error: "No channel associated with this API key. Pass x-channel-id header or channel_id query param to specify a channel." });
      }

      const [existing] = await db
        .select()
        .from(schema.contacts)
        .where(and(eq(schema.contacts.id, id), eq(schema.contacts.channelId, channelId)))
        .limit(1);

      if (!existing) {
        return res.status(404).json({ success: false, error: "Contact not found" });
      }

      const updateData: any = { updatedAt: new Date() };
      if (name !== undefined) updateData.name = name;
      if (email !== undefined) updateData.email = email;

      const [updated] = await db
        .update(schema.contacts)
        .set(updateData)
        .where(eq(schema.contacts.id, id))
        .returning();

      return res.json({ success: true, data: updated });
    } catch (error: any) {
      console.error("REST API - Update contact error:", error);
      return res.status(500).json({ success: false, error: "Failed to update contact" });
    }
  });

  app.delete("/api/v1/contacts/:id", requireApiKey, requirePermission("contacts.write"), async (req: Request, res: Response) => {
    try {
      const { channelId } = req.apiUser!;
      const { id } = req.params;

      if (!channelId) {
        return res.status(400).json({ success: false, error: "No channel associated with this API key. Pass x-channel-id header or channel_id query param to specify a channel." });
      }

      const [existing] = await db
        .select()
        .from(schema.contacts)
        .where(and(eq(schema.contacts.id, id), eq(schema.contacts.channelId, channelId)))
        .limit(1);

      if (!existing) {
        return res.status(404).json({ success: false, error: "Contact not found" });
      }

      await db.delete(schema.contacts).where(eq(schema.contacts.id, id));

      return res.json({ success: true, data: { message: "Contact deleted successfully" } });
    } catch (error: any) {
      console.error("REST API - Delete contact error:", error);
      return res.status(500).json({ success: false, error: "Failed to delete contact" });
    }
  });

  app.get("/api/v1/contacts/groups", requireApiKey, requirePermission("contacts.read"), async (req: Request, res: Response) => {
    try {
      const { userId } = req.apiUser!;

      const groupsList = await db
        .select()
        .from(schema.groups)
        .where(eq(schema.groups.createdBy, userId))
        .orderBy(desc(schema.groups.createdAt));

      return res.json({ success: true, data: groupsList });
    } catch (error: any) {
      console.error("REST API - List groups error:", error);
      return res.status(500).json({ success: false, error: "Failed to list groups" });
    }
  });

  app.post("/api/v1/contacts/groups/:groupId/add", requireApiKey, requirePermission("contacts.write"), async (req: Request, res: Response) => {
    try {
      const { channelId } = req.apiUser!;
      const { groupId } = req.params;
      const { contactId } = req.body;

      if (!contactId) {
        return res.status(400).json({ success: false, error: "contactId is required" });
      }

      if (!channelId) {
        return res.status(400).json({ success: false, error: "No channel associated with this API key. Pass x-channel-id header or channel_id query param to specify a channel." });
      }

      const [contact] = await db
        .select()
        .from(schema.contacts)
        .where(and(eq(schema.contacts.id, contactId), eq(schema.contacts.channelId, channelId)))
        .limit(1);

      if (!contact) {
        return res.status(404).json({ success: false, error: "Contact not found" });
      }

      const currentGroups: string[] = (contact.groups as string[]) || [];
      if (currentGroups.includes(groupId)) {
        return res.json({ success: true, data: { message: "Contact already in group" } });
      }

      const updatedGroups = [...currentGroups, groupId];
      await db
        .update(schema.contacts)
        .set({ groups: updatedGroups })
        .where(eq(schema.contacts.id, contactId));

      return res.json({ success: true, data: { message: "Contact added to group" } });
    } catch (error: any) {
      console.error("REST API - Add to group error:", error);
      return res.status(500).json({ success: false, error: "Failed to add contact to group" });
    }
  });

  app.post("/api/v1/contacts/groups/:groupId/remove", requireApiKey, requirePermission("contacts.write"), async (req: Request, res: Response) => {
    try {
      const { channelId } = req.apiUser!;
      const { groupId } = req.params;
      const { contactId } = req.body;

      if (!contactId) {
        return res.status(400).json({ success: false, error: "contactId is required" });
      }

      if (!channelId) {
        return res.status(400).json({ success: false, error: "No channel associated with this API key. Pass x-channel-id header or channel_id query param to specify a channel." });
      }

      const [contact] = await db
        .select()
        .from(schema.contacts)
        .where(and(eq(schema.contacts.id, contactId), eq(schema.contacts.channelId, channelId)))
        .limit(1);

      if (!contact) {
        return res.status(404).json({ success: false, error: "Contact not found" });
      }

      const currentGroups: string[] = (contact.groups as string[]) || [];
      const updatedGroups = currentGroups.filter((g) => g !== groupId);

      await db
        .update(schema.contacts)
        .set({ groups: updatedGroups })
        .where(eq(schema.contacts.id, contactId));

      return res.json({ success: true, data: { message: "Contact removed from group" } });
    } catch (error: any) {
      console.error("REST API - Remove from group error:", error);
      return res.status(500).json({ success: false, error: "Failed to remove contact from group" });
    }
  });

  app.get("/api/v1/templates", requireApiKey, requirePermission("templates.read"), async (req: Request, res: Response) => {
    try {
      const { channelId } = req.apiUser!;
      const status = req.query.status as string;

      if (!channelId) {
        return res.status(400).json({ success: false, error: "No channel associated with this API key. Pass x-channel-id header or channel_id query param to specify a channel." });
      }

      const conditions: any[] = [eq(schema.templates.channelId, channelId)];
      if (status) {
        conditions.push(eq(schema.templates.status, status));
      }

      const templatesList = await db
        .select()
        .from(schema.templates)
        .where(and(...conditions))
        .orderBy(desc(schema.templates.createdAt));

      return res.json({ success: true, data: templatesList });
    } catch (error: any) {
      console.error("REST API - List templates error:", error);
      return res.status(500).json({ success: false, error: "Failed to list templates" });
    }
  });

  app.get("/api/v1/campaigns", requireApiKey, requirePermission("campaigns.read"), async (req: Request, res: Response) => {
    try {
      const { channelId } = req.apiUser!;
      const status = req.query.status as string;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = parseInt(req.query.offset as string) || 0;

      if (!channelId) {
        return res.status(400).json({ success: false, error: "No channel associated with this API key. Pass x-channel-id header or channel_id query param to specify a channel." });
      }

      const conditions: any[] = [eq(schema.campaigns.channelId, channelId)];
      if (status) {
        conditions.push(eq(schema.campaigns.status, status));
      }

      const campaignsList = await db
        .select()
        .from(schema.campaigns)
        .where(and(...conditions))
        .orderBy(desc(schema.campaigns.createdAt))
        .limit(limit)
        .offset(offset);

      const [countResult] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.campaigns)
        .where(and(...conditions));

      return res.json({
        success: true,
        data: {
          campaigns: campaignsList,
          total: countResult?.total || 0,
          limit,
          offset,
        },
      });
    } catch (error: any) {
      console.error("REST API - List campaigns error:", error);
      return res.status(500).json({ success: false, error: "Failed to list campaigns" });
    }
  });

  app.get("/api/v1/account", requireApiKey, requirePermission("account.read"), async (req: Request, res: Response) => {
    try {
      const { userId, channelId, apiKeyId } = req.apiUser!;

      let channelInfo = null;
      if (channelId) {
        const [ch] = await db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).limit(1);
        if (ch) {
          channelInfo = {
            id: ch.id,
            name: ch.name,
            phoneNumber: ch.phoneNumber,
            isActive: ch.isActive,
            healthStatus: ch.healthStatus,
          };
        }
      }

      const [apiKeyInfo] = await db
        .select({
          requestCount: schema.clientApiKeys.requestCount,
          monthlyRequestCount: schema.clientApiKeys.monthlyRequestCount,
          monthlyResetAt: schema.clientApiKeys.monthlyResetAt,
          lastUsedAt: schema.clientApiKeys.lastUsedAt,
        })
        .from(schema.clientApiKeys)
        .where(eq(schema.clientApiKeys.id, apiKeyId))
        .limit(1);

      return res.json({
        success: true,
        data: {
          userId,
          channel: channelInfo,
          usage: apiKeyInfo || null,
        },
      });
    } catch (error: any) {
      console.error("REST API - Account info error:", error);
      return res.status(500).json({ success: false, error: "Failed to get account info" });
    }
  });

  app.get("/api/v1/account/usage", requireApiKey, requirePermission("account.read"), async (req: Request, res: Response) => {
    try {
      const { apiKeyId } = req.apiUser!;

      const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const last7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const [usage24h] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.clientApiUsageLogs)
        .where(and(eq(schema.clientApiUsageLogs.apiKeyId, apiKeyId), gt(schema.clientApiUsageLogs.createdAt, last24h)));

      const [usage7d] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.clientApiUsageLogs)
        .where(and(eq(schema.clientApiUsageLogs.apiKeyId, apiKeyId), gt(schema.clientApiUsageLogs.createdAt, last7d)));

      const [totalUsage] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.clientApiUsageLogs)
        .where(eq(schema.clientApiUsageLogs.apiKeyId, apiKeyId));

      const recentLogs = await db
        .select({
          endpoint: schema.clientApiUsageLogs.endpoint,
          method: schema.clientApiUsageLogs.method,
          statusCode: schema.clientApiUsageLogs.statusCode,
          responseTime: schema.clientApiUsageLogs.responseTime,
          createdAt: schema.clientApiUsageLogs.createdAt,
        })
        .from(schema.clientApiUsageLogs)
        .where(eq(schema.clientApiUsageLogs.apiKeyId, apiKeyId))
        .orderBy(desc(schema.clientApiUsageLogs.createdAt))
        .limit(20);

      return res.json({
        success: true,
        data: {
          last24Hours: usage24h?.count || 0,
          last7Days: usage7d?.count || 0,
          total: totalUsage?.count || 0,
          recentRequests: recentLogs,
        },
      });
    } catch (error: any) {
      console.error("REST API - Usage breakdown error:", error);
      return res.status(500).json({ success: false, error: "Failed to get usage breakdown" });
    }
  });

  app.get("/api/v1/webhooks", requireApiKey, requirePermission("webhooks.manage"), async (req: Request, res: Response) => {
    try {
      const { userId } = req.apiUser!;

      const webhooks = await db
        .select()
        .from(schema.clientWebhooks)
        .where(eq(schema.clientWebhooks.userId, userId))
        .orderBy(desc(schema.clientWebhooks.createdAt));

      return res.json({ success: true, data: webhooks });
    } catch (error: any) {
      console.error("REST API - List webhooks error:", error);
      return res.status(500).json({ success: false, error: "Failed to list webhooks" });
    }
  });

  app.post("/api/v1/webhooks", requireApiKey, requirePermission("webhooks.manage"), async (req: Request, res: Response) => {
    try {
      const { userId, channelId } = req.apiUser!;
      const { url, events } = req.body;

      if (!url) {
        return res.status(400).json({ success: false, error: "URL is required" });
      }

      if (!events || !Array.isArray(events) || events.length === 0) {
        return res.status(400).json({ success: false, error: "At least one event is required" });
      }

      const webhookSecret = crypto.randomBytes(32).toString("hex");

      const [webhook] = await db
        .insert(schema.clientWebhooks)
        .values({
          userId,
          channelId: channelId || null,
          url,
          secret: webhookSecret,
          events,
          isActive: true,
        })
        .returning();

      return res.status(201).json({
        success: true,
        data: {
          ...webhook,
          secret: webhookSecret,
          note: "Store the webhook secret securely for signature verification.",
        },
      });
    } catch (error: any) {
      console.error("REST API - Create webhook error:", error);
      return res.status(500).json({ success: false, error: "Failed to create webhook" });
    }
  });

  app.put("/api/v1/webhooks/:id", requireApiKey, requirePermission("webhooks.manage"), async (req: Request, res: Response) => {
    try {
      const { userId } = req.apiUser!;
      const { id } = req.params;
      const { url, events, isActive } = req.body;

      const [existing] = await db
        .select()
        .from(schema.clientWebhooks)
        .where(and(eq(schema.clientWebhooks.id, id), eq(schema.clientWebhooks.userId, userId)))
        .limit(1);

      if (!existing) {
        return res.status(404).json({ success: false, error: "Webhook not found" });
      }

      const updateData: any = { updatedAt: new Date() };
      if (url !== undefined) updateData.url = url;
      if (events !== undefined) updateData.events = events;
      if (isActive !== undefined) updateData.isActive = isActive;

      const [updated] = await db
        .update(schema.clientWebhooks)
        .set(updateData)
        .where(eq(schema.clientWebhooks.id, id))
        .returning();

      return res.json({ success: true, data: updated });
    } catch (error: any) {
      console.error("REST API - Update webhook error:", error);
      return res.status(500).json({ success: false, error: "Failed to update webhook" });
    }
  });

  app.delete("/api/v1/webhooks/:id", requireApiKey, requirePermission("webhooks.manage"), async (req: Request, res: Response) => {
    try {
      const { userId } = req.apiUser!;
      const { id } = req.params;

      const [existing] = await db
        .select()
        .from(schema.clientWebhooks)
        .where(and(eq(schema.clientWebhooks.id, id), eq(schema.clientWebhooks.userId, userId)))
        .limit(1);

      if (!existing) {
        return res.status(404).json({ success: false, error: "Webhook not found" });
      }

      await db.delete(schema.clientWebhooks).where(eq(schema.clientWebhooks.id, id));

      return res.json({ success: true, data: { message: "Webhook deleted successfully" } });
    } catch (error: any) {
      console.error("REST API - Delete webhook error:", error);
      return res.status(500).json({ success: false, error: "Failed to delete webhook" });
    }
  });
}
