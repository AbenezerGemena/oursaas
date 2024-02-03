import { Request, Response } from "express";
import { OurSaasError, asyncHandler as _dHandler, oursaasLogger, HTTP_STATUS } from "@oursaas/core";
import { db } from "../db";
import {
  transactions,
  subscriptions,
  plans,
  users,
  paymentProviders,
} from "@shared/schema";
import { eq, and, desc, gte, lte, or, like, sql, ne } from "drizzle-orm";
import crypto from "crypto";
import ExcelJS from "exceljs";
import {
  getStripe,
  getRazorpay,
  createStripeSubscription,
  createRazorpaySubscription,
  getStripePublishableKey,
  getRazorpayKeyId,
  createPayPalSubscription,
  getPayPalPublicClientId,
  createPaystackSubscription,
  getPaystackPublicKey,
  createMercadoPagoSubscription,
  getMercadoPagoPublicKey,
} from "../services/payment-gateway.service";

export const getAllTransactions = async (req: Request, res: Response) => {
  try {
    const {
      search,
      status,
      paymentMethod,
      billingCycle,
      providerId,
      startDate,
      endDate,
      minAmount,
      maxAmount,
      page = "1",
      limit = "20",
    } = req.query;

    const conditions = [];

    if (search && typeof search === "string") {
      conditions.push(
        or(
          like(users.email, `%${search}%`),
          like(transactions.providerTransactionId, `%${search}%`),
          like(transactions.providerOrderId, `%${search}%`)
        )
      );
    }

    if (status && typeof status === "string") {
      conditions.push(eq(transactions.status, status));
    } else {
      conditions.push(ne(transactions.status, "pending"));
    }

    if (paymentMethod && typeof paymentMethod === "string") {
      conditions.push(eq(transactions.paymentMethod, paymentMethod));
    }

    if (billingCycle && typeof billingCycle === "string") {
      conditions.push(eq(transactions.billingCycle, billingCycle));
    }

    if (providerId && typeof providerId === "string") {
      conditions.push(eq(transactions.paymentProviderId, providerId));
    }

    if (startDate && typeof startDate === "string") {
      conditions.push(gte(transactions.createdAt, new Date(startDate)));
    }
    if (endDate && typeof endDate === "string") {
      conditions.push(lte(transactions.createdAt, new Date(endDate)));
    }

    if (minAmount && typeof minAmount === "string") {
      conditions.push(gte(transactions.amount, minAmount));
    }
    if (maxAmount && typeof maxAmount === "string") {
      conditions.push(lte(transactions.amount, maxAmount));
    }

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const allTransactions = await db
      .select({
        transaction: transactions,
        user: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
        },
        plan: {
          id: plans.id,
          name: plans.name,
          price: plans.annualPrice,
          monthlyPrice: plans.monthlyPrice,
          permissions: plans.permissions,
          features: plans.features,
        },
        provider: {
          id: paymentProviders.id,
          name: paymentProviders.name,
          providerKey: paymentProviders.providerKey,
        },
      })
      .from(transactions)
      .leftJoin(users, eq(transactions.userId, users.id))
      .leftJoin(plans, eq(transactions.planId, plans.id))
      .leftJoin(
        paymentProviders,
        eq(transactions.paymentProviderId, paymentProviders.id)
      )
      .where(whereClause)
      .orderBy(desc(transactions.createdAt))
      .limit(limitNum)
      .offset(offset);

    const totalCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(transactions)
      .leftJoin(users, eq(transactions.userId, users.id))
      .where(whereClause);

    const totalCount = Number(totalCountResult[0]?.count || 0);

    res.status(200).json({
      success: true,
      data: allTransactions,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalCount,
        totalPages: Math.ceil(totalCount / limitNum),
      },
    });
  } catch (error) {
    console.error("Error fetching transactions:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching transactions",
      error,
    });
  }
};

export const getTransactionStats = async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;

    const conditions = [];
    if (startDate && typeof startDate === "string") {
      conditions.push(gte(transactions.createdAt, new Date(startDate)));
    }
    if (endDate && typeof endDate === "string") {
      conditions.push(lte(transactions.createdAt, new Date(endDate)));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const revenueResult = await db
      .select({
        total: sql<number>`SUM(CAST(${transactions.amount} AS DECIMAL))`,
      })
      .from(transactions)
      .where(
        whereClause
          ? and(whereClause, eq(transactions.status, "completed"))
          : eq(transactions.status, "completed")
      );

    const statusCounts = await db
      .select({
        status: transactions.status,
        count: sql<number>`count(*)`,
      })
      .from(transactions)
      .where(whereClause)
      .groupBy(transactions.status);

    const billingCycleRevenue = await db
      .select({
        billingCycle: transactions.billingCycle,
        total: sql<number>`SUM(CAST(${transactions.amount} AS DECIMAL))`,
      })
      .from(transactions)
      .where(
        whereClause
          ? and(whereClause, eq(transactions.status, "completed"))
          : eq(transactions.status, "completed")
      )
      .groupBy(transactions.billingCycle);

    res.status(200).json({
      success: true,
      data: {
        totalRevenue: Number(revenueResult[0]?.total || 0),
        statusCounts: statusCounts.map((s) => ({
          status: s.status,
          count: Number(s.count),
        })),
        billingCycleRevenue: billingCycleRevenue.map((b) => ({
          billingCycle: b.billingCycle,
          total: Number(b.total),
        })),
      },
    });
  } catch (error) {
    console.error("Error fetching transaction stats:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching transaction statistics",
      error,
    });
  }
};

export const getTransactionById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const transaction = await db
      .select({
        transaction: transactions,
        user: users,
        plan: plans,
        provider: paymentProviders,
      })
      .from(transactions)
      .leftJoin(users, eq(transactions.userId, users.id))
      .leftJoin(plans, eq(transactions.planId, plans.id))
      .leftJoin(
        paymentProviders,
        eq(transactions.paymentProviderId, paymentProviders.id)
      )
      .where(eq(transactions.id, id))
      .limit(1);

    if (!transaction || transaction.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
      });
    }

    res.status(200).json({
      success: true,
      data: transaction[0],
    });
  } catch (error) {
    console.error("Error fetching transaction:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching transaction",
      error,
    });
  }
};

export const exportTransactions = async (req: Request, res: Response) => {
  try {
    const allTransactions = await db
      .select({
        transaction: transactions,
        user: users,
        plan: plans,
        provider: paymentProviders,
      })
      .from(transactions)
      .where(ne(transactions.status, "pending"))
      .leftJoin(users, eq(transactions.userId, users.id))
      .leftJoin(plans, eq(transactions.planId, plans.id))
      .leftJoin(
        paymentProviders,
        eq(transactions.paymentProviderId, paymentProviders.id)
      )
      .orderBy(desc(transactions.createdAt));

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Transactions");

    worksheet.columns = [
      { header: "Transaction ID", key: "id", width: 25 },
      { header: "User Email", key: "userEmail", width: 30 },
      { header: "Plan", key: "planName", width: 20 },
      { header: "Provider", key: "provider", width: 20 },
      { header: "Amount", key: "amount", width: 15 },
      { header: "Currency", key: "currency", width: 10 },
      { header: "Billing Cycle", key: "billingCycle", width: 15 },
      { header: "Status", key: "status", width: 15 },
      { header: "Payment Method", key: "paymentMethod", width: 20 },
      { header: "Provider Txn ID", key: "providerTransactionId", width: 25 },
      { header: "Provider Order ID", key: "providerOrderId", width: 25 },
      { header: "Paid At", key: "paidAt", width: 25 },
      { header: "Created At", key: "createdAt", width: 25 },
    ];

    allTransactions.forEach((t) => {
      worksheet.addRow({
        id: t.transaction.id,
        userEmail: t.user?.email || "",
        planName: t.plan?.name || "",
        provider: t.provider?.name || "",
        amount: t.transaction.amount,
        currency: t.transaction.currency,
        billingCycle: t.transaction.billingCycle,
        status: t.transaction.status,
        paymentMethod: t.transaction.paymentMethod || "",
        providerTransactionId: t.transaction.providerTransactionId || "",
        providerOrderId: t.transaction.providerOrderId || "",
        paidAt: t.transaction.paidAt
          ? new Date(t.transaction.paidAt).toLocaleString()
          : "",
        createdAt: t.transaction.createdAt
          ? new Date(t.transaction.createdAt).toLocaleString()
          : "",
      });
    });

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF0078D4" },
    };
    headerRow.alignment = { horizontal: "center" };
    headerRow.border = {
      bottom: { style: "thin", color: { argb: "FF000000" } },
    };

    worksheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin", color: { argb: "FFCCCCCC" } },
          left: { style: "thin", color: { argb: "FFCCCCCC" } },
          bottom: { style: "thin", color: { argb: "FFCCCCCC" } },
          right: { style: "thin", color: { argb: "FFCCCCCC" } },
        };
        cell.alignment = { vertical: "middle", wrapText: true };
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=transactions_${
        new Date().toISOString().split("T")[0]
      }.xlsx`
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error("Error exporting transactions:", error);
    res.status(500).json({
      success: false,
      message: "Error exporting transactions",
      error,
    });
  }
};

export const getTransactionsByUserId = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const userTransactions = await db
      .select({
        transaction: transactions,
        plan: plans,
        provider: paymentProviders,
      })
      .from(transactions)
      .leftJoin(plans, eq(transactions.planId, plans.id))
      .leftJoin(
        paymentProviders,
        eq(transactions.paymentProviderId, paymentProviders.id)
      )
      .where(eq(transactions.userId, userId))
      .orderBy(desc(transactions.createdAt));

    res.status(200).json({ success: true, data: userTransactions });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching user transactions",
      error,
    });
  }
};

export const createTransaction = async (req: Request, res: Response) => {
  try {
    const {
      userId,
      planId,
      paymentProviderId,
      billingCycle,
      paymentMethod,
    } = req.body;

    const planData = await db.select().from(plans).where(eq(plans.id, planId));
    if (planData.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Plan not found" });
    }

    const provider = await db
      .select()
      .from(paymentProviders)
      .where(eq(paymentProviders.id, paymentProviderId));

    if (provider.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Payment provider not found" });
    }

    if (!provider[0].isActive) {
      return res
        .status(400)
        .json({ success: false, message: "Payment provider is not active" });
    }

    const plan = planData[0];
    const amount =
      billingCycle === "annual" ? plan.annualPrice : plan.monthlyPrice;

    const providerCurrencies = provider[0].supportedCurrencies;
    const dynamicCurrency = Array.isArray(providerCurrencies) && providerCurrencies.length > 0
      ? providerCurrencies[0]
      : (provider[0].config as any)?.currency || "USD";

    const newTransaction = await db
      .insert(transactions)
      .values({
        userId,
        planId,
        paymentProviderId,
        amount,
        currency: dynamicCurrency,
        billingCycle,
        status: "pending",
        paymentMethod,
        metadata: {},
      })
      .returning();

    res.status(201).json({
      success: true,
      message: "Transaction created successfully",
      data: newTransaction[0],
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Error creating transaction", error });
  }
};

export const updateTransactionStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      status,
      providerTransactionId,
      providerOrderId,
      providerPaymentId,
      metadata,
    } = req.body;

    const updateData: any = {
      status,
      updatedAt: new Date(),
    };

    if (providerTransactionId)
      updateData.providerTransactionId = providerTransactionId;
    if (providerOrderId) updateData.providerOrderId = providerOrderId;
    if (providerPaymentId) updateData.providerPaymentId = providerPaymentId;
    if (metadata) updateData.metadata = metadata;

    if (status === "completed") {
      updateData.paidAt = new Date();
    }

    if (status === "refunded") {
      updateData.refundedAt = new Date();
    }

    const updatedTransaction = await db
      .update(transactions)
      .set(updateData)
      .where(eq(transactions.id, id))
      .returning();

    if (updatedTransaction.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Transaction not found" });
    }

    res.status(200).json({
      success: true,
      message: "Transaction updated successfully",
      data: updatedTransaction[0],
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Error updating transaction", error });
  }
};

export const completeTransaction = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      providerTransactionId,
      providerOrderId,
      providerPaymentId,
      metadata,
    } = req.body;

    const transactionData = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, id));

    if (transactionData.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Transaction not found" });
    }

    const transaction = transactionData[0];

    const updatedTransaction = await db
      .update(transactions)
      .set({
        status: "completed",
        providerTransactionId,
        providerOrderId,
        providerPaymentId,
        metadata,
        paidAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, id))
      .returning();

    const startDate = new Date();
    const endDate = new Date();

    if (transaction.billingCycle === "annual") {
      endDate.setFullYear(endDate.getFullYear() + 1);
    } else {
      endDate.setMonth(endDate.getMonth() + 1);
    }

    const newSubscription = await db
      .insert(subscriptions)
      .values({
        userId: transaction.userId,
        planId: transaction.planId,
        status: "active",
        billingCycle: transaction.billingCycle,
        startDate,
        endDate,
        autoRenew: true,
      })
      .returning();

    await db
      .update(transactions)
      .set({ subscriptionId: newSubscription[0].id })
      .where(eq(transactions.id, id));

    res.status(200).json({
      success: true,
      message: "Transaction completed and subscription created successfully",
      data: {
        transaction: updatedTransaction[0],
        subscription: newSubscription[0],
      },
    });
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "Error completing transaction",
        error,
      });
  }
};

export const refundTransaction = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { refundReason } = req.body;

    const transactionData = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, id));

    if (transactionData.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Transaction not found" });
    }

    const transaction = transactionData[0];

    if (transaction.status !== "completed") {
      return res.status(400).json({
        success: false,
        message: "Only completed transactions can be refunded",
      });
    }

    const updatedTransaction = await db
      .update(transactions)
      .set({
        status: "refunded",
        refundedAt: new Date(),
        metadata: { ...transaction.metadata, refundReason },
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, id))
      .returning();

    if (transaction.subscriptionId) {
      await db
        .update(subscriptions)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(subscriptions.id, transaction.subscriptionId));
    }

    res.status(200).json({
      success: true,
      message: "Transaction refunded successfully",
      data: updatedTransaction[0],
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Error refunding transaction", error });
  }
};

export const initiatePayment = async (req: Request, res: Response) => {
  try {
    const {
      userId,
      planId,
      currency,
      paymentProviderId,
      billingCycle,
    } = req.body;

    const planData = await db.select().from(plans).where(eq(plans.id, planId));
    if (planData.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Plan not found" });
    }

    const providerData = await db
      .select()
      .from(paymentProviders)
      .where(eq(paymentProviders.id, paymentProviderId));

    if (providerData.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Payment provider not found" });
    }

    const provider = providerData[0];

    if (!provider.isActive) {
      return res
        .status(400)
        .json({ success: false, message: "Payment provider is not active" });
    }

    const plan = planData[0];
    const cycle = billingCycle === "annual" ? "annual" : "monthly";
    const amount =
      cycle === "annual" ? plan.annualPrice : plan.monthlyPrice;

    const provCurrencies = provider.supportedCurrencies;
    const resolvedCurrency = currency
      || (Array.isArray(provCurrencies) && provCurrencies.length > 0 ? provCurrencies[0] : null)
      || (provider.config as any)?.currency
      || "USD";

    const newTransaction = await db
      .insert(transactions)
      .values({
        userId,
        planId,
        paymentProviderId,
        amount,
        currency: resolvedCurrency,
        billingCycle: cycle,
        status: "pending",
        metadata: {},
      })
      .returning();

    const transaction = newTransaction[0];

    let paymentData: any;

    if (provider.providerKey === "stripe") {
      const result = await createStripeSubscription(userId, planId, cycle);

      await db
        .update(transactions)
        .set({
          providerTransactionId: result.subscriptionId,
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, transaction.id));

      const publishableKey = await getStripePublishableKey();

      paymentData = {
        subscriptionId: result.subscriptionId,
        clientSecret: result.clientSecret,
        publishableKey,
        gatewayStatus: result.status,
      };
    } else if (provider.providerKey === "razorpay") {
      const result = await createRazorpaySubscription(userId, planId, cycle);

      await db
        .update(transactions)
        .set({
          providerTransactionId: result.subscriptionId,
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, transaction.id));

      const keyId = await getRazorpayKeyId();

      paymentData = {
        subscriptionId: result.subscriptionId,
        shortUrl: result.shortUrl,
        keyId,
        gatewayStatus: result.status,
      };
    } else if (provider.providerKey === "paypal") {
      const result = await createPayPalSubscription(userId, planId, cycle);

      await db
        .update(transactions)
        .set({
          providerTransactionId: result.subscriptionId,
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, transaction.id));

      paymentData = {
        approvalUrl: result.approvalUrl,
        subscriptionId: result.subscriptionId,
        gatewayStatus: result.status,
      };
    } else if (provider.providerKey === "paystack") {
      const result = await createPaystackSubscription(userId, planId, cycle);

      await db
        .update(transactions)
        .set({
          providerTransactionId: result.reference,
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, transaction.id));

      const publicKey = await getPaystackPublicKey();

      paymentData = {
        authorizationUrl: result.authorizationUrl,
        reference: result.reference,
        publicKey,
      };
    } else if (provider.providerKey === "mercadopago") {
      const result = await createMercadoPagoSubscription(userId, planId, cycle);

      await db
        .update(transactions)
        .set({
          providerTransactionId: result.subscriptionId,
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, transaction.id));

      paymentData = {
        initPoint: result.initPoint,
        subscriptionId: result.subscriptionId,
        gatewayStatus: result.status,
      };
    } else {
      return res.status(400).json({
        success: false,
        message: "Unsupported payment provider",
      });
    }

    res.status(201).json({
      success: true,
      message: "Subscription payment initiated successfully",
      data: {
        transactionId: transaction.id,
        provider: provider.providerKey,
        amount,
        currency: transaction.currency,
        billingCycle: cycle,
        ...paymentData,
      },
    });
  } catch (error: any) {
    console.error("Error initiating payment:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Error initiating payment",
    });
  }
};

export const verifyRazorpayPayment = async (req: Request, res: Response) => {
  try {
    const {
      razorpay_subscription_id,
      razorpay_payment_id,
      razorpay_signature,
      transactionId,
    } = req.body;

    const providerData = await db
      .select()
      .from(paymentProviders)
      .where(eq(paymentProviders.providerKey, "razorpay"))
      .limit(1);

    if (providerData.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Razorpay provider not found" });
    }

    const provider = providerData[0];
    const secret =
      provider.config.apiSecret || process.env.RAZORPAY_KEY_SECRET;

    const generated_signature = crypto
      .createHmac("sha256", secret)
      .update(razorpay_payment_id + "|" + razorpay_subscription_id)
      .digest("hex");

    const transactionData = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, transactionId))
      .limit(1);

    if (transactionData.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
      });
    }

    const transaction = transactionData[0];

    if (generated_signature !== razorpay_signature) {
      await db
        .update(transactions)
        .set({
          status: "failed",
          metadata: { error: "Invalid signature" },
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, transactionId));

      return res.status(400).json({
        success: false,
        message: "Payment verification failed - Invalid signature",
      });
    }

    await db
      .update(transactions)
      .set({
        status: "completed",
        providerOrderId: razorpay_subscription_id,
        providerPaymentId: razorpay_payment_id,
        paidAt: new Date(),
        metadata: { verified: true },
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, transactionId));

    const planData = await db
      .select()
      .from(plans)
      .where(eq(plans.id, transaction.planId))
      .limit(1);

    if (planData.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Plan not found",
      });
    }

    const plan = planData[0];

    const startDate = new Date();
    const endDate = new Date();

    if (transaction.billingCycle === "monthly") {
      endDate.setMonth(endDate.getMonth() + 1);
    } else {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }

    await db
      .update(subscriptions)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(subscriptions.userId, transaction.userId),
          eq(subscriptions.status, "active")
        )
      );

    const newSubscription = await db
      .insert(subscriptions)
      .values({
        userId: transaction.userId,
        planId: transaction.planId,
        planData: {
          name: plan.name,
          description: plan.description,
          monthlyPrice: plan.monthlyPrice,
          annualPrice: plan.annualPrice,
          permissions: plan.permissions,
          features: plan.features,
        },
        status: "active",
        billingCycle: transaction.billingCycle,
        startDate,
        endDate,
        autoRenew: true,
        currency: transaction.currency || "INR",
        gatewaySubscriptionId: razorpay_subscription_id,
        gatewayProvider: "razorpay",
        gatewayStatus: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    await db
      .update(users)
      .set({ planId: transaction.planId, updatedAt: new Date() })
      .where(eq(users.id, transaction.userId));

    res.status(200).json({
      success: true,
      message: "Payment verified & subscription created successfully",
      data: {
        transactionId,
        subscription: newSubscription[0],
        subscriptionId: razorpay_subscription_id,
        paymentId: razorpay_payment_id,
      },
    });
  } catch (error) {
    console.error("Error verifying Razorpay payment:", error);
    res
      .status(500)
      .json({ success: false, message: "Error verifying payment", error });
  }
};

export const verifyStripePayment = async (req: Request, res: Response) => {
  try {
    const { subscription_id, payment_intent_id, transactionId } = req.body;

    if (!transactionId) {
      return res.status(400).json({
        success: false,
        message: "Missing required parameters",
      });
    }

    const stripe = await getStripe();
    if (!stripe) {
      return res.status(500).json({
        success: false,
        message: "Stripe is not configured",
      });
    }

    const transactionData = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, transactionId))
      .limit(1);

    if (!transactionData.length) {
      return res
        .status(404)
        .json({ success: false, message: "Transaction not found" });
    }

    const transaction = transactionData[0];

    const gatewaySubId =
      subscription_id || transaction.providerTransactionId;

    if (!gatewaySubId) {
      return res.status(400).json({
        success: false,
        message: "No subscription ID found",
      });
    }

    const stripeSub = (await stripe.subscriptions.retrieve(
      gatewaySubId
    )) as any;

    const isActive =
      stripeSub.status === "active" || stripeSub.status === "trialing";

    if (isActive) {
      await db
        .update(transactions)
        .set({
          status: "completed",
          providerTransactionId: gatewaySubId,
          providerPaymentId: payment_intent_id || null,
          paidAt: new Date(),
          metadata: { verified: true, stripeStatus: stripeSub.status },
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, transactionId));

      const planData = await db
        .select()
        .from(plans)
        .where(eq(plans.id, transaction.planId))
        .limit(1);

      if (!planData.length) {
        return res
          .status(404)
          .json({ success: false, message: "Plan not found" });
      }

      const plan = planData[0];

      const startDate = new Date(
        (stripeSub.current_period_start || 0) * 1000
      );
      const endDate = new Date((stripeSub.current_period_end || 0) * 1000);

      await db
        .update(subscriptions)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(
          and(
            eq(subscriptions.userId, transaction.userId),
            eq(subscriptions.status, "active")
          )
        );

      const newSubscription = await db
        .insert(subscriptions)
        .values({
          userId: transaction.userId,
          planId: transaction.planId,
          planData: {
            name: plan.name,
            description: plan.description,
            monthlyPrice: plan.monthlyPrice,
            annualPrice: plan.annualPrice,
            permissions: plan.permissions,
            features: plan.features,
          },
          status: "active",
          billingCycle: transaction.billingCycle,
          startDate,
          endDate,
          autoRenew: !stripeSub.cancel_at_period_end,
          currency: transaction.currency || "USD",
          gatewaySubscriptionId: gatewaySubId,
          gatewayProvider: "stripe",
          gatewayStatus: stripeSub.status,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      await db
        .update(users)
        .set({ planId: transaction.planId, updatedAt: new Date() })
        .where(eq(users.id, transaction.userId));

      return res.status(200).json({
        success: true,
        message: "Payment verified & subscription created successfully",
        data: {
          transactionId,
          subscriptionId: gatewaySubId,
          stripeStatus: stripeSub.status,
          subscription: newSubscription[0],
        },
      });
    } else {
      await db
        .update(transactions)
        .set({
          status:
            stripeSub.status === "incomplete" ? "pending" : "failed",
          metadata: {
            stripeStatus: stripeSub.status,
            error: "Subscription not active",
          },
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, transactionId));

      return res.status(400).json({
        success: false,
        message: "Subscription payment not completed",
        data: {
          stripeStatus: stripeSub.status,
        },
      });
    }
  } catch (error: any) {
    console.error("Error verifying Stripe payment:", error);
    res.status(500).json({
      success: false,
      message: "Error verifying payment",
      error: error.message || error,
    });
  }
};

export const verifyPayPalPayment = async (req: Request, res: Response) => {
  try {
    const { subscription_id, transactionId } = req.body;

    if (!transactionId && !subscription_id) {
      return res.status(400).json({
        success: false,
        message: "Missing required parameters (transactionId or subscription_id)",
      });
    }

    let transactionData;
    if (transactionId) {
      transactionData = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, transactionId))
        .limit(1);
    } else {
      transactionData = await db
        .select()
        .from(transactions)
        .where(eq(transactions.providerTransactionId, subscription_id))
        .limit(1);
    }

    if (!transactionData.length) {
      return res
        .status(404)
        .json({ success: false, message: "Transaction not found" });
    }

    const transaction = transactionData[0];

    const gatewaySubId = subscription_id || transaction.providerTransactionId;

    if (!gatewaySubId) {
      return res.status(400).json({
        success: false,
        message: "No PayPal subscription ID found",
      });
    }

    const { getPayPalSubscriptionStatus } = await import("../services/payment-gateway.service");
    const subStatus = await getPayPalSubscriptionStatus(gatewaySubId);

    const isActive = subStatus.status === "ACTIVE" || subStatus.status === "APPROVED";

    if (isActive) {
      await db
        .update(transactions)
        .set({
          status: "completed",
          providerTransactionId: gatewaySubId,
          paidAt: new Date(),
          metadata: { verified: true, paypalStatus: subStatus.status },
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, transaction.id));

      const planData = await db
        .select()
        .from(plans)
        .where(eq(plans.id, transaction.planId))
        .limit(1);

      if (!planData.length) {
        return res
          .status(404)
          .json({ success: false, message: "Plan not found" });
      }

      const plan = planData[0];

      const startDate = new Date();
      const endDate = new Date();

      if (transaction.billingCycle === "annual") {
        endDate.setFullYear(endDate.getFullYear() + 1);
      } else {
        endDate.setMonth(endDate.getMonth() + 1);
      }

      await db
        .update(subscriptions)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(
          and(
            eq(subscriptions.userId, transaction.userId),
            eq(subscriptions.status, "active")
          )
        );

      const newSubscription = await db
        .insert(subscriptions)
        .values({
          userId: transaction.userId,
          planId: transaction.planId,
          planData: {
            name: plan.name,
            description: plan.description,
            monthlyPrice: plan.monthlyPrice,
            annualPrice: plan.annualPrice,
            permissions: plan.permissions,
            features: plan.features,
          },
          status: "active",
          billingCycle: transaction.billingCycle,
          startDate,
          endDate,
          autoRenew: true,
          currency: transaction.currency || "USD",
          gatewaySubscriptionId: gatewaySubId,
          gatewayProvider: "paypal",
          gatewayStatus: subStatus.status,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      await db
        .update(users)
        .set({ planId: transaction.planId, updatedAt: new Date() })
        .where(eq(users.id, transaction.userId));

      return res.status(200).json({
        success: true,
        message: "Payment verified & subscription created successfully",
        data: {
          transactionId: transaction.id,
          subscriptionId: gatewaySubId,
          paypalStatus: subStatus.status,
          subscription: newSubscription[0],
        },
      });
    } else {
      await db
        .update(transactions)
        .set({
          status: "failed",
          metadata: {
            paypalStatus: subStatus.status,
            error: "Subscription not active",
          },
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, transaction.id));

      return res.status(400).json({
        success: false,
        message: "PayPal subscription payment not completed",
        data: { paypalStatus: subStatus.status },
      });
    }
  } catch (error: any) {
    console.error("Error verifying PayPal payment:", error);
    res.status(500).json({
      success: false,
      message: "Error verifying payment",
      error: error.message || error,
    });
  }
};

export const verifyPaystackPayment = async (req: Request, res: Response) => {
  try {
    const { reference, transactionId } = req.body;

    if (!transactionId && !reference) {
      return res.status(400).json({
        success: false,
        message: "Missing required parameters (transactionId or reference)",
      });
    }

    let transactionData;
    if (transactionId) {
      transactionData = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, transactionId))
        .limit(1);
    } else {
      transactionData = await db
        .select()
        .from(transactions)
        .where(eq(transactions.providerTransactionId, reference))
        .limit(1);
    }

    if (!transactionData.length) {
      return res
        .status(404)
        .json({ success: false, message: "Transaction not found" });
    }

    const transaction = transactionData[0];

    const verifyReference = reference || transaction.providerTransactionId;

    const providerData = await db
      .select()
      .from(paymentProviders)
      .where(eq(paymentProviders.providerKey, "paystack"))
      .limit(1);

    if (!providerData.length) {
      return res
        .status(404)
        .json({ success: false, message: "Paystack provider not found" });
    }

    const provider = providerData[0];
    const secretKey =
      provider.config?.apiSecret ||
      provider.config?.apiSecretTest;

    if (!secretKey) {
      return res.status(500).json({
        success: false,
        message: "Paystack secret key not configured",
      });
    }

    const verifyResponse = await fetch(
      `https://api.paystack.co/transaction/verify/${verifyReference}`,
      {
        headers: {
          Authorization: `Bearer ${secretKey}`,
        },
      }
    );

    const verifyData = await verifyResponse.json() as any;

    if (!verifyData.status || verifyData.data?.status !== "success") {
      await db
        .update(transactions)
        .set({
          status: "failed",
          metadata: {
            paystackStatus: verifyData.data?.status,
            error: "Payment verification failed",
          },
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, transaction.id));

      return res.status(400).json({
        success: false,
        message: "Paystack payment verification failed",
        data: { paystackStatus: verifyData.data?.status },
      });
    }

    const paystackData = verifyData.data;

    await db
      .update(transactions)
      .set({
        status: "completed",
        providerTransactionId: String(paystackData.id),
        providerOrderId: paystackData.reference,
        paidAt: new Date(),
        metadata: { verified: true, paystackStatus: paystackData.status },
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, transaction.id));

    const planData = await db
      .select()
      .from(plans)
      .where(eq(plans.id, transaction.planId))
      .limit(1);

    if (!planData.length) {
      return res
        .status(404)
        .json({ success: false, message: "Plan not found" });
    }

    const plan = planData[0];

    const startDate = new Date();
    const endDate = new Date();

    if (transaction.billingCycle === "annual") {
      endDate.setFullYear(endDate.getFullYear() + 1);
    } else {
      endDate.setMonth(endDate.getMonth() + 1);
    }

    await db
      .update(subscriptions)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(subscriptions.userId, transaction.userId),
          eq(subscriptions.status, "active")
        )
      );

    const subscriptionCode = paystackData.authorization?.authorization_code || verifyReference;

    const newSubscription = await db
      .insert(subscriptions)
      .values({
        userId: transaction.userId,
        planId: transaction.planId,
        planData: {
          name: plan.name,
          description: plan.description,
          monthlyPrice: plan.monthlyPrice,
          annualPrice: plan.annualPrice,
          permissions: plan.permissions,
          features: plan.features,
        },
        status: "active",
        billingCycle: transaction.billingCycle,
        startDate,
        endDate,
        autoRenew: true,
        currency: transaction.currency || "NGN",
        gatewaySubscriptionId: subscriptionCode,
        gatewayProvider: "paystack",
        gatewayStatus: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    await db
      .update(users)
      .set({ planId: transaction.planId, updatedAt: new Date() })
      .where(eq(users.id, transaction.userId));

    return res.status(200).json({
      success: true,
      message: "Payment verified & subscription created successfully",
      data: {
        transactionId: transaction.id,
        reference: verifyReference,
        subscription: newSubscription[0],
      },
    });
  } catch (error: any) {
    console.error("Error verifying Paystack payment:", error);
    res.status(500).json({
      success: false,
      message: "Error verifying payment",
      error: error.message || error,
    });
  }
};

export const verifyMercadoPagoPayment = async (req: Request, res: Response) => {
  try {
    const { preapproval_id, transactionId } = req.body;

    if (!transactionId && !preapproval_id) {
      return res.status(400).json({
        success: false,
        message: "Missing required parameters (transactionId or preapproval_id)",
      });
    }

    let transactionData;
    if (transactionId) {
      transactionData = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, transactionId))
        .limit(1);
    } else {
      transactionData = await db
        .select()
        .from(transactions)
        .where(eq(transactions.providerTransactionId, preapproval_id))
        .limit(1);
    }

    if (!transactionData.length) {
      return res
        .status(404)
        .json({ success: false, message: "Transaction not found" });
    }

    const transaction = transactionData[0];

    const gatewaySubId = preapproval_id || transaction.providerTransactionId;

    if (!gatewaySubId) {
      return res.status(400).json({
        success: false,
        message: "No Mercado Pago subscription ID found",
      });
    }

    const { getMercadoPagoSubscriptionStatus } = await import("../services/payment-gateway.service");
    const subStatus = await getMercadoPagoSubscriptionStatus(gatewaySubId);

    const isActive = subStatus.status === "authorized" || subStatus.status === "pending";

    if (isActive) {
      await db
        .update(transactions)
        .set({
          status: "completed",
          providerTransactionId: gatewaySubId,
          paidAt: new Date(),
          metadata: { verified: true, mercadopagoStatus: subStatus.status },
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, transaction.id));

      const planData = await db
        .select()
        .from(plans)
        .where(eq(plans.id, transaction.planId))
        .limit(1);

      if (!planData.length) {
        return res
          .status(404)
          .json({ success: false, message: "Plan not found" });
      }

      const plan = planData[0];

      const startDate = new Date();
      const endDate = new Date();

      if (transaction.billingCycle === "annual") {
        endDate.setFullYear(endDate.getFullYear() + 1);
      } else {
        endDate.setMonth(endDate.getMonth() + 1);
      }

      await db
        .update(subscriptions)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(
          and(
            eq(subscriptions.userId, transaction.userId),
            eq(subscriptions.status, "active")
          )
        );

      const newSubscription = await db
        .insert(subscriptions)
        .values({
          userId: transaction.userId,
          planId: transaction.planId,
          planData: {
            name: plan.name,
            description: plan.description,
            monthlyPrice: plan.monthlyPrice,
            annualPrice: plan.annualPrice,
            permissions: plan.permissions,
            features: plan.features,
          },
          status: "active",
          billingCycle: transaction.billingCycle,
          startDate,
          endDate,
          autoRenew: true,
          currency: transaction.currency || "BRL",
          gatewaySubscriptionId: gatewaySubId,
          gatewayProvider: "mercadopago",
          gatewayStatus: subStatus.status,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      await db
        .update(users)
        .set({ planId: transaction.planId, updatedAt: new Date() })
        .where(eq(users.id, transaction.userId));

      return res.status(200).json({
        success: true,
        message: "Payment verified & subscription created successfully",
        data: {
          transactionId: transaction.id,
          subscriptionId: gatewaySubId,
          mercadopagoStatus: subStatus.status,
          subscription: newSubscription[0],
        },
      });
    } else {
      await db
        .update(transactions)
        .set({
          status: "failed",
          metadata: {
            mercadopagoStatus: subStatus.status,
            error: "Subscription not active",
          },
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, transaction.id));

      return res.status(400).json({
        success: false,
        message: "Mercado Pago subscription payment not completed",
        data: { mercadopagoStatus: subStatus.status },
      });
    }
  } catch (error: any) {
    console.error("Error verifying Mercado Pago payment:", error);
    res.status(500).json({
      success: false,
      message: "Error verifying payment",
      error: error.message || error,
    });
  }
};

export const getPaymentStatus = async (req: Request, res: Response) => {
  try {
    const { transactionId } = req.params;

    const transactionData = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, transactionId));

    if (transactionData.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Transaction not found" });
    }

    const transaction = transactionData[0];

    res.status(200).json({
      success: true,
      data: {
        transactionId: transaction.id,
        status: transaction.status,
        amount: transaction.amount,
        currency: transaction.currency,
        paidAt: transaction.paidAt,
        createdAt: transaction.createdAt,
      },
    });
  } catch (error) {
    console.error("Error fetching payment status:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching payment status",
      error,
    });
  }
};
