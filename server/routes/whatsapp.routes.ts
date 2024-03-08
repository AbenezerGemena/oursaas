import type { Express } from "express";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import { storage } from "../storage";
import { insertWhatsappChannelSchema } from "@shared/schema";
import { WhatsAppApiService } from "../services/whatsapp-api";
import { channelHealthMonitor } from "server/cron/channel-health-monitor";
import { handleDigitalOceanUpload, upload } from "../middlewares/upload.middleware";
import fs from "fs";

export function registerWhatsAppRoutes(app: Express) {
  
  app.get("/api/whatsapp/channels", async (req, res) => {
    try {
      const channels = await storage.getActiveChannel();
      res.json(channels);
    } catch (error) {
      console.error("Error fetching WhatsApp channels:", error);
      res.status(500).json({ message: "Failed to fetch WhatsApp channels" });
    }
  });

  
  app.get("/api/whatsapp/channels/:id", async (req, res) => {
    try {
      const channel = await storage.getWhatsappChannel(req.params.id);
      if (!channel) {
        return res.status(404).json({ message: "WhatsApp channel not found" });
      }
      res.json(channel);
    } catch (error) {
      console.error("Error fetching WhatsApp channel:", error);
      res.status(500).json({ message: "Failed to fetch WhatsApp channel" });
    }
  });

  
  app.post("/api/whatsapp/channels", async (req, res) => {
    try {
      const data = insertWhatsappChannelSchema.parse(req.body);
      const channel = await storage.createWhatsappChannel(data);
      res.status(201).json(channel);
    } catch (error) {
      console.error("Error creating WhatsApp channel:", error);
      res.status(500).json({ message: "Failed to create WhatsApp channel" });
    }
  });

  
  app.put("/api/whatsapp/channels/:id", async (req, res) => {
    try {
      const channel = await storage.updateWhatsappChannel(req.params.id, req.body);
      if (!channel) {
        return res.status(404).json({ message: "WhatsApp channel not found" });
      }
      res.json(channel);
    } catch (error) {
      console.error("Error updating WhatsApp channel:", error);
      res.status(500).json({ message: "Failed to update WhatsApp channel" });
    }
  });

  
  app.delete("/api/whatsapp/channels/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteChannel(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "WhatsApp channel not found" });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting WhatsApp channel:", error);
      res.status(500).json({ message: "Failed to delete WhatsApp channel" });
    }
  });

  
  
  

  

  
  
  
  
  
      
  
  
  
  

  
      

  

  
  

  

  
  
  
  
  
  
  
  
  
  
  

  

  
        
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
      
  
  
  

  
  
  
        
  
  
  
        
  
  
  
  
  
  
  
  
  
  
        
  

        
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
        
  
  
  
  
  
  
  
  
  
        
  
  

  
  
  
  
  
        
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  

app.post("/api/whatsapp/channels/:id/send", async (req, res) => {
  try {
    console.log("🚀 SEND MESSAGE REQUEST");
    console.log("📝 Req params.id:", req.params.id);
    console.log("📦 Req body:", JSON.stringify(req.body, null, 2));

    const channel = await storage.getChannel(req.params.id);
    if (!channel) {
      return res.status(404).json({ message: "Channel not found" });
    }

    if (!channel.phoneNumberId || !channel.accessToken) {
      return res.status(400).json({
        message: "Channel is not configured for WhatsApp",
      });
    }

    const {
      to,
      type,
      message,
      templateName,
      templateLanguage = "en_US",
      templateVariables = [],
      headerMediaId,
      headerType,
    } = req.body;

    console.log("🖼️ Header Media ID from request:", headerMediaId);

    const whatsappApi = new WhatsAppApiService(channel);

    let payload: any;
    let newMsg: string | null = null;

    
if (type === "template") {
  if (!templateName) {
    return res.status(400).json({
      success: false,
      message: "Template name is required",
    });
  }

  
  const contact =
    (await storage.searchContacts(to)).find((c) => c.phone === to) ||
    (await storage.createContact({
      name: to,
      phone: to,
      email: "",
      channelId: channel.id,
      status: "active",
    }));

  const components: any[] = [];

  
  if (headerMediaId && headerType == 'video') {
    components.push({
      type: "header",
      parameters: [
        {
          type: "video",
          video: { id: headerMediaId },
        },
      ],
    });
  }

   if (headerMediaId && headerType == 'image') {
    components.push({
      type: "header",
      parameters: [
        {
          type: "image",
          image: { id: headerMediaId },
        },
      ],
    });
  }

  
  let resolvedParams: any[] = [];

  if (Array.isArray(templateVariables) && templateVariables.length > 0) {
    resolvedParams = templateVariables.map(
      (v: { type: string; value?: string }) => {
        let text = "";

        if (v.type === "fullName") text = contact.name;
        else if (v.type === "phone") text = contact.phone;
        else if (v.type === "custom") text = v.value || "";

        return {
          type: "text",
          text,
        };
      }
    );

    
    if (resolvedParams.some((p) => !p.text.trim())) {
      return res.status(400).json({
        success: false,
        message: "Template variables resolved to empty values",
      });
    }

    components.push({
      type: "body",
      parameters: resolvedParams,
    });
  }

  payload = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: templateLanguage },
      ...(components.length > 0 && { components }),
    },
  };

  
  newMsg =
    resolvedParams.length > 0
      ? resolvedParams.map((p) => p.text).join(" ")
      : templateName;
}

    
    else {
      payload = {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: {
          body: message,
        },
      };
      newMsg = message;
    }

    console.log(
      "📤 FINAL WHATSAPP PAYLOAD:",
      JSON.stringify(payload, null, 2)
    );

    
    const result = await whatsappApi.sendDirectMessage(payload);

    if (!result || !result.messages) {
      console.error("❌ WhatsApp API error:", result);
      return res.status(400).json({
        success: false,
        message: "Failed to send message",
      });
    }

    console.log("✅ WhatsApp message sent:", result);

    const messageId = result.messages?.[0]?.id;

    
    let contact =
      (await storage.searchContacts(to)).find((c) => c.phone === to) ||
      (await storage.createContact({
        name: to,
        phone: to,
        email: "",
        channelId: channel.id,
        status: "active",
      }));

    
    let conversation = await storage.getConversationByPhone(to);

    if (!conversation) {
      conversation = await storage.createConversation({
        channelId: channel.id,
        contactId: contact.id,
        contactPhone: to,
        contactName: contact.name,
        status: "active",
        lastMessageAt: new Date(),
        lastMessageText: newMsg,
      });
    }

    await storage.createMessage({
      conversationId: conversation.id,
      content: newMsg,
      direction: "outgoing",
      type,
      status: "sent",
      whatsappMessageId: messageId,
    });

    await storage.updateConversation(conversation.id, {
      lastMessageAt: new Date(),
      lastMessageText: newMsg,
    });

    return res.json({
      success: true,
      messageId,
      message: "Message sent successfully",
    });
  } catch (error: any) {
    console.error("❌ Error sending WhatsApp message:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to send WhatsApp message",
    });
  }
});

app.get(
  "/api/whatsapp/templates/:templateId/meta",
  async (req, res) => {
    try {
      const { templateId } = req.params;
      const channelId = req.query.channelId as string;

      const channel = await storage.getChannel(channelId);
      if (!channel) {
        return res.status(404).json({ message: "Channel not found" });
      }

      const response = await fetch(
        `https://graph.facebook.com/v24.0/${templateId}`,
        {
          headers: {
            Authorization: `Bearer ${channel.accessToken}`,
          },
        }
      );

      const meta = await response.json();

      
      let headerType: string | null = null;
      let bodyText = "";
      let bodyVariables = 0;

      let hasLimitedTimeOffer = false;

      for (const c of meta.components || []) {
        if (c.type === "HEADER") {
          headerType = c.format; 
        }

        if (c.type === "BODY") {
          bodyText = c.text || "";
          bodyVariables =
            (bodyText.match(/\{\{\d+\}\}/g) || []).length;
        }

        if (c.type === "LIMITED_TIME_OFFER") {
          hasLimitedTimeOffer = true;
        }
      }

      return res.json({
        id: meta.id,
        name: meta.name,
        headerType,
        hasLimitedTimeOffer,
        body: bodyText,
        bodyVariables,
        language: meta.language,
        status: meta.status,
        category: meta.category,
      });
    } catch (err) {
      console.error("Template meta error:", err);
      res.status(500).json({ message: "Failed to fetch template meta" });
    }
  }
);

app.post(
  "/api/whatsapp/channels/:id/upload-image",
  upload.fields([{ name: "mediaFile", maxCount: 1 }]),
  async (req, res) => {
    try {
      console.log("📥 Upload image request");

      const channelId = req.params.id;
      const { templateId } = req.body; 

      if (!templateId) {
        return res.status(400).json({
          message: "templateId is required in body",
        });
      }

      const channel = await storage.getChannel(channelId);
      if (!channel) {
        return res.status(404).json({ message: "Channel not found" });
      }

      if (!channel.phoneNumberId || !channel.accessToken) {
        return res.status(400).json({
          message: "Channel is not configured for WhatsApp",
        });
      }

      const mediaFile = Array.isArray(req.files?.mediaFile)
        ? req.files.mediaFile[0]
        : null;

      if (!mediaFile) {
        return res.status(400).json({
          message: "mediaFile (image) is required",
        });
      }

      const buffer = fs.readFileSync(mediaFile.path);

      const whatsappApi = new WhatsAppApiService(channel);

      const mediaId = await whatsappApi.uploadMediaBufferHeader(
        buffer,
        mediaFile.mimetype,
        mediaFile.originalname
      );

      fs.unlinkSync(mediaFile.path);

      
      await storage.updateTemplate(templateId, {
        mediaUrl: mediaId,
        mediaType: "image",
      });

      return res.json({
        success: true,
        mediaId,
        message: "Image uploaded and saved to template successfully",
      });
    } catch (error: any) {
      console.error("❌ Image upload error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to upload image",
      });
    }
  }
);

app.post(
  "/api/whatsapp/channels/:id/upload-media",
  upload.fields([{ name: "mediaFile", maxCount: 1 }]),
  async (req, res) => {
    try {
      const user = (req as any).session?.user;
      if (!user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const channelId = req.params.id;
      const channel = await storage.getChannel(channelId);
      if (!channel) {
        return res.status(404).json({ message: "Channel not found" });
      }

      if (user.role !== "superadmin") {
        const ownerId = user.role === "team" ? user.createdBy : user.id;
        if (channel.createdBy !== ownerId) {
          return res.status(403).json({ message: "Not authorized for this channel" });
        }
      }

      if (!channel.phoneNumberId || !channel.accessToken) {
        return res.status(400).json({ message: "Channel is not configured for WhatsApp" });
      }

      const mediaFile = Array.isArray(req.files?.mediaFile)
        ? req.files.mediaFile[0]
        : null;

      if (!mediaFile) {
        return res.status(400).json({ message: "mediaFile is required" });
      }

      const maxSizes: Record<string, number> = {
        image: 5 * 1024 * 1024,
        video: 16 * 1024 * 1024,
        audio: 16 * 1024 * 1024,
        document: 100 * 1024 * 1024,
      };
      const mediaType = req.body.mediaType || "image";
      const maxSize = maxSizes[mediaType] || 16 * 1024 * 1024;
      if (mediaFile.size > maxSize) {
        fs.unlinkSync(mediaFile.path);
        return res.status(400).json({ message: `File too large. Max ${Math.round(maxSize / 1024 / 1024)}MB for ${mediaType}` });
      }

      const buffer = fs.readFileSync(mediaFile.path);
      const whatsappApi = new WhatsAppApiService(channel);
      const mediaId = await whatsappApi.uploadMediaBuffer(buffer, mediaFile.mimetype, mediaFile.originalname);
      fs.unlinkSync(mediaFile.path);

      return res.json({ success: true, mediaId });
    } catch (error: any) {
      console.error("Media upload error:", error);
      return res.status(500).json({ success: false, message: error.message || "Failed to upload media" });
    }
  }
);

app.post(
  "/api/whatsapp/channels/:id/upload-imageOLLd",
  upload.fields([{ name: "mediaFile", maxCount: 1 }]),
  async (req, res) => {
    try {
      console.log("📥 Upload image request");

      const channel = await storage.getChannel(req.params.id);
      if (!channel) {
        return res.status(404).json({ message: "Channel not found" });
      }

      if (!channel.phoneNumberId || !channel.accessToken) {
        return res.status(400).json({
          message: "Channel is not configured for WhatsApp",
        });
      }

      
      const mediaFile =
        Array.isArray(req.files?.mediaFile)
          ? req.files.mediaFile[0]
          : null;

      if (!mediaFile) {
        return res.status(400).json({
          message: "mediaFile (image) is required",
        });
      }

      console.log("📁 Image:", mediaFile.originalname);

      const buffer = fs.readFileSync(mediaFile.path);

      const whatsappApi = new WhatsAppApiService(channel);

      
      const mediaId = await whatsappApi.uploadMediaBufferHeader(
        buffer,
        mediaFile.mimetype,
        mediaFile.originalname
      );

      
      fs.unlinkSync(mediaFile.path);

      return res.json({
        success: true,
        mediaId, 
        message: "Image uploaded successfully",
      });
    } catch (error: any) {
      console.error("❌ Image upload error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to upload image",
      });
    }
  }
);

  
  app.post("/api/whatsapp/channels/:id/test", async (req, res) => {
    try {
      const channel = await storage.getChannel(req.params.id);
      if (!channel) {
        return res.status(404).json({ message: "Channel not found" });
      }
      
      if (!channel.phoneNumberId || !channel.accessToken) {
        return res.status(400).json({ message: "Channel is not configured for WhatsApp" });
      }

      let testPhone = (req.body.phoneNumber || "919310797700").replace(/\D/g, '');
      const testMessage = req.body.message || "Hello! This is a test message from OurSaas.";

      const apiVersion = process.env.WHATSAPP_API_VERSION || "v24.0";

      const requestBody = {
        messaging_product: "whatsapp",
        to: testPhone,
        type: "text",
        text: { body: testMessage },
      };

      const startTime = Date.now();
      const response = await fetch(
        `https://graph.facebook.com/${apiVersion}/${channel.phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${channel.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        }
      );

      const result = await response.json();
      const duration = Date.now() - startTime;

      await storage.createApiLog({
        channelId: channel.id,
        requestType: "test_connection",
        endpoint: `https://graph.facebook.com/${apiVersion}/${channel.phoneNumberId}/messages`,
        method: "POST",
        requestBody,
        responseStatus: response.status,
        responseBody: result,
        duration,
      });

      if (!response.ok) {
        const errorMsg = result.error?.error_user_msg || result.error?.message || "Failed to send test message";
        return res.status(response.status).json({ message: errorMsg });
      }

      res.json({ success: true, message: "Test message sent successfully", result });
    } catch (error: any) {
      console.error("Error testing WhatsApp connection:", error);
      res.status(500).json({ message: error.message || "Failed to test WhatsApp connection" });
    }
  });

  
  
  
  
  
  
  

  
      
  
  
  
  
  
  
  

  
  
  
  
  
  

  
  app.get("/api/whatsapp/api-logs", async (req, res) => {
    try {
      const channelId = req.query.channelId as string | undefined;
      const limit = parseInt(req.query.limit as string) || 100;
  
      if (!channelId) {
        return res.status(400).json({ message: "Missing required query parameter: channelId" });
      }
  
      const logs = await storage.getApiLogs(channelId, limit);
      res.json(logs);
    } catch (error) {
      console.error("Error fetching API logs:", error);
      res.status(500).json({ message: "Failed to fetch API logs" });
    }
  });  
}
