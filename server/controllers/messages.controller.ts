import type { Request, Response } from 'express';
import { OurSaasError, asyncHandler as _dHandler, oursaasLogger, HTTP_STATUS } from "@oursaas/core";
import { storage } from '../storage';
import { insertMessageSchema} from '@shared/schema';
import { AppError, asyncHandler } from '../middlewares/error.middleware';
import { WhatsAppApiService } from '../services/whatsapp-api';
import type { RequestWithChannel } from '../middlewares/channel.middleware';
import { triggerService } from "../services/automation-execution-service";

export const getMessages = asyncHandler(async (req: Request, res: Response) => {
  const { conversationId } = req.params;
  const messages = await storage.getMessages(conversationId);

  await storage.updateConversation(conversationId, {
    unreadCount:null
  });
  res.json(messages);
});

  

export const createMessage = asyncHandler(async (req: Request, res: Response) => {
  const { conversationId } = req.params;
  const { content, fromUser, caption, templateName, parameters } = req.body;
  const file = (req as any).file as Express.Multer.File & { cloudUrl?: string };

  const conversation = await storage.getConversation(conversationId);
  if (!conversation) throw new AppError(404, "Conversation not found");

  let msgBody = content;
  let messageType: string = "text";
  let result: any = null;
  let mediaId: string | null = null;
  let mediaUrl: string | null = null;
  let messageStatus: "sent" | "failed" = "sent";

  if (fromUser) {
    if (!conversation.channelId) throw new Error("ChannelId is missing");
    if (!conversation.contactPhone) throw new Error("Contact phone is missing");

    const channel = await storage.getChannel(conversation.channelId);
    if (!channel) throw new AppError(404, "Channel not found");

    const whatsappApi = new WhatsAppApiService(channel);

    const lastIncoming = (conversation as any).lastIncomingMessageAt
      ? new Date((conversation as any).lastIncomingMessageAt).getTime()
      : conversation.lastMessageAt
      ? new Date(conversation.lastMessageAt).getTime()
      : 0;
    const is24HourExpired = lastIncoming > 0 && (Date.now() - lastIncoming > 24 * 60 * 60 * 1000);

    try {
      
      if (templateName) {
        const templateMatch = await storage.getTemplateByNameAndChannel(templateName, conversation.channelId)
          || (await storage.getTemplatesByName(templateName))[0];
        msgBody = templateMatch?.body || `[template: ${templateName}]`;
        messageType = "template";

        try {
          result = await whatsappApi.sendMessage(conversation.contactPhone, templateName, parameters || []);
        } catch (templateErr: any) {
          console.error("❌ Template send failed (payment/billing or other):", templateErr.message);
          messageStatus = "failed";

          const errorInfo: any = {
            title: templateErr.metaErrorTitle || "Template send failed",
            message: templateErr.message || "Failed to send template via WhatsApp",
            code: templateErr.metaErrorCode || null,
            errorData: templateErr.metaErrorDetails ? { details: templateErr.metaErrorDetails } : null,
          };

          const failedMessage = await storage.createMessage({
            conversationId,
            fromUser: true,
            direction: "outbound",
            content: msgBody,
            status: "failed",
            messageType,
            type: messageType,
            timestamp: new Date(),
            errorDetails: errorInfo,
            metadata: {},
          });

          await storage.updateConversation(conversationId, {
            lastMessageAt: new Date(),
            lastMessageText: msgBody,
          });

          if ((global as any).broadcastToConversation) {
            (global as any).broadcastToConversation(conversationId, {
              type: "new-message",
              message: failedMessage,
            });
          }

          return res.json(failedMessage);
        }

      
      } else if (file) {
        if (is24HourExpired) {
          throw new AppError(403, "24-hour messaging window has expired. Please use an approved template message instead.");
        }
        const mimeType = file.mimetype;
        const fs = await import('fs');
        const filePath = file.path;

        console.log(`📤 Processing media for WhatsApp from disk: ${filePath}`);

        let buffer: Buffer;
        if (filePath && fs.existsSync(filePath)) {
          buffer = fs.readFileSync(filePath);
        } else if ((file as any).cloudUrl) {
          console.log(`📤 File not on disk, downloading from cloud: ${(file as any).cloudUrl}`);
          const dlResponse = await fetch((file as any).cloudUrl);
          if (!dlResponse.ok) throw new AppError(400, "Failed to download uploaded file from cloud storage");
          buffer = Buffer.from(await dlResponse.arrayBuffer());
        } else if (file.buffer) {
          buffer = file.buffer;
        } else {
          throw new AppError(400, "Uploaded file not found on disk or cloud");
        }

        console.log("📄 Uploading media:", {
  name: file.originalname,
  mimeType: mimeType,
  size: file.size
});

const SUPPORTED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "audio/ogg",
  "audio/mpeg",
  "application/pdf"
];
if (!SUPPORTED_MIME_TYPES.includes(mimeType)) {
  throw new Error(`❌ File type not supported: ${mimeType}`);
}

const MAX_SIZE_MB = mimeType.startsWith("video") ? 16 : 5;
if (file.size > MAX_SIZE_MB * 1024 * 1024) {
  throw new Error(`❌ ${file.originalname} exceeds WhatsApp size limit (${MAX_SIZE_MB}MB).`);
}

        
        mediaId = await whatsappApi.uploadMediaBuffer(buffer, mimeType, file.originalname);
        console.log("✅ Media uploaded to WhatsApp, ID:", mediaId);

        
        try {
          mediaUrl = await whatsappApi.getMediaUrl(mediaId);
          console.log("🌐 WhatsApp media URL:", mediaUrl);
        } catch (err) {
          console.warn("⚠️ Failed to get WhatsApp media URL, using local path instead");
          mediaUrl = (file as any).cloudUrl || `/uploads/${file.filename || file.originalname}`;
        }

        
        if (mimeType.startsWith("image")) messageType = "image";
        else if (mimeType.startsWith("video")) messageType = "video";
        else if (mimeType.startsWith("audio")) messageType = "audio";
        else messageType = "document";

        
        result = await whatsappApi.sendMediaMessagee(
          conversation.contactPhone,
          mediaId,
          messageType as any,
          caption || content
        );
        msgBody = caption || `[${messageType}]`;

      
      } else {
        if (is24HourExpired) {
          throw new AppError(403, "24-hour messaging window has expired. Please use an approved template message instead.");
        }
        try {
          result = await whatsappApi.sendTextMessage(conversation.contactPhone, content);
        } catch (err: any) {
          console.warn("❌ WhatsApp send failed:", err.message || err);
          messageStatus = "failed";
        }
        msgBody = content;
        messageType = "text";
      }

      
      const message = await storage.createMessage({
        conversationId,
        fromUser: true,
        direction: "outbound",
        content: msgBody,
        status: messageStatus,
        whatsappMessageId: result?.messages?.[0]?.id,
        messageType,
        type: messageType,
        timestamp: new Date(),
        mediaId: mediaId || undefined,
        mediaUrl: mediaUrl || file?.cloudUrl || undefined,
        mediaMimeType: file?.mimetype || undefined,
        metadata: file
          ? {
              mimeType: file.mimetype,
              originalName: file.originalname,
              cloudUrl: file.cloudUrl,
              isCloud: !!file.cloudUrl,
              fileSize: file.size,
            }
          : {}
      });

      await storage.updateConversation(conversationId, {
        lastMessageAt: new Date(),
        lastMessageText: msgBody
      });

      if ((global as any).broadcastToConversation) {
        (global as any).broadcastToConversation(conversationId, {
          type: "new-message",
          message
        });
      }

      return res.json(message);

    } catch (error) {
      console.error("❌ Error sending WhatsApp message:", error);
      throw new AppError(500, error instanceof Error ? error.message : "Failed to send message");
    }

  } else {
    
    const validatedMessage = insertMessageSchema.parse({
      ...req.body,
      conversationId
    });

    const message = await storage.createMessage(validatedMessage);
    await storage.updateConversation(conversationId, {
      lastMessageAt: new Date(),
      lastMessageText: msgBody
    });

    if ((global as any).broadcastToConversation) {
      (global as any).broadcastToConversation(conversationId, {
        type: "new-message",
        message
      });
    }

    return res.json(message);
  }
});

export const createMessagennn = asyncHandler(async (req: Request, res: Response) => {
  const { conversationId } = req.params;
  const { content, fromUser, caption, templateName, parameters } = req.body;
  const file = (req as any).file as Express.Multer.File & { cloudUrl?: string };

  
  const conversation = await storage.getConversation(conversationId);
  if (!conversation) throw new AppError(404, "Conversation not found");

  let msgBody = content || "";
  let messageType: "text" | "image" | "video" | "audio" | "document" | "template" = "text";
  let result: any = null;
  let mediaId: string | null = null;
  let mediaUrl: string | null = null;
  let messageStatus: "sent" | "failed" = "sent";

  
  if (fromUser) {
    if (!conversation.channelId) throw new Error("ChannelId is missing");
    if (!conversation.contactPhone) throw new Error("Contact phone is missing");

    const channel = await storage.getChannel(conversation.channelId);
    if (!channel) throw new AppError(404, "Channel not found");

    const whatsappApi = new WhatsAppApiService(channel);

    try {
      if (templateName) {
        
        result = await whatsappApi.sendMessage(conversation.contactPhone, templateName, parameters || []);
        const newMsg = await storage.getTemplatesByName(templateName);
        msgBody = newMsg[0]?.body || `[template: ${templateName}]`;
        messageType = "template";
      } else if (file) {
        const mimeType = file.mimetype;

        
        const isCloudFile = !!file.cloudUrl;
        const filePath = file.cloudUrl || file.path;

        console.log(`📤 Processing media: ${isCloudFile ? "Cloud" : "Local"}`);
        console.log(`   File location: ${filePath}`);
        console.log(`   MIME type: ${mimeType}`);

        
        try {
          if (isCloudFile) {
            
            console.log("⬇️ Downloading from cloud for WhatsApp upload...");
            const response = await fetch(file.cloudUrl!);
            const buffer = Buffer.from(await response.arrayBuffer());
            mediaId = await whatsappApi.uploadMediaBuffer(buffer, mimeType, file.originalname);
            console.log("✅ Media uploaded to WhatsApp, ID:", mediaId);
          } else {
            
            console.log("📁 Uploading local file to WhatsApp...");
            mediaId = await whatsappApi.uploadMedia(file.path, mimeType);
            console.log("✅ Media uploaded to WhatsApp, ID:", mediaId);
          }

          
          try {
            mediaUrl = await whatsappApi.getMediaUrl(mediaId!);
            console.log("🌐 WhatsApp media URL retrieved:", mediaUrl);
          } catch (err) {
            console.warn("⚠️ Failed to get WhatsApp media URL, using fallback:", err);
            
            const host = process.env.SERVER_HOST || "http://localhost:3000";
            mediaUrl = file.cloudUrl ? file.cloudUrl : `${host}/uploads/${path.basename(path.dirname(file.path))}/${file.filename}`;
          }

          
          if (mimeType.startsWith("image")) messageType = "image";
          else if (mimeType.startsWith("video")) messageType = "video";
          else if (mimeType.startsWith("audio")) messageType = "audio";
          else messageType = "document";

          
          if (!mediaId) throw new AppError(500, "Media upload failed, cannot send message");

          result = await whatsappApi.sendMediaMessage(
            conversation.contactPhone,
            mediaId,
            messageType,
            caption || content || `[${messageType}]`
          );
          msgBody = caption || `[${messageType}]`;

        } catch (err: any) {
          console.error("❌ WhatsApp send failed:", err.message || err);
          messageStatus = "failed";
          msgBody = `[${messageType}] Media not sent`;
        }

      } else {
        
        try {
          result = await whatsappApi.sendTextMessage(conversation.contactPhone, content || "[No Content]");
        } catch (err: any) {
          console.warn("❌ WhatsApp send failed:", err.message || err);
          messageStatus = "failed";
          msgBody = "[Failed to send text message]";
        }
        messageType = "text";
      }

      
      const message = await storage.createMessage({
        conversationId,
        fromUser: true,
        direction: "outbound",
        content: msgBody,
        status: messageStatus,
        whatsappMessageId: result?.messages?.[0]?.id,
        messageType,
        type: messageType,
        timestamp: new Date(),
        mediaId: mediaId || undefined,
        mediaUrl: mediaUrl || file?.cloudUrl || undefined,
        mediaMimeType: file?.mimetype || undefined,
        metadata: file
          ? {
              mimeType: file.mimetype,
              originalName: file.originalname,
              cloudUrl: file.cloudUrl,
              isCloud: !!file.cloudUrl,
              fileSize: file.size,
            }
          : {},
      });

      await storage.updateConversation(conversationId, {
        lastMessageAt: new Date(),
        lastMessageText: msgBody,
      });

      if ((global as any).broadcastToConversation) {
        (global as any).broadcastToConversation(conversationId, {
          type: "new-message",
          message,
        });
      }

      return res.json(message);

    } catch (error: any) {
      console.error("❌ Error sending WhatsApp message:", error);
      throw new AppError(500, error.message || "Failed to send message");
    }

  } else {
    
    const validatedMessage = insertMessageSchema.parse({ ...req.body, conversationId });

    const message = await storage.createMessage(validatedMessage);

    try {
      if (!conversation.channelId) throw new Error("ChannelId is missing");
      if (!conversation.contactId) throw new Error("contactId is missing");

      await triggerService.handleMessageReceived(
        conversationId,
        message,
        conversation.channelId,
        conversation.contactId
      );
      console.log(`✅ Triggered automations for message: ${message.id}`);
    } catch (error) {
      console.error("❌ Failed to trigger message automations:", error);
    }

    await storage.updateConversation(conversationId, {
      lastMessageAt: new Date(),
      lastMessageText: msgBody,
    });

    if ((global as any).broadcastToConversation) {
      (global as any).broadcastToConversation(conversationId, {
        type: "new-message",
        message,
      });
    }

    return res.json(message);
  }
});

export const createMessageOld = asyncHandler(async (req: Request, res: Response) => {
  const { conversationId } = req.params;
  const { content, fromUser, caption, templateName, parameters } = req.body;
  const file = (req as any).file as Express.Multer.File & { cloudUrl?: string };

  
  const conversation = await storage.getConversation(conversationId);
  if (!conversation) throw new AppError(404, "Conversation not found");

  let msgBody = content;
  let messageType = "text";
  let result: any = null;
  let mediaId: string | null = null;
  let mediaUrl: string | null = null;

let messageStatus: "sent" | "failed" = "sent";
  

  
  if (fromUser) {
    if (!conversation.channelId) throw new Error("ChannelId is missing");
    if (!conversation.contactPhone) throw new Error("Contact phone is missing");

    const channel = await storage.getChannel(conversation.channelId);
    if (!channel) throw new AppError(404, "Channel not found");

    const whatsappApi = new WhatsAppApiService(channel);

    try {
      if (templateName) {
        
        result = await whatsappApi.sendMessage(conversation.contactPhone, templateName, parameters || []);
        const newMsg = await storage.getTemplatesByName(templateName);
        msgBody = newMsg[0]?.body || `[template: ${templateName}]`;
        messageType = "template";
      } else if (file) {
        
        const mimeType = file.mimetype;
        
        
        const isCloudFile = !!file.cloudUrl;
        const filePath = file.cloudUrl || file.path;
        
        console.log(`📤 Processing media: ${isCloudFile ? 'Cloud' : 'Local'}`);
        console.log(`   File location: ${filePath}`);
        console.log(`   MIME type: ${mimeType}`);
        
        
        
        if (isCloudFile) {
          
          console.log("⬇️ Downloading from cloud for WhatsApp upload...");
          const response = await fetch(file.cloudUrl!);
          const buffer = Buffer.from(await response.arrayBuffer());
          
          
          mediaId = await whatsappApi.uploadMediaBuffer(buffer, mimeType, file.originalname);
          console.log("✅ Media uploaded to WhatsApp, ID:", mediaId);
        } else {
          
          console.log("📁 Uploading local file to WhatsApp...");
          mediaId = await whatsappApi.uploadMedia(file.path, mimeType);
          console.log("✅ Media uploaded to WhatsApp, ID:", mediaId);
        }

        
        try {
          mediaUrl = await whatsappApi.getMediaUrl(mediaId!);
          console.log("🌐 WhatsApp media URL retrieved:", mediaUrl);
        } catch (error) {
          console.warn("⚠️ Failed to get WhatsApp media URL:", error);
          
          mediaUrl = file.cloudUrl || null;
        }

        
        if (mimeType.startsWith("image")) messageType = "image";
        else if (mimeType.startsWith("video")) messageType = "video";
        else if (mimeType.startsWith("audio")) messageType = "audio";
        else messageType = "document";

        
        result = await whatsappApi.sendMediaMessage(
          conversation.contactPhone,
          mediaId!,
          messageType as any,
          caption || content
        );
        msgBody = caption || `[${messageType}]`;
      } else {
        
        
        try {
  result = await whatsappApi.sendTextMessage(conversation.contactPhone, content);
} catch (error: any) {
  console.warn("❌ WhatsApp send failed:", error.message || error);
  messageStatus = "failed"; 
}

        msgBody = content;
        messageType = "text";
      }

      
      const message = await storage.createMessage({
        conversationId,
        fromUser: true,
        direction: "outbound",
        content: msgBody,
        status: "sent",
        whatsappMessageId: result?.messages?.[0]?.id,
        messageType,
        type: messageType,
        timestamp: new Date(),
        mediaId: mediaId || undefined,
        mediaUrl: mediaUrl || file?.cloudUrl || undefined,
        mediaMimeType: file?.mimetype || undefined,
        metadata: file
          ? { 
              mimeType: file.mimetype, 
              originalName: file.originalname,
              cloudUrl: file.cloudUrl,
              isCloud: !!file.cloudUrl,
              fileSize: file.size
            }
          : {}
      });

      await storage.updateConversation(conversationId, {
        lastMessageAt: new Date(),
        lastMessageText: msgBody
      });

      if ((global as any).broadcastToConversation) {
        (global as any).broadcastToConversation(conversationId, {
          type: "new-message",
          message
        });
      }

      return res.json(message);
    } catch (error) {
      console.error("❌ Error sending WhatsApp message:", error);
      throw new AppError(500, error instanceof Error ? error.message : "Failed to send message");
    }
  } else {
    
    const validatedMessage = insertMessageSchema.parse({
      ...req.body,
      conversationId
    });

    const message = await storage.createMessage(validatedMessage);

    try {
      if (!conversation.channelId) throw new Error("ChannelId is missing");
      if (!conversation.contactId) throw new Error("contactId is missing");

      await triggerService.handleMessageReceived(
        conversationId,
        message,
        conversation.channelId,
        conversation.contactId
      );
      console.log(`✅ Triggered automations for message: ${message.id}`);
    } catch (error) {
      console.error("❌ Failed to trigger message automations:", error);
    }

    await storage.updateConversation(conversationId, {
      lastMessageAt: new Date(),
      lastMessageText: msgBody
    });

    if ((global as any).broadcastToConversation) {
      (global as any).broadcastToConversation(conversationId, {
        type: "new-message",
        message
      });
    }

    return res.json(message);
  }
});

export const getMediaById = asyncHandler(async (req: Request, res: Response) => {
  const { messageId } = req.params;

  
  const message = await storage.getMessage(messageId);
  if (!message) {
    throw new AppError(404, "Message not found");
  }

  if (!message.mediaId) {
    throw new AppError(404, "No media found for this message");
  }

  if (!message.conversationId) {
    throw new AppError(400, "Message missing conversationId");
  }

  
  const conversation = await storage.getConversation(message.conversationId);
  if (!conversation || !conversation.channelId) {
    throw new AppError(404, "Conversation or channel not found");
  }

  const channel = await storage.getChannel(conversation.channelId);
  if (!channel) {
    throw new AppError(404, "Channel not found");
  }

  try {
    const whatsappApi = new WhatsAppApiService(channel);
    
    
    let mediaUrl = message.mediaUrl;
    if (!mediaUrl) {
      mediaUrl = await whatsappApi.getMediaUrl(message.mediaId);
      
      
      await storage.updateMessage(messageId, { mediaUrl });
    }

    if (!mediaUrl) {
      throw new AppError(500, "Failed to get media URL from WhatsApp");
    }

    
    const mediaResponse = await fetch(mediaUrl, {
      headers: {
        Authorization: `Bearer ${channel.accessToken}`,
      },
    });

    if (!mediaResponse.ok) {
      throw new AppError(500, "Failed to fetch media from WhatsApp");
    }

    
    const contentType = message.mediaMimeType || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400'); 

    
    const arrayBuffer = await mediaResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    res.send(buffer);
  } catch (error) {
    console.error("Error serving media:", error);
    throw new AppError(500, "Failed to serve media");
  }
});

export const getMediaUrl = asyncHandler(async (req: Request, res: Response) => {
  const { messageId } = req.params;

  const message = await storage.getMessage(messageId);
  if (!message || !message.mediaId) {
    throw new AppError(404, "Message or media not found");
  }

  
  if (message.mediaUrl) {
    return res.json({ url: `/api/media/${messageId}`, whatsappUrl: message.mediaUrl });
  }

  
  if (!message.conversationId) {
    throw new AppError(400, "Message missing conversationId");
  }
  const conversation = await storage.getConversation(message.conversationId);
  const channel = await storage.getChannel(conversation!.channelId!);
  const whatsappApi = new WhatsAppApiService(channel!);

  try {
    const mediaUrl = await whatsappApi.getMediaUrl(message.mediaId);
    
    
    await storage.updateMessage(messageId, { mediaUrl });

    res.json({ 
      url: `/api/media/${messageId}`, 
      whatsappUrl: mediaUrl 
    });
  } catch (error) {
    console.error("Error getting media URL:", error);
    throw new AppError(500, "Failed to get media URL");
  }
});

export const getMediaProxy = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { messageId } = req.query;
    const { download } = req.query;

    console.log("Media proxy hit for messageId:", messageId, "download:", download);
    
    
    if (typeof messageId !== 'string') {
      return res.status(400).json({ error: 'Invalid messageId' });
    }
    const message = await storage.getMessage(messageId);
    if (!message || !message.mediaId) {
      return res.status(404).json({ error: 'Media not found' });
    }

    if (!message.conversationId) {
      return res.status(400).json({ error: 'Message missing conversationId' });
    }

    const conversation = await storage.getConversation(message.conversationId);
    const channel = await storage.getChannel(conversation!.channelId!);
    const whatsappApi = new WhatsAppApiService(channel!);

    console.log("Streaming media for mediaId:", message.mediaId);
    
    
    const contentType = message.mediaMimeType || 'application/octet-stream';
    
    res.set({
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=300',
    });
    
    
    if (download === 'true') {
      const filename = message.metadata || `media_${messageId}`;
      res.set('Content-Disposition', `attachment; filename="${filename}"`);
    }

    
    const success = await whatsappApi.streamMedia(message.mediaId, res);
    
    if (!success) {
      
      const mediaBuffer = await whatsappApi.getMedia(message.mediaId);
      
      if (!mediaBuffer) {
        return res.status(404).json({ error: 'Media not accessible' });
      }
      
      res.set('Content-Length', mediaBuffer.length.toString());
      res.send(mediaBuffer);
    }
    
  } catch (error) {
    console.error('Media proxy error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export const sendMessageOODLL = asyncHandler(async (req: RequestWithChannel, res: Response) => {
  const { to, message, templateName, parameters, channelId: bodyChannelId, caption, type } = req.body;
  const file = (req as any).file; 

  
  let channelId = bodyChannelId;
  if (!channelId) {
    const activeChannel = await storage.getActiveChannel();
    if (!activeChannel) {
      throw new AppError(400, "No active channel found. Please select a channel.");
    }
    channelId = activeChannel.id;
  }

  const channel = await storage.getChannel(channelId);
  if (!channel) throw new AppError(404, "Channel not found");

  const whatsappApi = new WhatsAppApiService(channel);

  let result;
  let msgBody = message;
  let messageType = "text";

  if (templateName) {
    
    result = await whatsappApi.sendMessage(to, templateName, parameters || []);
    const newMsg = await storage.getTemplatesByName(templateName);
    msgBody = newMsg[0].body;
    messageType = "template";
  } else if (file) {
    
    const mimeType = file.mimetype;
    const mediaId = await whatsappApi.uploadMedia(file.path, mimeType);

    
    if (mimeType.startsWith("image")) messageType = "image";
    else if (mimeType.startsWith("video")) messageType = "video";
    else if (mimeType.startsWith("audio")) messageType = "audio";
    else messageType = "document";

    result = await whatsappApi.sendMediaMessage(to, mediaId, messageType as any, caption || message);
    msgBody = caption || `[${messageType}]`;
  } else {
    
    result = await whatsappApi.sendTextMessage(to, message);
    msgBody = message;
    messageType = "text";
  }

  
  let conversation = await storage.getConversationByPhoneAndChannel(to, channelId);
  if (!conversation) {
    let contact = await storage.getContactByPhoneAndChannel(to, channelId);
    if (!contact) {
      contact = await storage.createContact({ name: to, phone: to, channelId });
    }
    conversation = await storage.createConversation({
      contactId: contact.id,
      contactPhone: to,
      contactName: contact.name || to,
      channelId,
      unreadCount: 0
    });
  }

  const createdMessage = await storage.createMessage({
    conversationId: conversation.id,
    content: msgBody,
    fromUser: true,
    direction: "outbound",
    status: "sent",
    whatsappMessageId: result.messages?.[0]?.id,
    messageType: messageType,
    timestamp: new Date(),
    metadata: file ? { mimeType: file.mimetype, originalName: file.originalname } : {}
  });

  await storage.updateConversation(conversation.id, {
    lastMessageAt: new Date(),
    lastMessageText: msgBody,
  });

  if ((global as any).broadcastToConversation) {
    (global as any).broadcastToConversation(conversation.id, {
      type: "new-message",
      message: createdMessage
    });
  }

  res.json({
    success: true,
    messageId: result.messages?.[0]?.id,
    conversationId: conversation.id
  });
});

export const sendMessage = asyncHandler(async (req: RequestWithChannel, res: Response) => {
  console.log("📦 /api/messages/send BODY =>", JSON.stringify(req.body, null, 2));

  const {
    to,
    message,
    templateName,
    parameters,
    buttonParameters,
    cardBodyParameters,
    cardButtonParameters,
    carouselCardMediaIds,
    mediaId,
    channelId: bodyChannelId,
    caption,
    headerType,
    expirationTimeMs
  } = req.body;

  const file = (req as any).file;

  
  let channelId = bodyChannelId;
  if (!channelId) {
    const activeChannel = await storage.getActiveChannel();
    if (!activeChannel) {
      throw new AppError(400, "No active channel found");
    }
    channelId = activeChannel.id;
  }

  const channel = await storage.getChannel(channelId);
  if (!channel) throw new AppError(404, "Channel not found");

  const whatsappApi = new WhatsAppApiService(channel);

  let result: any;
  let msgBody = message || "";
  let messageType: string = "text";

  
  let contact =
    (await storage.getContactByPhoneAndChannel(to, channelId)) ||
    (await storage.createContact({
      name: to,
      phone: to,
      channelId,
    }));

  
  if (templateName) {
    
    const resolvedParams: string[] = [];

    if (Array.isArray(parameters) && parameters.length > 0) {
      for (const p of parameters) {
        let value = "";

        if (p.type === "fullName") value = contact.name || "";
        else if (p.type === "phone") value = contact.phone || "";
        else if (p.type === "custom") value = p.value || "";

        if (!value.trim()) {
          throw new AppError(400, "Template variable resolved to empty value");
        }

        resolvedParams.push(value);
      }
    }

    
    const templateMatch = await storage.getTemplateByNameAndChannel(templateName, channelId)
      || (await storage.getTemplatesByName(templateName))[0];
    if (templateMatch) {
      msgBody = templateMatch.body;
      resolvedParams.forEach((val, i) => {
        msgBody = msgBody.replace(`{{${i + 1}}}`, val);
      });
    } else {
      msgBody = resolvedParams.join(" ");
    }

    messageType = "template";

    try {
      result = await whatsappApi.sendMessage(
        to,
        templateName,
        resolvedParams,
        mediaId,
        headerType,
        Array.isArray(buttonParameters) ? buttonParameters : undefined,
        cardBodyParameters || undefined,
        cardButtonParameters || undefined,
        expirationTimeMs ? Number(expirationTimeMs) : undefined,
        carouselCardMediaIds || undefined
      );
      console.log("✅ Template sent with params:", resolvedParams);
    } catch (err: any) {
      console.error("❌ Template send failed:", err.message);

      const errorInfo: any = {
        title: err.metaErrorTitle || "Template send failed",
        message: err.message || "Failed to send template via WhatsApp",
        code: err.metaErrorCode || null,
        errorData: err.metaErrorDetails ? { details: err.metaErrorDetails } : null,
      };

      let conversation = await storage.getConversationByPhoneAndChannel(to, channelId);
      if (!conversation) {
        conversation = await storage.createConversation({
          contactId: contact.id,
          contactPhone: to,
          contactName: contact.name || to,
          channelId,
          unreadCount: 0,
        });
      }

      const failedMessage = await storage.createMessage({
        conversationId: conversation.id,
        content: msgBody,
        fromUser: true,
        direction: "outbound",
        status: "failed",
        messageType,
        timestamp: new Date(),
        errorDetails: errorInfo,
        metadata: mediaId ? { headerMediaId: mediaId } : {},
      });

      await storage.updateConversation(conversation.id, {
        lastMessageAt: new Date(),
        lastMessageText: msgBody,
      });

      if ((global as any).broadcastToConversation) {
        (global as any).broadcastToConversation(conversation.id, {
          type: "new-message",
          message: failedMessage,
        });
      }

      return res.json({
        success: false,
        error: err.message || "Failed to send template via WhatsApp",
        conversationId: conversation.id,
        message: failedMessage,
      });
    }
  }

  
  else if (mediaId) {
    const mimeType = file.mimetype;

    if (mimeType.startsWith("image")) messageType = "image";
    else if (mimeType.startsWith("video")) messageType = "video";
    else if (mimeType.startsWith("audio")) messageType = "audio";
    else messageType = "document";

    result = await whatsappApi.sendMediaMessage(
      to,
      mediaId,
      messageType as any,
      caption || message,
    );

    msgBody = caption || `[${messageType}]`;
  }

  
  else {
    result = await whatsappApi.sendTextMessage(to, message);
    msgBody = message;
    messageType = "text";
  }

  
  let conversation = await storage.getConversationByPhoneAndChannel(to, channelId);
  if (!conversation) {
    conversation = await storage.createConversation({
      contactId: contact.id,
      contactPhone: to,
      contactName: contact.name || to,
      channelId,
      unreadCount: 0,
    });
  }

  const createdMessage = await storage.createMessage({
    conversationId: conversation.id,
    content: msgBody,
    fromUser: true,
    direction: "outbound",
    status: "sent",
    whatsappMessageId: result.messages?.[0]?.id,
    messageType,
    timestamp: new Date(),
    metadata: file
      ? {
          mimeType: file.mimetype,
          originalName: file.originalname,
        }
      : mediaId
      ? { headerMediaId: mediaId }
      : {},
  });

  await storage.updateConversation(conversation.id, {
    lastMessageAt: new Date(),
    lastMessageText: msgBody,
  });

  
  if ((global as any).broadcastToConversation) {
    (global as any).broadcastToConversation(conversation.id, {
      type: "new-message",
      message: createdMessage,
    });
  }

  res.json({
    success: true,
    messageId: result.messages?.[0]?.id,
    conversationId: conversation.id,
    message: createdMessage,
  });
});
