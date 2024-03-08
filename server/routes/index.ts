import type { Express } from "express";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";

import { registerChannelRoutes } from "./channels.routes";
import { registerDashboardRoutes } from "./dashboard.routes";
import { registerAnalyticsRoutes } from "./analytics.routes";
import { registerContactRoutes } from "./contacts.routes";
import { registerCampaignRoutes } from "./campaigns.routes";
import { registerTemplateRoutes } from "./templates.routes";
import { registerMediaRoutes } from "./media.routes";
import { registerConversationRoutes } from "./conversations.routes";
import { registerAutomationRoutes } from "./automation.routes";

import { registerWhatsAppRoutes } from "./whatsapp.routes";
import { registerWhatsappConfigRoutes } from "./whatsappConfig.routes";
import { registerWebhookRoutes } from "./webhooks.routes";
import { registerMessageRoutes } from "./messages.routes";
import { registerPaymentsRoutes } from "./payment.routes";
import { registerMessageLogsRoutes } from "./messages.logs.routes";
import { registerPlansRoutes } from "./plans.routes";
import { registerSubscriptionsRoutes } from "./subscriptions.routes";
import {userRoutes} from "./user.route"
import teamRoutes from "./team.routes";
import authRoutes from "./auth.routes";
import { registerSMTPRoutes } from "./smtp.route";

import { errorHandler } from "../middlewares/error.middleware";
import { registerPanelConfigRoutes } from "./panel.config.routes";
import { registerStorageSettingsRoutes } from "./storage.settings.route";
import { registerAISettingsRoutes } from "./ai.settings.routes";
import { registerWidgetRoutes } from "./chatbot.routes";
import { registerTicketsRoutes } from "./support.tickets.routes";
import { registerNotificationsRoutes } from "./notifications.routes";

import { registerGroupRoutes } from "./group.routes";
import { registerTrainingRoutes } from "./training.routes";
import { registerLanguageRoutes } from "./language.routes";
import { registerClientApiRoutes } from "./client-api.routes";
import { registerRestApiV1Routes } from "./rest-api-v1.routes";

export async function registerRoutes(app: Express): Promise<Server> {
  
  app.use("/api/auth", authRoutes);

  
  registerWidgetRoutes(app);
  registerGroupRoutes(app);
  registerPlansRoutes(app);
  registerNotificationsRoutes(app);

  userRoutes(app);
  registerSMTPRoutes(app);
  registerStorageSettingsRoutes(app);
  registerAISettingsRoutes(app);
  registerChannelRoutes(app);
  registerDashboardRoutes(app);
  registerAnalyticsRoutes(app); 
  registerContactRoutes(app);
  registerCampaignRoutes(app);
  registerTemplateRoutes(app);
  registerMediaRoutes(app);
  registerConversationRoutes(app);
  registerAutomationRoutes(app);
  
  registerWhatsAppRoutes(app);
  registerWhatsappConfigRoutes(app);
  registerWebhookRoutes(app);
  registerMessageRoutes(app);
  registerMessageLogsRoutes(app);
  registerPanelConfigRoutes(app)
  registerPaymentsRoutes(app);
  registerTicketsRoutes(app);
  registerSubscriptionsRoutes(app);
  registerTrainingRoutes(app);
  registerLanguageRoutes(app);
  registerClientApiRoutes(app);
  registerRestApiV1Routes(app);
  
  
  app.use("/api/team", teamRoutes);
  
  
  app.get("/api/users", async (req, res) => {
    try {
      const { storage } = await import("../storage");
      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  
  const httpServer = createServer(app);

  
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  
  
  const conversationClients = new Map<string, Set<WebSocket>>();

  
  const allClients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    console.log('WebSocket client connected');
    allClients.add(ws);
    let currentConversationId: string | null = null;
    let joinedAllConversations = false;
    
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        
        if (data.type === 'join-all-conversations') {
          
          joinedAllConversations = true;
          ws.send(JSON.stringify({ type: 'joined-all' }));
        } else if (data.type === 'join-conversation') {
          
          if (currentConversationId && conversationClients.has(currentConversationId)) {
            conversationClients.get(currentConversationId)!.delete(ws);
          }
          
          
          currentConversationId = data.conversationId;
          if (currentConversationId) {
            if (!conversationClients.has(currentConversationId)) {
              conversationClients.set(currentConversationId, new Set());
            }
            conversationClients.get(currentConversationId)!.add(ws);
          }
          
          ws.send(JSON.stringify({ type: 'joined', conversationId: currentConversationId }));
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    });
    
    ws.on('close', () => {
      
      allClients.delete(ws);
      
      
      if (currentConversationId && conversationClients.has(currentConversationId)) {
        conversationClients.get(currentConversationId)!.delete(ws);
        if (conversationClients.get(currentConversationId)!.size === 0) {
          conversationClients.delete(currentConversationId);
        }
      }
      console.log('WebSocket client disconnected');
    });
  });

  
  (global as any).broadcastToConversation = (conversationId: string, data: any) => {
    const message = JSON.stringify({ ...data, conversationId });
    
    
    const clients = conversationClients.get(conversationId);
    if (clients) {
      clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      });
    }
    
    
    allClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  };

  
  app.use(errorHandler);

  return httpServer;
}
