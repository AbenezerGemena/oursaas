import type { Express } from "express";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import * as panelController from "../controllers/panel.config.controller";
import { handleDigitalOceanUpload, upload } from "../middlewares/upload.middleware";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";
import { getFirstPanelConfig, updateFirstPanelConfig } from "../services/panel.config";

export function registerPanelConfigRoutes(app: Express) {
  app.get("/api/platform-settings", async (_req, res) => {
    try {
      const config = await getFirstPanelConfig();
      res.json({
        embeddedSignupEnabled: config?.embeddedSignupEnabled ?? true,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/platform-settings", requireAuth, requireRole("superadmin"), async (req, res) => {
    try {
      const { embeddedSignupEnabled } = req.body;
      const config = await updateFirstPanelConfig({
        embeddedSignupEnabled: !!embeddedSignupEnabled,
      });
      res.json({
        embeddedSignupEnabled: config?.embeddedSignupEnabled ?? true,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  
  app.post(
    "/api/panel",
    upload.fields([{ name: "logo", maxCount: 1 }, { name: "favicon", maxCount: 1 }]),
    handleDigitalOceanUpload,
    panelController.create
  );

  
  app.get("/api/panel", panelController.getAll);
  
  
  app.get("/api/panel/:id", panelController.getOne);

  
  app.put(
    "/api/panel/:id",
    upload.fields([{ name: "logo", maxCount: 1 }, { name: "favicon", maxCount: 1 }]),
    handleDigitalOceanUpload,
    panelController.update
  );

  
  app.delete("/api/panel/:id", panelController.remove);

  
  app.get("/api/brand-settings", panelController.getBrandSettings);
  app.put("/api/brand-settings",upload.fields([{ name: "logo", maxCount: 1 },{name: "logo2", maxCount:1}, { name: "favicon", maxCount: 1 }]),handleDigitalOceanUpload, panelController.updateBrandSettings);
  app.post("/api/brand-settings",upload.fields([{ name: "logo", maxCount: 1 }, {name: "logo2", maxCount:1}, { name: "favicon", maxCount: 1 }]),handleDigitalOceanUpload, panelController.createBrandSettings);
}
