import { Express } from "express";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import {
  saveWhatsappConfig,
  getMyWhatsappConfig,
  updateWhatsappConfig,
  deleteWhatsappConfig,
} from "../controllers/whatsappConfig.controller";
import { requireAuth, requireRole } from
  "server/middlewares/auth.middleware";

export function registerWhatsappConfigRoutes(
  app: Express
) {

  
  app.get(
    "/api/embedded/config",
    requireAuth,
    getMyWhatsappConfig
  );

  
  app.post(
    "/api/embedded/config",
    requireAuth,
    requireRole("superadmin"),
    saveWhatsappConfig
  );

  
  app.put(
    "/api/embedded/config/:id",
    requireAuth,
    requireRole("superadmin"),
    updateWhatsappConfig
  );

  
  app.delete(
    "/api/embedded/config",
    requireAuth,
    requireRole("superadmin"),
    deleteWhatsappConfig
  );
}
