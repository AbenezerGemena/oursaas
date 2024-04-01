import Stripe from "stripe";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import Razorpay from "razorpay";
import axios from "axios";
import { db } from "../db";
import { plans, users, subscriptions, paymentProviders } from "@shared/schema";
import { eq, and } from "drizzle-orm";

let stripeInstance: Stripe | null = null;
let razorpayInstance: Razorpay | null = null;
let paypalAccessToken: { token: string; expiresAt: number } | null = null;

async function getProviderConfig(providerKey: string) {
  const result = await db
    .select()
    .from(paymentProviders)
    .where(
      and(
        eq(paymentProviders.providerKey, providerKey),
        eq(paymentProviders.isActive, true)
      )
    )
    .limit(1);
  return result[0] || null;
}

export async function getStripe(): Promise<Stripe | null> {
  if (stripeInstance) return stripeInstance;
  const provider = await getProviderConfig("stripe");
  const secretKey =
    provider?.config?.apiSecret ||
    provider?.config?.apiSecretTest ||
    process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;
  stripeInstance = new Stripe(secretKey);
  return stripeInstance;
}

export async function getRazorpay(): Promise<Razorpay | null> {
  if (razorpayInstance) return razorpayInstance;
  const provider = await getProviderConfig("razorpay");
  const keyId =
    provider?.config?.apiKey ||
    provider?.config?.apiKeyTest ||
    process.env.RAZORPAY_KEY_ID;
  const keySecret =
    provider?.config?.apiSecret ||
    provider?.config?.apiSecretTest ||
    process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return null;
  razorpayInstance = new Razorpay({ key_id: keyId, key_secret: keySecret });
  return razorpayInstance;
}

export function resetGatewayInstances() {
  stripeInstance = null;
  razorpayInstance = null;
  paypalAccessToken = null;
}

async function getProviderCurrency(providerKey: string, fallback: string): Promise<string> {
  const provider = await getProviderConfig(providerKey);
  const currencies = provider?.supportedCurrencies;
  if (Array.isArray(currencies) && currencies.length > 0) {
    return currencies[0].toLowerCase();
  }
  return (provider?.config?.currency || fallback).toLowerCase();
}

export async function syncPlanToStripe(planId: string) {
  const stripe = await getStripe();
  if (!stripe) throw new Error("Stripe is not configured or inactive");

  const planData = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
  if (!planData.length) throw new Error("Plan not found");
  const plan = planData[0];

  const currency = await getProviderCurrency("stripe", "usd");

  let productId = plan.stripeProductId;

  if (productId) {
    await stripe.products.update(productId, {
      name: plan.name,
      description: plan.description || undefined,
    });
  } else {
    const product = await stripe.products.create({
      name: plan.name,
      description: plan.description || undefined,
      metadata: { platformPlanId: plan.id },
    });
    productId = product.id;
  }

  const monthlyAmount = Math.round(parseFloat(plan.monthlyPrice || "0") * 100);
  const annualAmount = Math.round(parseFloat(plan.annualPrice || "0") * 100);

  let monthlyPriceId = plan.stripePriceIdMonthly;
  let annualPriceId = plan.stripePriceIdAnnual;

  if (monthlyAmount > 0) {
    if (monthlyPriceId) {
      try {
        const existingPrice = await stripe.prices.retrieve(monthlyPriceId);
        if (
          existingPrice.unit_amount !== monthlyAmount ||
          existingPrice.recurring?.interval !== "month"
        ) {
          await stripe.prices.update(monthlyPriceId, { active: false });
          monthlyPriceId = null;
        }
      } catch {
        monthlyPriceId = null;
      }
    }
    if (!monthlyPriceId) {
      const price = await stripe.prices.create({
        product: productId,
        unit_amount: monthlyAmount,
        currency,
        recurring: { interval: "month" },
        metadata: { platformPlanId: plan.id, cycle: "monthly" },
      });
      monthlyPriceId = price.id;
    }
  }

  if (annualAmount > 0) {
    if (annualPriceId) {
      try {
        const existingPrice = await stripe.prices.retrieve(annualPriceId);
        if (
          existingPrice.unit_amount !== annualAmount ||
          existingPrice.recurring?.interval !== "year"
        ) {
          await stripe.prices.update(annualPriceId, { active: false });
          annualPriceId = null;
        }
      } catch {
        annualPriceId = null;
      }
    }
    if (!annualPriceId) {
      const price = await stripe.prices.create({
        product: productId,
        unit_amount: annualAmount,
        currency,
        recurring: { interval: "year" },
        metadata: { platformPlanId: plan.id, cycle: "annual" },
      });
      annualPriceId = price.id;
    }
  }

  await db
    .update(plans)
    .set({
      stripeProductId: productId,
      stripePriceIdMonthly: monthlyPriceId,
      stripePriceIdAnnual: annualPriceId,
      updatedAt: new Date(),
    })
    .where(eq(plans.id, planId));

  return { productId, monthlyPriceId, annualPriceId };
}

export async function syncPlanToRazorpay(planId: string) {
  const razorpay = await getRazorpay();
  if (!razorpay) throw new Error("Razorpay is not configured or inactive");

  const planData = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
  if (!planData.length) throw new Error("Plan not found");
  const plan = planData[0];

  const currency = (await getProviderCurrency("razorpay", "INR")).toUpperCase();

  const monthlyAmount = Math.round(parseFloat(plan.monthlyPrice || "0") * 100);
  const annualAmount = Math.round(parseFloat(plan.annualPrice || "0") * 100);

  let monthlyRzpPlanId = plan.razorpayPlanIdMonthly;
  let annualRzpPlanId = plan.razorpayPlanIdAnnual;

  if (monthlyAmount > 0 && !monthlyRzpPlanId) {
    const rzpPlan = await razorpay.plans.create({
      period: "monthly",
      interval: 1,
      item: {
        name: `${plan.name} - Monthly`,
        amount: monthlyAmount,
        currency,
      },
      notes: { platformPlanId: plan.id, cycle: "monthly" },
    });
    monthlyRzpPlanId = rzpPlan.id;
  }

  if (annualAmount > 0 && !annualRzpPlanId) {
    const rzpPlan = await razorpay.plans.create({
      period: "yearly",
      interval: 1,
      item: {
        name: `${plan.name} - Annual`,
        amount: annualAmount,
        currency,
      },
      notes: { platformPlanId: plan.id, cycle: "annual" },
    });
    annualRzpPlanId = rzpPlan.id;
  }

  await db
    .update(plans)
    .set({
      razorpayPlanIdMonthly: monthlyRzpPlanId,
      razorpayPlanIdAnnual: annualRzpPlanId,
      updatedAt: new Date(),
    })
    .where(eq(plans.id, planId));

  return { monthlyRzpPlanId, annualRzpPlanId };
}

export async function syncPlanToAllGateways(planId: string) {
  const results: { stripe?: any; razorpay?: any; paypal?: any; paystack?: any; mercadopago?: any; errors: string[] } = { errors: [] };

  try {
    results.stripe = await syncPlanToStripe(planId);
  } catch (err: any) {
    results.errors.push(`Stripe: ${err.message}`);
  }

  try {
    results.razorpay = await syncPlanToRazorpay(planId);
  } catch (err: any) {
    results.errors.push(`Razorpay: ${err.message}`);
  }

  try {
    results.paypal = await syncPlanToPayPal(planId);
  } catch (err: any) {
    results.errors.push(`PayPal: ${err.message}`);
  }

  try {
    results.paystack = await syncPlanToPaystack(planId);
  } catch (err: any) {
    results.errors.push(`Paystack: ${err.message}`);
  }

  try {
    results.mercadopago = await syncPlanToMercadoPago(planId);
  } catch (err: any) {
    results.errors.push(`Mercado Pago: ${err.message}`);
  }

  return results;
}

export async function getOrCreateStripeCustomer(userId: string): Promise<string> {
  const stripe = await getStripe();
  if (!stripe) throw new Error("Stripe is not configured");

  const userData = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!userData.length) throw new Error("User not found");
  const user = userData[0];

  if (user.stripeCustomerId) {
    try {
      await stripe.customers.retrieve(user.stripeCustomerId);
      return user.stripeCustomerId;
    } catch {
      
    }
  }

  const customer = await stripe.customers.create({
    email: user.email,
    name: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username,
    metadata: { platformUserId: user.id },
  });

  await db
    .update(users)
    .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
    .where(eq(users.id, userId));

  return customer.id;
}

export async function getOrCreateRazorpayCustomer(userId: string): Promise<string> {
  const razorpay = await getRazorpay();
  if (!razorpay) throw new Error("Razorpay is not configured");

  const userData = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!userData.length) throw new Error("User not found");
  const user = userData[0];

  if (user.razorpayCustomerId) return user.razorpayCustomerId;

  const customer = await (razorpay as any).customers.create({
    name: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username,
    email: user.email,
    notes: { platformUserId: user.id },
  });

  await db
    .update(users)
    .set({ razorpayCustomerId: customer.id, updatedAt: new Date() })
    .where(eq(users.id, userId));

  return customer.id;
}

export async function createStripeSubscription(
  userId: string,
  planId: string,
  billingCycle: "monthly" | "annual"
) {
  const stripe = await getStripe();
  if (!stripe) throw new Error("Stripe is not configured");

  const planData = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
  if (!planData.length) throw new Error("Plan not found");
  const plan = planData[0];

  const priceId =
    billingCycle === "annual" ? plan.stripePriceIdAnnual : plan.stripePriceIdMonthly;
  if (!priceId) {
    throw new Error(
      `Plan "${plan.name}" has no Stripe price for ${billingCycle} cycle. Please sync the plan to Stripe first.`
    );
  }

  const customerId = await getOrCreateStripeCustomer(userId);

  const existingSubs = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        eq(subscriptions.status, "active"),
        eq(subscriptions.gatewayProvider, "stripe")
      )
    );

  for (const sub of existingSubs) {
    if (sub.gatewaySubscriptionId) {
      try {
        await stripe.subscriptions.cancel(sub.gatewaySubscriptionId, {
          prorate: true,
        });
      } catch {}
    }
    await db
      .update(subscriptions)
      .set({ status: "cancelled", gatewayStatus: "canceled", updatedAt: new Date() })
      .where(eq(subscriptions.id, sub.id));
  }

  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    payment_behavior: "default_incomplete",
    payment_settings: { save_default_payment_method: "on_subscription" },
    expand: ["latest_invoice.payment_intent"],
    metadata: { platformUserId: userId, platformPlanId: planId },
  });

  const invoice = subscription.latest_invoice as any;
  const paymentIntent = invoice?.payment_intent as any;

  return {
    subscriptionId: subscription.id,
    clientSecret: paymentIntent?.client_secret || null,
    status: subscription.status,
  };
}

export async function createRazorpaySubscription(
  userId: string,
  planId: string,
  billingCycle: "monthly" | "annual"
) {
  const razorpay = await getRazorpay();
  if (!razorpay) throw new Error("Razorpay is not configured");

  const planData = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
  if (!planData.length) throw new Error("Plan not found");
  const plan = planData[0];

  const rzpPlanId =
    billingCycle === "annual" ? plan.razorpayPlanIdAnnual : plan.razorpayPlanIdMonthly;
  if (!rzpPlanId) {
    throw new Error(
      `Plan "${plan.name}" has no Razorpay plan for ${billingCycle} cycle. Please sync the plan to Razorpay first.`
    );
  }

  const existingSubs = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        eq(subscriptions.status, "active"),
        eq(subscriptions.gatewayProvider, "razorpay")
      )
    );

  for (const sub of existingSubs) {
    if (sub.gatewaySubscriptionId) {
      try {
        await razorpay.subscriptions.cancel(sub.gatewaySubscriptionId);
      } catch {}
    }
    await db
      .update(subscriptions)
      .set({ status: "cancelled", gatewayStatus: "cancelled", updatedAt: new Date() })
      .where(eq(subscriptions.id, sub.id));
  }

  const subscription = await razorpay.subscriptions.create({
    plan_id: rzpPlanId,
    total_count: billingCycle === "annual" ? 10 : 120,
    customer_notify: 1,
    notes: { platformUserId: userId, platformPlanId: planId },
  });

  return {
    subscriptionId: subscription.id,
    shortUrl: (subscription as any).short_url || null,
    status: subscription.status,
  };
}

export async function upgradeOrDowngradeStripe(
  subscriptionGatewayId: string,
  newPlanId: string,
  billingCycle: "monthly" | "annual"
) {
  const stripe = await getStripe();
  if (!stripe) throw new Error("Stripe is not configured");

  const planData = await db.select().from(plans).where(eq(plans.id, newPlanId)).limit(1);
  if (!planData.length) throw new Error("Plan not found");
  const plan = planData[0];

  const newPriceId =
    billingCycle === "annual" ? plan.stripePriceIdAnnual : plan.stripePriceIdMonthly;
  if (!newPriceId) {
    throw new Error(
      `Plan "${plan.name}" has no Stripe price for ${billingCycle} cycle. Please sync the plan first.`
    );
  }

  const existingSub = await stripe.subscriptions.retrieve(subscriptionGatewayId);

  const updated = await stripe.subscriptions.update(subscriptionGatewayId, {
    items: [
      {
        id: existingSub.items.data[0].id,
        price: newPriceId,
      },
    ],
    proration_behavior: "create_prorations",
    metadata: { platformPlanId: newPlanId },
  });

  return {
    subscriptionId: updated.id,
    status: updated.status,
    currentPeriodEnd: new Date(((updated as any).current_period_end || 0) * 1000),
  };
}

export async function upgradeOrDowngradeRazorpay(
  userId: string,
  oldSubscriptionGatewayId: string,
  newPlanId: string,
  billingCycle: "monthly" | "annual"
) {
  const razorpay = await getRazorpay();
  if (!razorpay) throw new Error("Razorpay is not configured");

  try {
    await razorpay.subscriptions.cancel(oldSubscriptionGatewayId);
  } catch {}

  const result = await createRazorpaySubscription(userId, newPlanId, billingCycle);
  return result;
}

export async function cancelStripeSubscription(
  gatewaySubscriptionId: string,
  immediately: boolean = false
) {
  const stripe = await getStripe();
  if (!stripe) throw new Error("Stripe is not configured");

  if (immediately) {
    const cancelled = await stripe.subscriptions.cancel(gatewaySubscriptionId);
    return { status: cancelled.status, canceledAt: new Date() };
  } else {
    const updated = await stripe.subscriptions.update(gatewaySubscriptionId, {
      cancel_at_period_end: true,
    });
    return {
      status: updated.status,
      cancelAtPeriodEnd: true,
      currentPeriodEnd: new Date(((updated as any).current_period_end || 0) * 1000),
    };
  }
}

export async function cancelRazorpaySubscription(
  gatewaySubscriptionId: string,
  immediately: boolean = false
) {
  const razorpay = await getRazorpay();
  if (!razorpay) throw new Error("Razorpay is not configured");

  if (immediately) {
    const cancelled = await razorpay.subscriptions.cancel(gatewaySubscriptionId);
    return { status: (cancelled as any).status || "cancelled" };
  } else {
    const cancelled = await razorpay.subscriptions.cancel(gatewaySubscriptionId, {
      cancel_at_cycle_end: 1,
    } as any);
    return { status: (cancelled as any).status || "cancelled", cancelAtPeriodEnd: true };
  }
}

export async function getStripeSubscriptionStatus(gatewaySubscriptionId: string) {
  const stripe = await getStripe();
  if (!stripe) throw new Error("Stripe is not configured");

  const sub = await stripe.subscriptions.retrieve(gatewaySubscriptionId) as any;
  return {
    status: sub.status,
    currentPeriodStart: new Date((sub.current_period_start || 0) * 1000),
    currentPeriodEnd: new Date((sub.current_period_end || 0) * 1000),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  };
}

export async function getRazorpaySubscriptionStatus(gatewaySubscriptionId: string) {
  const razorpay = await getRazorpay();
  if (!razorpay) throw new Error("Razorpay is not configured");

  const sub = await razorpay.subscriptions.fetch(gatewaySubscriptionId);
  return {
    status: sub.status,
    currentStart: sub.current_start ? new Date(sub.current_start * 1000) : null,
    currentEnd: sub.current_end ? new Date(sub.current_end * 1000) : null,
  };
}

export async function getStripePublishableKey(): Promise<string | null> {
  const provider = await getProviderConfig("stripe");
  return (
    provider?.config?.publicKey ||
    provider?.config?.apiKeyTest ||
    provider?.config?.apiKey ||
    process.env.STRIPE_PUBLISHABLE_KEY ||
    null
  );
}

export async function getRazorpayKeyId(): Promise<string | null> {
  const provider = await getProviderConfig("razorpay");
  return (
    provider?.config?.apiKey ||
    provider?.config?.apiKeyTest ||
    process.env.RAZORPAY_KEY_ID ||
    null
  );
}

async function getPayPalBaseUrl(): Promise<string> {
  const provider = await getProviderConfig("paypal");
  const isLive = provider?.config?.isLive === true;
  return isLive
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

async function getPayPalAccessToken(): Promise<string> {
  if (paypalAccessToken && Date.now() < paypalAccessToken.expiresAt) {
    return paypalAccessToken.token;
  }

  const provider = await getProviderConfig("paypal");
  if (!provider) throw new Error("PayPal is not configured or inactive");

  const clientId = provider.config?.isLive
    ? provider.config?.apiKey
    : provider.config?.apiKeyTest || provider.config?.apiKey;
  const clientSecret = provider.config?.isLive
    ? provider.config?.apiSecret
    : provider.config?.apiSecretTest || provider.config?.apiSecret;

  if (!clientId || !clientSecret) throw new Error("PayPal credentials not configured");

  const baseUrl = await getPayPalBaseUrl();
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await axios.post(
    `${baseUrl}/v1/oauth2/token`,
    "grant_type=client_credentials",
    {
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  paypalAccessToken = {
    token: response.data.access_token,
    expiresAt: Date.now() + (response.data.expires_in - 60) * 1000,
  };

  return paypalAccessToken.token;
}

async function paypalRequest(method: string, path: string, data?: any) {
  const token = await getPayPalAccessToken();
  const baseUrl = await getPayPalBaseUrl();
  const response = await axios({
    method,
    url: `${baseUrl}${path}`,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    data,
  });
  return response.data;
}

export async function getPayPalPublicClientId(): Promise<string | null> {
  const provider = await getProviderConfig("paypal");
  if (!provider) return null;
  return provider.config?.isLive
    ? provider.config?.apiKey || null
    : provider.config?.apiKeyTest || provider.config?.apiKey || null;
}

export async function syncPlanToPayPal(planId: string) {
  const provider = await getProviderConfig("paypal");
  if (!provider) throw new Error("PayPal is not configured or inactive");

  const planData = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
  if (!planData.length) throw new Error("Plan not found");
  const plan = planData[0];

  const currency = (await getProviderCurrency("paypal", "USD")).toUpperCase();

  let productId = plan.paypalProductId;
  if (!productId) {
    const product = await paypalRequest("POST", "/v1/catalogs/products", {
      name: plan.name,
      description: plan.description || `${plan.name} subscription plan`,
      type: "SERVICE",
      category: "SOFTWARE",
    });
    productId = product.id;
  }

  let monthlyPlanId = plan.paypalPlanIdMonthly;
  let annualPlanId = plan.paypalPlanIdAnnual;

  const monthlyAmount = parseFloat(plan.monthlyPrice || "0");
  const annualAmount = parseFloat(plan.annualPrice || "0");

  if (monthlyAmount > 0 && !monthlyPlanId) {
    const billingPlan = await paypalRequest("POST", "/v1/billing/plans", {
      product_id: productId,
      name: `${plan.name} - Monthly`,
      billing_cycles: [
        {
          frequency: { interval_unit: "MONTH", interval_count: 1 },
          tenure_type: "REGULAR",
          sequence: 1,
          total_cycles: 0,
          pricing_scheme: {
            fixed_price: { value: monthlyAmount.toFixed(2), currency_code: currency },
          },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding: true,
        payment_failure_threshold: 3,
      },
    });
    monthlyPlanId = billingPlan.id;
  }

  if (annualAmount > 0 && !annualPlanId) {
    const billingPlan = await paypalRequest("POST", "/v1/billing/plans", {
      product_id: productId,
      name: `${plan.name} - Annual`,
      billing_cycles: [
        {
          frequency: { interval_unit: "YEAR", interval_count: 1 },
          tenure_type: "REGULAR",
          sequence: 1,
          total_cycles: 0,
          pricing_scheme: {
            fixed_price: { value: annualAmount.toFixed(2), currency_code: currency },
          },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding: true,
        payment_failure_threshold: 3,
      },
    });
    annualPlanId = billingPlan.id;
  }

  await db
    .update(plans)
    .set({
      paypalProductId: productId,
      paypalPlanIdMonthly: monthlyPlanId,
      paypalPlanIdAnnual: annualPlanId,
      updatedAt: new Date(),
    })
    .where(eq(plans.id, planId));

  return { productId, monthlyPlanId, annualPlanId };
}

export async function createPayPalSubscription(
  userId: string,
  planId: string,
  billingCycle: "monthly" | "annual"
) {
  const provider = await getProviderConfig("paypal");
  if (!provider) throw new Error("PayPal is not configured");

  const planData = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
  if (!planData.length) throw new Error("Plan not found");
  const plan = planData[0];

  const paypalPlanId =
    billingCycle === "annual" ? plan.paypalPlanIdAnnual : plan.paypalPlanIdMonthly;
  if (!paypalPlanId) {
    throw new Error(
      `Plan "${plan.name}" has no PayPal plan for ${billingCycle} cycle. Please sync the plan to PayPal first.`
    );
  }

  const userData = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!userData.length) throw new Error("User not found");
  const user = userData[0];

  const existingSubs = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        eq(subscriptions.status, "active"),
        eq(subscriptions.gatewayProvider, "paypal")
      )
    );

  for (const sub of existingSubs) {
    if (sub.gatewaySubscriptionId) {
      try {
        await paypalRequest("POST", `/v1/billing/subscriptions/${sub.gatewaySubscriptionId}/cancel`, {
          reason: "Upgrading to new plan",
        });
      } catch {}
    }
    await db
      .update(subscriptions)
      .set({ status: "cancelled", gatewayStatus: "CANCELLED", updatedAt: new Date() })
      .where(eq(subscriptions.id, sub.id));
  }

  const appUrl = process.env.APP_URL || ""
    ? `https://${""}`
    : "http://localhost:5000";

  const subscription = await paypalRequest("POST", "/v1/billing/subscriptions", {
    plan_id: paypalPlanId,
    subscriber: {
      name: {
        given_name: user.firstName || user.username,
        surname: user.lastName || "",
      },
      email_address: user.email,
    },
    application_context: {
      brand_name: "WhatsApp Marketing Platform",
      locale: "en-US",
      shipping_preference: "NO_SHIPPING",
      user_action: "SUBSCRIBE_NOW",
      return_url: `${appUrl}/payment/success?provider=paypal`,
      cancel_url: `${appUrl}/plans`,
    },
    custom_id: JSON.stringify({ userId, planId, billingCycle }),
  });

  const approvalLink = subscription.links?.find((l: any) => l.rel === "approve");

  return {
    subscriptionId: subscription.id,
    approvalUrl: approvalLink?.href || null,
    status: subscription.status,
  };
}

export async function cancelPayPalSubscription(
  gatewaySubscriptionId: string,
  immediately: boolean = false
) {
  if (immediately) {
    await paypalRequest("POST", `/v1/billing/subscriptions/${gatewaySubscriptionId}/cancel`, {
      reason: "Cancelled by user",
    });
    return { status: "CANCELLED" };
  } else {
    await paypalRequest("POST", `/v1/billing/subscriptions/${gatewaySubscriptionId}/suspend`, {
      reason: "Cancelling at end of period",
    });
    return { status: "SUSPENDED", cancelAtPeriodEnd: true };
  }
}

export async function getPayPalSubscriptionStatus(gatewaySubscriptionId: string) {
  const sub = await paypalRequest("GET", `/v1/billing/subscriptions/${gatewaySubscriptionId}`);
  return {
    status: sub.status,
    currentPeriodStart: sub.billing_info?.last_payment?.time ? new Date(sub.billing_info.last_payment.time) : null,
    currentPeriodEnd: sub.billing_info?.next_billing_time ? new Date(sub.billing_info.next_billing_time) : null,
  };
}

export async function upgradeOrDowngradePayPal(
  userId: string,
  oldSubscriptionGatewayId: string,
  newPlanId: string,
  billingCycle: "monthly" | "annual"
) {
  try {
    await paypalRequest("POST", `/v1/billing/subscriptions/${oldSubscriptionGatewayId}/cancel`, {
      reason: "Upgrading/downgrading plan",
    });
  } catch {}
  return createPayPalSubscription(userId, newPlanId, billingCycle);
}

async function getPaystackSecretKey(): Promise<string> {
  const provider = await getProviderConfig("paystack");
  if (!provider) throw new Error("Paystack is not configured or inactive");
  const key = provider.config?.isLive
    ? provider.config?.apiSecret
    : provider.config?.apiSecretTest || provider.config?.apiSecret;
  if (!key) throw new Error("Paystack secret key not configured");
  return key;
}

export async function getPaystackPublicKey(): Promise<string | null> {
  const provider = await getProviderConfig("paystack");
  if (!provider) return null;
  return provider.config?.isLive
    ? provider.config?.apiKey || null
    : provider.config?.apiKeyTest || provider.config?.apiKey || null;
}

async function paystackRequest(method: string, path: string, data?: any) {
  const secretKey = await getPaystackSecretKey();
  const response = await axios({
    method,
    url: `https://api.paystack.co${path}`,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    data,
  });
  return response.data;
}

export async function syncPlanToPaystack(planId: string) {
  const provider = await getProviderConfig("paystack");
  if (!provider) throw new Error("Paystack is not configured or inactive");

  const planData = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
  if (!planData.length) throw new Error("Plan not found");
  const plan = planData[0];

  const currency = (await getProviderCurrency("paystack", "NGN")).toUpperCase();

  const monthlyAmount = Math.round(parseFloat(plan.monthlyPrice || "0") * 100);
  const annualAmount = Math.round(parseFloat(plan.annualPrice || "0") * 100);

  let monthlyPlanCode = plan.paystackPlanCodeMonthly;
  let annualPlanCode = plan.paystackPlanCodeAnnual;

  if (monthlyAmount > 0 && !monthlyPlanCode) {
    const result = await paystackRequest("POST", "/plan", {
      name: `${plan.name} - Monthly`,
      interval: "monthly",
      amount: monthlyAmount,
      currency,
      description: plan.description || `${plan.name} monthly subscription`,
    });
    monthlyPlanCode = result.data.plan_code;
  }

  if (annualAmount > 0 && !annualPlanCode) {
    const result = await paystackRequest("POST", "/plan", {
      name: `${plan.name} - Annual`,
      interval: "annually",
      amount: annualAmount,
      currency,
      description: plan.description || `${plan.name} annual subscription`,
    });
    annualPlanCode = result.data.plan_code;
  }

  await db
    .update(plans)
    .set({
      paystackPlanCodeMonthly: monthlyPlanCode,
      paystackPlanCodeAnnual: annualPlanCode,
      updatedAt: new Date(),
    })
    .where(eq(plans.id, planId));

  return { monthlyPlanCode, annualPlanCode };
}

export async function getOrCreatePaystackCustomer(userId: string): Promise<string> {
  const userData = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!userData.length) throw new Error("User not found");
  const user = userData[0];

  if (user.paystackCustomerCode) return user.paystackCustomerCode;

  const result = await paystackRequest("POST", "/customer", {
    email: user.email,
    first_name: user.firstName || user.username,
    last_name: user.lastName || "",
    metadata: { platformUserId: user.id },
  });

  const customerCode = result.data.customer_code;

  await db
    .update(users)
    .set({ paystackCustomerCode: customerCode, updatedAt: new Date() })
    .where(eq(users.id, userId));

  return customerCode;
}

export async function createPaystackSubscription(
  userId: string,
  planId: string,
  billingCycle: "monthly" | "annual"
) {
  const provider = await getProviderConfig("paystack");
  if (!provider) throw new Error("Paystack is not configured");

  const planData = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
  if (!planData.length) throw new Error("Plan not found");
  const plan = planData[0];

  const planCode =
    billingCycle === "annual" ? plan.paystackPlanCodeAnnual : plan.paystackPlanCodeMonthly;
  if (!planCode) {
    throw new Error(
      `Plan "${plan.name}" has no Paystack plan for ${billingCycle} cycle. Please sync the plan to Paystack first.`
    );
  }

  const userData = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!userData.length) throw new Error("User not found");
  const user = userData[0];

  const existingSubs = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        eq(subscriptions.status, "active"),
        eq(subscriptions.gatewayProvider, "paystack")
      )
    );

  for (const sub of existingSubs) {
    if (sub.gatewaySubscriptionId) {
      try {
        await paystackRequest("POST", "/subscription/disable", {
          code: sub.gatewaySubscriptionId,
          token: sub.gatewaySubscriptionId,
        });
      } catch {}
    }
    await db
      .update(subscriptions)
      .set({ status: "cancelled", gatewayStatus: "cancelled", updatedAt: new Date() })
      .where(eq(subscriptions.id, sub.id));
  }

  const appUrl = process.env.APP_URL || ""
    ? `https://${""}`
    : "http://localhost:5000";

  const amount = billingCycle === "annual"
    ? Math.round(parseFloat(plan.annualPrice || "0") * 100)
    : Math.round(parseFloat(plan.monthlyPrice || "0") * 100);

  const result = await paystackRequest("POST", "/transaction/initialize", {
    email: user.email,
    amount,
    plan: planCode,
    callback_url: `${appUrl}/payment/success?provider=paystack`,
    metadata: {
      custom_fields: [
        { display_name: "User ID", variable_name: "user_id", value: userId },
        { display_name: "Plan ID", variable_name: "plan_id", value: planId },
        { display_name: "Billing Cycle", variable_name: "billing_cycle", value: billingCycle },
      ],
    },
  });

  return {
    authorizationUrl: result.data.authorization_url,
    reference: result.data.reference,
    accessCode: result.data.access_code,
  };
}

export async function cancelPaystackSubscription(
  subscriptionCode: string,
  emailToken?: string
) {
  await paystackRequest("POST", "/subscription/disable", {
    code: subscriptionCode,
    token: emailToken || subscriptionCode,
  });
  return { status: "cancelled" };
}

export async function getPaystackSubscriptionStatus(subscriptionCode: string) {
  const result = await paystackRequest("GET", `/subscription/${subscriptionCode}`);
  return {
    status: result.data.status,
    nextPaymentDate: result.data.next_payment_date ? new Date(result.data.next_payment_date) : null,
    email_token: result.data.email_token,
  };
}

export async function upgradeOrDowngradePaystack(
  userId: string,
  oldSubscriptionCode: string,
  newPlanId: string,
  billingCycle: "monthly" | "annual"
) {
  try {
    await paystackRequest("POST", "/subscription/disable", {
      code: oldSubscriptionCode,
      token: oldSubscriptionCode,
    });
  } catch {}
  return createPaystackSubscription(userId, newPlanId, billingCycle);
}

async function getMercadoPagoAccessToken(): Promise<string> {
  const provider = await getProviderConfig("mercadopago");
  if (!provider) throw new Error("Mercado Pago is not configured or inactive");
  const token = provider.config?.isLive
    ? provider.config?.apiSecret
    : provider.config?.apiSecretTest || provider.config?.apiSecret;
  if (!token) throw new Error("Mercado Pago access token not configured");
  return token;
}

export async function getMercadoPagoPublicKey(): Promise<string | null> {
  const provider = await getProviderConfig("mercadopago");
  if (!provider) return null;
  return provider.config?.isLive
    ? provider.config?.apiKey || null
    : provider.config?.apiKeyTest || provider.config?.apiKey || null;
}

async function mercadopagoRequest(method: string, path: string, data?: any) {
  const accessToken = await getMercadoPagoAccessToken();
  const response = await axios({
    method,
    url: `https://api.mercadopago.com${path}`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    data,
  });
  return response.data;
}

export async function syncPlanToMercadoPago(planId: string) {
  const provider = await getProviderConfig("mercadopago");
  if (!provider) throw new Error("Mercado Pago is not configured or inactive");

  const planData = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
  if (!planData.length) throw new Error("Plan not found");
  const plan = planData[0];

  const currency = (await getProviderCurrency("mercadopago", "BRL")).toUpperCase();

  const monthlyAmount = parseFloat(plan.monthlyPrice || "0");
  const annualAmount = parseFloat(plan.annualPrice || "0");

  let monthlyPlanId = plan.mercadopagoPlanIdMonthly;
  let annualPlanId = plan.mercadopagoPlanIdAnnual;

  if (monthlyAmount > 0 && !monthlyPlanId) {
    const result = await mercadopagoRequest("POST", "/preapproval_plan", {
      reason: `${plan.name} - Monthly`,
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: monthlyAmount,
        currency_id: currency,
      },
      back_url: process.env.APP_URL || `https://${""}` || "http://localhost:5000",
    });
    monthlyPlanId = result.id;
  }

  if (annualAmount > 0 && !annualPlanId) {
    const result = await mercadopagoRequest("POST", "/preapproval_plan", {
      reason: `${plan.name} - Annual`,
      auto_recurring: {
        frequency: 12,
        frequency_type: "months",
        transaction_amount: annualAmount,
        currency_id: currency,
      },
      back_url: process.env.APP_URL || `https://${""}` || "http://localhost:5000",
    });
    annualPlanId = result.id;
  }

  await db
    .update(plans)
    .set({
      mercadopagoPlanIdMonthly: monthlyPlanId,
      mercadopagoPlanIdAnnual: annualPlanId,
      updatedAt: new Date(),
    })
    .where(eq(plans.id, planId));

  return { monthlyPlanId, annualPlanId };
}

export async function createMercadoPagoSubscription(
  userId: string,
  planId: string,
  billingCycle: "monthly" | "annual"
) {
  const provider = await getProviderConfig("mercadopago");
  if (!provider) throw new Error("Mercado Pago is not configured");

  const planData = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
  if (!planData.length) throw new Error("Plan not found");
  const plan = planData[0];

  const mpPlanId =
    billingCycle === "annual" ? plan.mercadopagoPlanIdAnnual : plan.mercadopagoPlanIdMonthly;
  if (!mpPlanId) {
    throw new Error(
      `Plan "${plan.name}" has no Mercado Pago plan for ${billingCycle} cycle. Please sync the plan to Mercado Pago first.`
    );
  }

  const userData = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!userData.length) throw new Error("User not found");
  const user = userData[0];

  const existingSubs = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        eq(subscriptions.status, "active"),
        eq(subscriptions.gatewayProvider, "mercadopago")
      )
    );

  for (const sub of existingSubs) {
    if (sub.gatewaySubscriptionId) {
      try {
        await mercadopagoRequest("PUT", `/preapproval/${sub.gatewaySubscriptionId}`, {
          status: "cancelled",
        });
      } catch {}
    }
    await db
      .update(subscriptions)
      .set({ status: "cancelled", gatewayStatus: "cancelled", updatedAt: new Date() })
      .where(eq(subscriptions.id, sub.id));
  }

  const appUrl = process.env.APP_URL || ""
    ? `https://${""}`
    : "http://localhost:5000";

  const subscription = await mercadopagoRequest("POST", "/preapproval", {
    preapproval_plan_id: mpPlanId,
    payer_email: user.email,
    external_reference: JSON.stringify({ userId, planId, billingCycle }),
    back_url: `${appUrl}/payment/success?provider=mercadopago`,
    reason: `${plan.name} - ${billingCycle === "annual" ? "Annual" : "Monthly"}`,
  });

  return {
    subscriptionId: subscription.id,
    initPoint: subscription.init_point,
    status: subscription.status,
  };
}

export async function cancelMercadoPagoSubscription(gatewaySubscriptionId: string) {
  await mercadopagoRequest("PUT", `/preapproval/${gatewaySubscriptionId}`, {
    status: "cancelled",
  });
  return { status: "cancelled" };
}

export async function getMercadoPagoSubscriptionStatus(gatewaySubscriptionId: string) {
  const sub = await mercadopagoRequest("GET", `/preapproval/${gatewaySubscriptionId}`);
  return {
    status: sub.status,
    nextPaymentDate: sub.next_payment_date ? new Date(sub.next_payment_date) : null,
  };
}

export async function upgradeOrDowngradeMercadoPago(
  userId: string,
  oldSubId: string,
  newPlanId: string,
  billingCycle: "monthly" | "annual"
) {
  try {
    await mercadopagoRequest("PUT", `/preapproval/${oldSubId}`, { status: "cancelled" });
  } catch {}
  return createMercadoPagoSubscription(userId, newPlanId, billingCycle);
}
