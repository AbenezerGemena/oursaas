import type { Express } from "express";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import * as dashboardController from "../controllers/dashboard.controller";
import { extractChannelId } from "../middlewares/channel.middleware";
import { requireAuth, requirePermission } from "../middlewares/auth.middleware";
import { PERMISSIONS } from "@shared/schema";

export function registerDashboardRoutes(app: Express) {
  
  app.get("/api/dashboard/stats",
    extractChannelId,
    dashboardController.getDashboardStats
  );

  app.get("/api/dashboard/admin/stats", dashboardController.getDashboardStatsForAdmin)
  app.get("/api/dashboard/user/stats", dashboardController.getDashboardStatsForUser);

  
  app.get("/api/analytics",
    extractChannelId,requireAuth,
    requirePermission(PERMISSIONS.ANALYTICS_VIEW),
    dashboardController.getAnalytics
  );

  
  app.post("/api/analytics", dashboardController.createAnalytics);
}
