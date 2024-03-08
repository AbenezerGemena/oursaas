import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import {
  getAllProviders,
  getActiveProviders,
  getProviderById,
  getProviderByKey,
  createProvider,
  updateProvider,
  toggleProviderStatus,
  deleteProvider,
  getCurrencyGatewayMap,
} from "../controllers/payment.providers.controller";

import {
  getAllTransactions,
  getTransactionById,
  getTransactionsByUserId,
  createTransaction,
  updateTransactionStatus,
  completeTransaction,
  refundTransaction,
  initiatePayment,
  verifyRazorpayPayment,
  verifyStripePayment,
  verifyPayPalPayment,
  verifyPaystackPayment,
  verifyMercadoPagoPayment,
  getPaymentStatus,
  getTransactionStats,
  exportTransactions,
} from "../controllers/transactions.controller";

import {
  getAllSubscriptions,
  getSubscriptionById,
  getSubscriptionsByUserId,
  getActiveSubscriptionByUserId,
  createSubscription,
  updateSubscription,
  cancelSubscription,
  renewSubscription,
  toggleAutoRenew,
  checkExpiredSubscriptions,
  changePlan,
} from "../controllers/subscriptions.controller";
import type { Express } from "express";

export function registerPaymentsRoutes(app: Express) {
  

  
  app.get("/api/payment-providers", getAllProviders);

  
  app.get("/api/payment-providers/active", getActiveProviders);

  
  app.get("/api/payment-providers/currency-map", getCurrencyGatewayMap);

  
  app.get("/api/payment-providers/:id", getProviderById);

  
  app.get("/api/payment-providers/key/:key", getProviderByKey);

  
  app.post("/api/payment-providers", createProvider);

  
  app.put("/api/payment-providers/:id", updateProvider);

  
  app.patch("/api/payment-providers/:id/toggle-status", toggleProviderStatus);

  
  app.delete("/api/payment-providers/:id", deleteProvider);

  

  
  app.get("/api/transactions", getAllTransactions);

  app.get("/api/transactions/stats", getTransactionStats);

  app.get("/api/transactions/export", exportTransactions);

  
  app.get("/api/transactions/:id", getTransactionById);

  
  app.get("/api/transactions/user/:userId", getTransactionsByUserId);

  
  app.post("/api/transactions", createTransaction);

  
  app.patch("/api/transactions/:id/status", updateTransactionStatus);

  
  app.post("/api/transactions/:id/complete", completeTransaction);

  
  app.post("/api/transactions/:id/refund", refundTransaction);

  app.post("/api/payment/initiate", initiatePayment);

  
  app.post("/api/payment/verify/razorpay", verifyRazorpayPayment);

  
  app.post("/api/payment/verify/stripe", verifyStripePayment);

  
  app.post("/api/payment/verify/paypal", verifyPayPalPayment);

  
  app.post("/api/payment/verify/paystack", verifyPaystackPayment);

  
  app.post("/api/payment/verify/mercadopago", verifyMercadoPagoPayment);

  
  app.get("/api/payment/status/:transactionId", getPaymentStatus);

  

  
  app.get("/api/subscriptions", getAllSubscriptions);

  
  app.get("/api/subscriptions/:id", getSubscriptionById);

  
  app.get("/api/subscriptions/user/:userId", getSubscriptionsByUserId);

  
  app.get(
    "/api/subscriptions/user/:userId/active",
    getActiveSubscriptionByUserId
  );

  
  app.post("/api/subscriptions", createSubscription);

  
  app.put("/api/subscriptions/:id", updateSubscription);

  
  app.patch("/api/subscriptions/:id/cancel", cancelSubscription);

  
  app.post("/api/subscriptions/:id/renew", renewSubscription);

  
  app.patch("/api/subscriptions/:id/auto-renew", toggleAutoRenew);

  
  app.post("/api/subscriptions/change-plan", changePlan);

  
  app.post("/api/subscriptions/check-expired", checkExpiredSubscriptions);
}
