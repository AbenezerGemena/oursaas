import type { Express } from "express";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import * as analyticsController from "../controllers/analytics.controller";
import * as dashboardController from "../controllers/dashboard.controller";
import { extractChannelId } from "../middlewares/channel.middleware";
import { requireAuth, requirePermission } from "../middlewares/auth.middleware";
import { PERMISSIONS } from "@shared/schema";

export function registerAnalyticsRoutes(app: Express) {
  
  app.get("/api/analytics",requireAuth,
  requirePermission(PERMISSIONS.ANALYTICS_VIEW), dashboardController.getAnalytics);
  
  app.get("/api/analytics/messages", requireAuth, requirePermission(PERMISSIONS.ANALYTICS_VIEW), analyticsController.getMessageAnalytics);
  app.get("/api/analytics/campaigns", requireAuth, requirePermission(PERMISSIONS.ANALYTICS_VIEW), analyticsController.getCampaignAnalytics);
  app.get("/api/analytics/campaigns/:campaignId", requireAuth, requirePermission(PERMISSIONS.ANALYTICS_VIEW), analyticsController.getCampaignAnalyticsById);
  app.get("/api/analytics/export",requireAuth,
  requirePermission(PERMISSIONS.ANALYTICS_EXPORT), analyticsController.exportAnalytics);
}
