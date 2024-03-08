import type { Express } from "express";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import * as messagesController from "../controllers/messages.controller";
import { validateRequest } from "../middlewares/validation.middleware";
import { insertMessageSchema } from "@shared/schema";
import { handleDigitalOceanUpload, upload } from "../middlewares/upload.middleware";

export function registerMessageRoutes(app: Express) {
  
  app.get("/api/conversations/:conversationId/messages",upload.single("media"),handleDigitalOceanUpload, messagesController.getMessages);

  
  app.post("/api/conversations/:conversationId/messages",upload.single("media"),handleDigitalOceanUpload,
    messagesController.createMessage
  );

  
  app.post("/api/messages/send", messagesController.sendMessage);

  
  app.get("/api/messages/media-url", messagesController.getMediaUrl);
  
  
  
  app.get("/api/messages/media-proxy", messagesController.getMediaProxy);
  
}
