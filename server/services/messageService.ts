import { storage } from "../storage";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import { AppError } from "../middlewares/error.middleware";

export async function sendBusinessMessage({
  to,
  message,
  templateName,
  parameters,
  mediaId,
  channelId,
  conversationId,
}: {
  to: string;
  message?: string;
  templateName?: string;
  parameters?: string[];
  mediaId?: string | null;
  channelId?: string;
  conversationId?: string;
}) {
  
  if (!channelId) {
    const active = await storage.getActiveChannel();
    if (!active) throw new AppError(400, "No active channel");
    channelId = active.id;
  }

  const channel = await storage.getChannel(channelId);
  if (!channel) throw new AppError(404, "Channel not found");

  let result;
  let sentText = message || "";

  
  if (templateName) {
    const components: any[] = [];

    
    if (mediaId) {
      components.push({
        type: "header",
        parameters: [
          {
            type: "image",
            image: { id: mediaId },
          },
        ],
      });
    }

    
    if (parameters && parameters.length > 0) {
      components.push({
        type: "body",
        parameters: parameters.map((val) => ({
          type: "text",
          text: String(val),
        })),
      });
    }

    const payload = {
      messaging_product: "whatsapp",
      to: to.replace(/\D/g, ""),
      type: "template",
      template: {
        name: templateName,
        language: { code: "en_US" },
        ...(components.length > 0 ? { components } : {}), 
      },
    };

    console.log(
      "🚀 FINAL WhatsApp TEMPLATE PAYLOAD:",
      JSON.stringify(payload, null, 2)
    );

    const response = await fetch(
      `https://graph.facebook.com/v24.0/${channel.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${channel.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const err = await response.json();
      console.error("WhatsApp API Error:", err);
      throw new Error(err.error?.message || "Template send failed");
    }

    result = await response.json();
    sentText = templateName; 
  }

  
  else {
    const payload = {
      messaging_product: "whatsapp",
      to: to.replace(/\D/g, ""),
      type: "text",
      text: { body: message || "Test message" },
    };

    const response = await fetch(
      `https://graph.facebook.com/v24.0/${channel.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${channel.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || "Text send failed");
    }

    result = await response.json();
  }

  
  let conversation = conversationId
    ? await storage.getConversation(conversationId)
    : await storage.getConversationByPhone(to);

  if (!conversation) {
    let contact = await storage.getContactByPhone(to);
    if (!contact) {
      contact = await storage.createContact({
        name: to,
        phone: to,
        channelId,
      });
    }

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
    content: sentText, 
    status: "sent",
    whatsappMessageId: result.messages?.[0]?.id,
  });

  await storage.updateConversation(conversation.id, {
    lastMessageAt: new Date(),
    lastMessageText: sentText,
  });

  if ((global as any).broadcastToConversation) {
    (global as any).broadcastToConversation(conversation.id, {
      type: "new-message",
      message: createdMessage,
    });
  }

  return {
    success: true,
    messageId: result.messages?.[0]?.id,
    conversationId: conversation.id,
  };
}
