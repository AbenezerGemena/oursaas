import { requireAuth, requireRole } from "server/middlewares/auth.middleware";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import {
  getSMTPConfigHandler,
  upsertSMTPConfig,
  sendMailRoute
} from "../controllers/smtp.controller";
import { upload, handleDigitalOceanUpload } from "../middlewares/upload.middleware";
import type { Express } from "express";

export function registerSMTPRoutes(app: Express) {
  
  app.post("/api/admin/smtpConfig", requireAuth, upsertSMTPConfig);

  
  app.get("/api/admin/getSmtpConfig", requireAuth, getSMTPConfigHandler);  

  app.post("/api/admin/smtp/upload-logo", requireAuth, requireRole("superadmin"), upload.single('logo'), handleDigitalOceanUpload, async (req, res) => {
    try {
      const file = req.file as any;
      if (!file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
      }
      const logoUrl = file.cloudUrl || `/uploads/${file.filename}`;
      res.json({ success: true, url: logoUrl });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/contact/sendmail", sendMailRoute);
}
