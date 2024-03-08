import type { Express } from "express";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import * as channelsController from "../controllers/channels.controller";
import { validateRequest } from "../middlewares/validation.middleware";
import { insertChannelSchema } from "@shared/schema";
import { requireAuth, requireRole } from "server/middlewares/auth.middleware";
import { requireSubscription } from "server/middlewares/requireSubscription";
import multer from "multer";
import { db } from "../db";
import { whatsappChannels } from "@shared/schema";

const profileUpload = multer({ dest: "uploads/profile-photos/", limits: { fileSize: 5 * 1024 * 1024 } });

export function registerChannelRoutes(app: Express) {
  app.get("/api/channels/all", requireAuth, requireRole("superadmin"), async (req, res) => {
    try {
      const allChannels = await db.select({
        id: whatsappChannels.id,
        name: whatsappChannels.name,
        phoneNumber: whatsappChannels.phoneNumber,
      }).from(whatsappChannels);
      res.json({ success: true, data: allChannels });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  
  app.get("/api/channels", channelsController.getChannels);

  app.post("/api/channels/userid", channelsController.getChannelsByUserId)

  
  app.get("/api/channels/active",requireAuth, channelsController.getActiveChannel);

  
  app.post("/api/channels", 
    validateRequest(insertChannelSchema), requireSubscription("channel"), 
    channelsController.createChannel
  );

  
   app.post(
  "/api/whatsapp/embedded-signup",
  requireAuth,
  channelsController.embeddedSignup
);

  
  app.put("/api/channels/:id",requireAuth,  channelsController.updateChannel);

  
  app.post("/api/channels/:id/disconnect", requireAuth, channelsController.disconnectChannel);

  
  app.delete("/api/channels/:id", requireAuth, channelsController.deleteChannel);

  
  app.post("/api/channels/:id/health", channelsController.checkChannelHealth);
  
  
  app.post("/api/channels/health-check-all", channelsController.checkAllChannelsHealth);

  
  app.get("/api/channels/:id/profile", requireAuth, channelsController.getBusinessProfile);
  app.post("/api/channels/:id/profile", requireAuth, channelsController.updateBusinessProfile);
  app.post("/api/channels/:id/profile/photo", requireAuth, profileUpload.single("photo"), channelsController.uploadProfilePhoto);

  
  app.get("/api/channels/:id/display-name", requireAuth, channelsController.getDisplayName);
  app.post("/api/channels/:id/display-name", requireAuth, channelsController.updateDisplayName);

  app.get("/api/channels/:id/messaging-limit", requireAuth, channelsController.getMessagingLimit);

  app.get("/api/whatsapp/test-credentials", requireAuth, requireRole("superadmin"), channelsController.testCredentials);

  app.get("/api/admin/channels", requireAuth, requireRole("superadmin"), channelsController.getAllChannelsAdmin);
  app.get("/api/admin/channel-signup-logs", requireAuth, requireRole("superadmin"), channelsController.getSignupLogs);
}
