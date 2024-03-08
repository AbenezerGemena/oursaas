import type { Express } from "express";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import * as webhooksController from "../controllers/webhooks.controller";

export function registerWebhookRoutes(app: Express) {
  
  app.get("/api/webhook-configs-channel-id/:id", webhooksController.getWebhookConfigsByChannelId);

  app.get("/api/webhook-configs", webhooksController.getWebhookConfigs);
  
  
  app.post("/api/webhook-configs", webhooksController.createWebhookConfig);
  
  
  app.patch("/api/webhook-configs/:id", webhooksController.updateWebhookConfig);
  
  
  app.delete("/api/webhook-configs/:id", webhooksController.deleteWebhookConfig);
  
  
  app.post("/api/webhook-configs/:id/test", webhooksController.testWebhook);

  
  app.get("/api/webhook/global-url", webhooksController.getGlobalWebhookUrl);

  
  app.all("/webhook/global", webhooksController.handleWebhook);
  app.all("/webhook/:id", webhooksController.handleWebhook);

  

  app.post('/webhooks/razorpay', webhooksController.razorpayWebhook);

  
  app.post('/webhooks/stripe', webhooksController.stripeWebhook);

  
  app.post('/webhooks/paypal', webhooksController.paypalWebhook);

  
  app.post('/webhooks/paystack', webhooksController.paystackWebhook);

  
  app.post('/webhooks/mercadopago', webhooksController.mercadopagoWebhook);
}
