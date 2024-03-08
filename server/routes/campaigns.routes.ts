import type { Express } from "express";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import { campaignsController } from "../controllers/campaigns.controller";
import { extractChannelId } from "../middlewares/channel.middleware";
import { requireAuth, requirePermission } from "../middlewares/auth.middleware";
import { PERMISSIONS } from "@shared/schema";
import { requireSubscription } from "server/middlewares/requireSubscription";

export function registerCampaignRoutes(app: Express) {
  
  app.get("/api/campaigns", 
    extractChannelId,
    requireAuth,
    requirePermission(PERMISSIONS.CAMPAIGNS_VIEW),
    campaignsController.getCampaigns
  );

  
  app.get("/api/campaigns/:id",  requireAuth,
  requirePermission(PERMISSIONS.CAMPAIGNS_VIEW), 
    campaignsController.getCampaign
  );

  
  app.post("/api/campaigns",   requireAuth,
  requirePermission(PERMISSIONS.CAMPAIGNS_CREATE), requireSubscription("campaign"), 
    campaignsController.createCampaign
  );

  app.post("/api/getCampaignsByUserId", requireAuth, campaignsController.getCampaignByUserID);

   

  
  app.patch("/api/campaigns/:id/status", requireAuth,
  requirePermission(PERMISSIONS.CAMPAIGNS_EDIT),
    campaignsController.updateCampaignStatus
  );

  
  app.delete("/api/campaigns/:id", requireAuth,
  requirePermission(PERMISSIONS.CAMPAIGNS_DELETE),
    campaignsController.deleteCampaign
  );

  
  app.post("/api/campaigns/:id/start", 
    campaignsController.startCampaign
  );

  
  app.get("/api/campaigns/:id/analytics", 
    campaignsController.getCampaignAnalytics
  );

  
  app.post("/api/campaigns/send/:apiKey", requireAuth,
  requirePermission(PERMISSIONS.CAMPAIGNS_SEND),
    campaignsController.sendApiCampaign
  );
}
