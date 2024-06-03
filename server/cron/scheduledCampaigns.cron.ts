import cron from "node-cron";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import { storage } from "../storage";
import {startCampaignExecution} from "../controllers/campaigns.controller";

export function startScheduledCampaignCron() {
  cron.schedule("* * * * *", async () => {
    try {
      console.log("⏳ Cron: checking scheduled campaigns");

      const now = new Date();

      
      const campaigns = await storage.getScheduledCampaigns(now);

      for (const campaign of campaigns) {
        console.log("Starting scheduled campaign:", campaign.id);

        await storage.updateCampaign(campaign.id, {
          status: "active",
        });

        const updated = await storage.getCampaign(campaign.id);
        if (!updated || updated.status !== "active") {
          console.error(`Scheduled campaign ${campaign.id} failed to transition to active`);
          continue;
        }

        await startCampaignExecution(campaign.id);
      }
    } catch (error) {
      console.error("❌ Cron error (scheduled campaigns):", error);
    }
  });
}
