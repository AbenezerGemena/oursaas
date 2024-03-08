import type { Express } from "express";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import * as automationsController from "../controllers/automations.controller";
import { validateRequest } from "../middlewares/validation.middleware";
import { insertAutomationSchema } from "@shared/schema";
import { extractChannelId } from "../middlewares/channel.middleware";
import { upload } from "server/middlewares/upload.middleware";

export function registerAutomationsRoutes(app: Express) {
  
  app.get("/api/automations",
    extractChannelId,
    automationsController.getAutomations
  );

  
  app.get("/api/automations/:id", automationsController.getAutomation);

  
  app.post(
    "/api/automations",
    upload.any(), 
    automationsController.createAutomation
  );

  
  app.put("/api/automations/:id", automationsController.updateAutomation);

  
  app.delete("/api/automations/:id", automationsController.deleteAutomation);

  
  app.post("/api/automations/:id/toggle", automationsController.toggleAutomation);
}
