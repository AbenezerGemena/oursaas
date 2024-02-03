import { Request, Response } from "express";
import { OurSaasError, asyncHandler as _dHandler, oursaasLogger, HTTP_STATUS } from "@oursaas/core";
import { db } from "../db";
import { subscriptions, users, plans } from "@shared/schema";
import { eq, and, desc, lt, sql } from "drizzle-orm";
import {
  cancelStripeSubscription,
  cancelRazorpaySubscription,
  cancelPayPalSubscription,
  cancelPaystackSubscription,
  cancelMercadoPagoSubscription,
  upgradeOrDowngradeStripe,
  upgradeOrDowngradeRazorpay,
  createStripeSubscription,
  createRazorpaySubscription,
} from "../services/payment-gateway.service";

export const getAllSubscriptions = async (req: Request, res: Response) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const [{ count }] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(subscriptions);

    const total = Number(count);
    const totalPages = Math.ceil(total / limit);

    const paginatedSubscriptions = await db
      .select({
        subscription: subscriptions,
        user: {
          id: users.id,
          username: users.username,
        },
        plan: {
          id: plans.id,
          name: plans.name,
          description: plans.description,
          icon: plans.icon,
          monthlyPrice: plans.monthlyPrice,
          annualPrice: plans.annualPrice,
          features: plans.features,
          permissions: plans.permissions,
        },
      })
      .from(subscriptions)
      .leftJoin(users, eq(subscriptions.userId, users.id))
      .leftJoin(plans, eq(subscriptions.planId, plans.id))
      .orderBy(desc(subscriptions.createdAt))
      .limit(limit)
      .offset(offset);

    res.status(200).json({
      success: true,
      data: paginatedSubscriptions,
      pagination: { total, totalPages, page, limit },
    });
  } catch (error) {
    console.error("Error fetching subscriptions:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching subscriptions",
      error,
    });
  }
};

export const getActivePaidUsersCount = async () => {
  const activeSubs = await db
    .select({ userId: subscriptions.userId })
    .from(subscriptions)
    .where(eq(subscriptions.status, "active"));

  return new Set(activeSubs.map((s: any) => s.userId)).size;
};

export const getSubscriptionById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const subscription = await db
      .select({
        subscription: subscriptions,
        user: users,
        plan: plans,
      })
      .from(subscriptions)
      .leftJoin(users, eq(subscriptions.userId, users.id))
      .leftJoin(plans, eq(subscriptions.planId, plans.id))
      .where(eq(subscriptions.id, id));

    if (subscription.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Subscription not found" });
    }

    res.status(200).json({ success: true, data: subscription[0] });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching subscription",
      error,
    });
  }
};

export const getSubscriptionsByUserId = async (
  req: Request,
  res: Response
) => {
  try {
    const { userId } = req.params;

    const userSubscriptions = await db
      .select({
        subscription: subscriptions,
        user: {
          id: users.id,
          username: users.username,
        },
      })
      .from(subscriptions)
      .leftJoin(users, eq(subscriptions.userId, users.id))
      .where(
        and(
          eq(subscriptions.userId, userId),
          eq(subscriptions.status, "active")
        )
      )
      .orderBy(desc(subscriptions.createdAt));

    res.status(200).json({ success: true, data: userSubscriptions });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching user subscriptions",
      error,
    });
  }
};

export const getActiveSubscriptionByUserId = async (
  req: Request,
  res: Response
) => {
  try {
    const { userId } = req.params;
    const activeSubscription = await db
      .select({
        subscription: subscriptions,
        plan: plans,
      })
      .from(subscriptions)
      .leftJoin(plans, eq(subscriptions.planId, plans.id))
      .where(
        and(
          eq(subscriptions.userId, userId),
          eq(subscriptions.status, "active")
        )
      )
      .orderBy(desc(subscriptions.createdAt))
      .limit(1);

    if (activeSubscription.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "No active subscription found" });
    }

    res.status(200).json({ success: true, data: activeSubscription[0] });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching active subscription",
      error,
    });
  }
};

export const AssignSubscription = async (req: Request, res: Response) => {
  try {
    const { userId, planId, billingCycle: requestedCycle } = req.body;

    const plan = await db.query.plans.findFirst({
      where: (p: any) => eq(p.id, planId),
    });

    if (!plan) {
      return res
        .status(404)
        .json({ success: false, message: "Plan not found" });
    }

    await db
      .update(subscriptions)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(subscriptions.userId, userId),
          eq(subscriptions.status, "active")
        )
      );

    const billingCycle = requestedCycle === "annual" ? "annual" : "monthly";
    const startDate = new Date();
    const endDate = new Date();
    if (billingCycle === "annual") {
      endDate.setFullYear(endDate.getFullYear() + 1);
    } else {
      endDate.setMonth(endDate.getMonth() + 1);
    }
    const autoRenew = true;

    const newSubscription = await db
      .insert(subscriptions)
      .values({
        userId,
        planId,
        planData: {
          name: plan.name,
          description: plan.description,
          monthlyPrice: plan.monthlyPrice,
          annualPrice: plan.annualPrice,
          permissions: plan.permissions,
          features: plan.features,
        },
        status: "active",
        billingCycle,
        startDate,
        endDate,
        autoRenew,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return res.status(201).json({
      success: true,
      message: "Subscription assigned successfully",
      data: newSubscription[0],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error creating subscription",
      error,
    });
  }
};

export const createSubscription = async (req: Request, res: Response) => {
  try {
    const { userId, planId, billingCycle, startDate, endDate, autoRenew } =
      req.body;

    await db
      .update(subscriptions)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(subscriptions.userId, userId),
          eq(subscriptions.status, "active")
        )
      );

    const newSubscription = await db
      .insert(subscriptions)
      .values({
        userId,
        planId,
        status: "active",
        billingCycle,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        autoRenew: autoRenew ?? true,
      })
      .returning();

    res.status(201).json({
      success: true,
      message: "Subscription created successfully",
      data: newSubscription[0],
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error creating subscription",
      error,
    });
  }
};

export const updateSubscription = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const updatedSubscription = await db
      .update(subscriptions)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(subscriptions.id, id))
      .returning();

    if (updatedSubscription.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Subscription not found" });
    }

    res.status(200).json({
      success: true,
      message: "Subscription updated successfully",
      data: updatedSubscription[0],
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error updating subscription",
      error,
    });
  }
};

export const cancelSubscription = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { immediately } = req.body || {};

    const subData = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, id))
      .limit(1);

    if (subData.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Subscription not found" });
    }

    const sub = subData[0];

    if (sub.gatewaySubscriptionId && sub.gatewayProvider) {
      try {
        if (sub.gatewayProvider === "stripe") {
          await cancelStripeSubscription(
            sub.gatewaySubscriptionId,
            immediately === true
          );
        } else if (sub.gatewayProvider === "razorpay") {
          await cancelRazorpaySubscription(
            sub.gatewaySubscriptionId,
            immediately === true
          );
        } else if (sub.gatewayProvider === "paypal") {
          await cancelPayPalSubscription(
            sub.gatewaySubscriptionId,
            immediately === true
          );
        } else if (sub.gatewayProvider === "paystack") {
          await cancelPaystackSubscription(sub.gatewaySubscriptionId);
        } else if (sub.gatewayProvider === "mercadopago") {
          await cancelMercadoPagoSubscription(sub.gatewaySubscriptionId);
        }
      } catch (err: any) {
        console.error("Gateway cancellation error:", err.message);
      }
    }

    if (immediately === true) {
      const cancelledSubscription = await db
        .update(subscriptions)
        .set({
          status: "cancelled",
          autoRenew: false,
          gatewayStatus: "cancelled",
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, id))
        .returning();

      res.status(200).json({
        success: true,
        message: "Subscription cancelled immediately",
        data: cancelledSubscription[0],
      });
    } else {
      const cancelledSubscription = await db
        .update(subscriptions)
        .set({
          autoRenew: false,
          gatewayStatus: "cancel_at_period_end",
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, id))
        .returning();

      res.status(200).json({
        success: true,
        message: `Subscription will be cancelled at the end of your billing period (${sub.endDate ? new Date(sub.endDate).toLocaleDateString() : "end of period"})`,
        data: cancelledSubscription[0],
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error cancelling subscription",
      error,
    });
  }
};

export const changePlan = async (req: Request, res: Response) => {
  try {
    const { userId, newPlanId, billingCycle } = req.body;

    if (!userId || !newPlanId) {
      return res.status(400).json({
        success: false,
        message: "userId and newPlanId are required",
      });
    }

    const cycle = billingCycle === "annual" ? "annual" : "monthly";

    const activeSub = await db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, userId),
          eq(subscriptions.status, "active")
        )
      )
      .orderBy(desc(subscriptions.createdAt))
      .limit(1);

    const newPlanData = await db
      .select()
      .from(plans)
      .where(eq(plans.id, newPlanId))
      .limit(1);

    if (!newPlanData.length) {
      return res
        .status(404)
        .json({ success: false, message: "New plan not found" });
    }

    const newPlan = newPlanData[0];

    if (activeSub.length > 0) {
      const currentSub = activeSub[0];

      if (
        currentSub.gatewaySubscriptionId &&
        currentSub.gatewayProvider
      ) {
        let gatewayResult: any;

        if (currentSub.gatewayProvider === "stripe") {
          gatewayResult = await upgradeOrDowngradeStripe(
            currentSub.gatewaySubscriptionId,
            newPlanId,
            cycle
          );

          await db
            .update(subscriptions)
            .set({
              planId: newPlanId,
              billingCycle: cycle,
              planData: {
                name: newPlan.name,
                description: newPlan.description,
                monthlyPrice: newPlan.monthlyPrice,
                annualPrice: newPlan.annualPrice,
                permissions: newPlan.permissions,
                features: newPlan.features,
              },
              gatewayStatus: gatewayResult.status,
              endDate: gatewayResult.currentPeriodEnd,
              updatedAt: new Date(),
            })
            .where(eq(subscriptions.id, currentSub.id));

          await db
            .update(users)
            .set({ planId: newPlanId, updatedAt: new Date() })
            .where(eq(users.id, userId));

          return res.status(200).json({
            success: true,
            message: "Plan changed successfully via Stripe",
            data: { subscriptionId: gatewayResult.subscriptionId },
          });
        } else if (currentSub.gatewayProvider === "razorpay") {
          gatewayResult = await upgradeOrDowngradeRazorpay(
            userId,
            currentSub.gatewaySubscriptionId,
            newPlanId,
            cycle
          );

          await db
            .update(subscriptions)
            .set({
              status: "cancelled",
              gatewayStatus: "cancelled",
              updatedAt: new Date(),
            })
            .where(eq(subscriptions.id, currentSub.id));

          return res.status(200).json({
            success: true,
            message:
              "Plan change initiated via Razorpay. Complete payment to activate.",
            data: {
              subscriptionId: gatewayResult.subscriptionId,
              shortUrl: gatewayResult.shortUrl,
            },
          });
        }
      }

      await db
        .update(subscriptions)
        .set({
          status: "cancelled",
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, currentSub.id));
    }

    const startDate = new Date();
    const endDate = new Date();
    if (cycle === "annual") {
      endDate.setFullYear(endDate.getFullYear() + 1);
    } else {
      endDate.setMonth(endDate.getMonth() + 1);
    }

    const newSubscription = await db
      .insert(subscriptions)
      .values({
        userId,
        planId: newPlanId,
        planData: {
          name: newPlan.name,
          description: newPlan.description,
          monthlyPrice: newPlan.monthlyPrice,
          annualPrice: newPlan.annualPrice,
          permissions: newPlan.permissions,
          features: newPlan.features,
        },
        status: "active",
        billingCycle: cycle,
        startDate,
        endDate,
        autoRenew: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    await db
      .update(users)
      .set({ planId: newPlanId, updatedAt: new Date() })
      .where(eq(users.id, userId));

    return res.status(200).json({
      success: true,
      message: "Plan changed successfully",
      data: newSubscription[0],
    });
  } catch (error: any) {
    console.error("Error changing plan:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Error changing plan",
    });
  }
};

export const renewSubscription = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const currentSub = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, id));

    if (currentSub.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Subscription not found" });
    }

    const subscription = currentSub[0];

    const newStartDate = new Date();
    const newEndDate = new Date();

    if (subscription.billingCycle === "annual") {
      newEndDate.setFullYear(newEndDate.getFullYear() + 1);
    } else {
      newEndDate.setMonth(newEndDate.getMonth() + 1);
    }

    const renewedSubscription = await db
      .update(subscriptions)
      .set({
        status: "active",
        startDate: newStartDate,
        endDate: newEndDate,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, id))
      .returning();

    res.status(200).json({
      success: true,
      message: "Subscription renewed successfully",
      data: renewedSubscription[0],
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error renewing subscription",
      error,
    });
  }
};

export const toggleAutoRenew = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { autoRenew } = req.body;

    const updatedSubscription = await db
      .update(subscriptions)
      .set({ autoRenew, updatedAt: new Date() })
      .where(eq(subscriptions.id, id))
      .returning();

    if (updatedSubscription.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Subscription not found" });
    }

    res.status(200).json({
      success: true,
      message: `Auto-renew ${autoRenew ? "enabled" : "disabled"} successfully`,
      data: updatedSubscription[0],
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error toggling auto-renew",
      error,
    });
  }
};

export const checkExpiredSubscriptions = async (
  req: Request,
  res: Response
) => {
  try {
    const now = new Date();

    const expiredSubscriptions = await db
      .update(subscriptions)
      .set({ status: "expired", updatedAt: new Date() })
      .where(
        and(eq(subscriptions.status, "active"), lt(subscriptions.endDate, now))
      )
      .returning();

    res.status(200).json({
      success: true,
      message: `${expiredSubscriptions.length} subscriptions marked as expired`,
      data: expiredSubscriptions,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error checking expired subscriptions",
      error,
    });
  }
};
