import { Request, Response, NextFunction } from "express";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import { and, eq, desc } from "drizzle-orm";
import { db } from "server/db";
import { plans, subscriptions, channels, automations, campaigns, contacts, sites } from "@shared/schema";

export const requireSubscription = (
    requiredPermission: "channel" | "contacts" | "automation" | "campaign"
) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            let userId: string | null = null;

            const sessionUser = (req.session as any).user;
            const siteId = req.body.siteId;

            if (sessionUser) {
                userId = sessionUser.role === "team" && sessionUser.createdBy
                    ? sessionUser.createdBy
                    : sessionUser.id;
            }

            
            else if (siteId) {
                const [site] = await db
                    .select()
                    .from(sites)
                    .where(eq(sites.id, siteId));

                if (!site) {
                    return res.status(404).json({ error: "Invalid siteId." });
                }

                const [channel] = await db
                    .select()
                    .from(channels)
                    .where(eq(channels.id, site.channelId));

                if (!channel) {
                    return res.status(404).json({ error: "Channel not found." });
                }

                userId = channel.createdBy;
            }

            
            else {
                return res.status(401).json({ error: "Unauthorized" });
            }

            
            
            

            

const activeSubs = await db
  .select()
  .from(subscriptions)
  .where(
    and(
      eq(subscriptions.userId, userId),
      eq(subscriptions.status, "active")
    )
  )
  .orderBy(desc(subscriptions.createdAt));

if (activeSubs.length === 0) {
  return res.status(403).json({ error: "Subscription required." });
}

           

            
            if (activeSubs.length > 1) {
                console.warn("⚠ Multiple active plans for user:", userId);
            }

            const sub = activeSubs[0]; 

            
            if (new Date(sub.endDate) < new Date()) {
                return res.status(403).json({ error: "Subscription expired." });
            }

            
            
            
            const [plan] = await db
                .select()
                .from(plans)
                .where(eq(plans.id, sub.planId));

            if (!plan) {
                return res.status(500).json({ error: "Plan not found." });
            }

            const permissionValue = plan.permissions?.[requiredPermission];

            if (permissionValue === undefined || permissionValue === null || permissionValue === "" || permissionValue === "0") {
                return res.status(403).json({
                    error: `Your plan does not allow ${requiredPermission}.`,
                });
            }

            if (String(permissionValue).toLowerCase() === "unlimited") {
                return next();
            }

            const limit = Number(permissionValue);

            if (isNaN(limit) || limit <= 0) {
                return res.status(403).json({
                    error: `Your plan does not allow ${requiredPermission}.`,
                });
            }

            
            
            

            let currentCount = 0;

            if (requiredPermission === "contacts") {
                const data = await db
                    .select()
                    .from(contacts)
                    .leftJoin(channels, eq(contacts.channelId, channels.id))
                    .where(eq(channels.createdBy, userId));

                currentCount = data.length;
            }

            if (requiredPermission === "channel") {
                const data = await db
                    .select()
                    .from(channels)
                    .where(eq(channels.createdBy, userId));

                currentCount = data.length;
            }

            if (requiredPermission === "automation") {
                const data = await db
                    .select()
                    .from(automations)
                    .where(eq(automations.createdBy, userId));

                currentCount = data.length;
            }

            if (requiredPermission === "campaign") {
                const data = await db
                    .select()
                    .from(campaigns)
                    .where(eq(campaigns.createdBy, userId));

                currentCount = data.length;
            }

            
            
            
            if (currentCount >= limit) {
                return res.status(403).json({
                    error: `You have reached the limit for ${requiredPermission}. Allowed: ${limit}`,
                });
            }

            next();

        } catch (err) {
            console.error("Subscription check error:", err);
            return res.status(500).json({ error: "Server error checking subscription." });
        }
    };
};
