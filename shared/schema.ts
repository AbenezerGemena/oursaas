import { sql } from "drizzle-orm";
import { OURSAAS_BRAND } from "@oursaas/core";
import {
  pgTable,
  text,
  varchar,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
  unique,
  numeric,
  pgEnum,
  serial,
  uuid,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email").notNull().unique(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  role: text("role").notNull().default("admin"), 
  avatar: text("avatar"),
  status: text("status").notNull().default("active"), 
  permissions: text("permissions").array().notNull(),
  channelId: varchar("channel_id"),
  lastLogin: timestamp("last_login"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdBy: varchar("created_by").default(""),
  fcmToken: varchar("fcm_token", { length: 512 }),
  isEmailVerified: boolean("is_email_verified").default(false),
  stripeCustomerId: varchar("stripe_customer_id"),
  razorpayCustomerId: varchar("razorpay_customer_id"),
  paypalCustomerId: varchar("paypal_customer_id"),
  paystackCustomerCode: varchar("paystack_customer_code"),
  mercadopagoCustomerId: varchar("mercadopago_customer_id"),
});

export const conversationAssignments = pgTable("conversation_assignments", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  userId: varchar("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  assignedBy: varchar("assigned_by").references(() => users.id, {
    onDelete: "cascade",
  }),
  assignedAt: timestamp("assigned_at").defaultNow(),
  status: text("status").notNull().default("active"), 
  priority: text("priority").default("normal"), 
  notes: text("notes"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const userActivityLogs = pgTable("user_activity_logs", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: varchar("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  action: text("action").notNull(), 
  entityType: text("entity_type"), 
  entityId: varchar("entity_id"),
  details: jsonb("details").default({}),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const contacts = pgTable(
  "contacts",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    channelId: varchar("channel_id").references(() => channels.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    email: text("email"),
    groups: jsonb("groups").$type<string[]>().default([]),
    tags: jsonb("tags").default([]),
    status: text("status").default("active"), 
    source: varchar("source", { length: 100 }), 
    lastContact: timestamp("last_contact"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
    createdBy: varchar("created_by").default(""),
  },
  (table) => ({
    contactChannelIdx: index("contacts_channel_idx").on(table.channelId),
    contactPhoneIdx: index("contacts_phone_idx").on(table.phone),
    contactStatusIdx: index("contacts_status_idx").on(table.status),
    contactChannelPhoneUnique: unique("contacts_channel_phone_unique").on(
      table.channelId,
      table.phone
    ),
  })
);

export const campaigns = pgTable(
  "campaigns",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    channelId: varchar("channel_id").references(() => channels.id, {
      onDelete: "cascade",
    }),
    createdBy: varchar("created_by"),
    name: text("name").notNull(),
    description: text("description"),
    campaignType: text("campaign_type").notNull(), 
    type: text("type").notNull(), 
    apiType: text("api_type").notNull(), 
    templateId: varchar("template_id").references(() => templates.id),
    templateName: text("template_name"),
    templateLanguage: text("template_language"),
    variableMapping: jsonb("variable_mapping")
      .$type<Record<string, string>>()
      .default({}), 
    contactGroups: jsonb("contact_groups").$type<string[]>().default([]), 
    csvData: jsonb("csv_data").default([]), 
    apiKey: varchar("api_key"), 
    apiEndpoint: text("api_endpoint"), 
    status: text("status").default("draft"), 
    scheduledAt: timestamp("scheduled_at"),
    recipientCount: integer("recipient_count").default(0),
    sentCount: integer("sent_count").default(0),
    deliveredCount: integer("delivered_count").default(0),
    readCount: integer("read_count").default(0),
    repliedCount: integer("replied_count").default(0),
    failedCount: integer("failed_count").default(0),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    campaignChannelIdx: index("campaigns_channel_idx").on(table.channelId),
    campaignStatusIdx: index("campaigns_status_idx").on(table.status),
    campaignCreatedIdx: index("campaigns_created_idx").on(table.createdAt),
  })
);

export const campaignRecipients = pgTable(
  "campaign_recipients",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    campaignId: varchar("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    contactId: varchar("contact_id").references(() => contacts.id, {
      onDelete: "cascade",
    }),
    phone: text("phone").notNull(),
    name: text("name"),
    status: text("status").default("pending"), 
    whatsappMessageId: varchar("whatsapp_message_id"),
    templateParams: jsonb("template_params").default({}),
    sentAt: timestamp("sent_at"),
    deliveredAt: timestamp("delivered_at"),
    readAt: timestamp("read_at"),
    errorCode: varchar("error_code"),
    errorMessage: text("error_message"),
    retryCount: integer("retry_count").default(0),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    recipientCampaignIdx: index("recipients_campaign_idx").on(table.campaignId),
    recipientStatusIdx: index("recipients_status_idx").on(table.status),
    recipientPhoneIdx: index("recipients_phone_idx").on(table.phone),
    campaignPhoneUnique: unique("campaign_phone_unique").on(
      table.campaignId,
      table.phone
    ),
  })
);

export const channels = pgTable("channels", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  phoneNumberId: text("phone_number_id").notNull(),
  accessToken: text("access_token").notNull(),
  whatsappBusinessAccountId: text("whatsapp_business_account_id"),
  phoneNumber: text("phone_number"),
  appId: text("app_id"),
  isActive: boolean("is_active").default(true),
  isCoexistence: boolean("is_coexistence").default(false),
  
  healthStatus: text("health_status").default("unknown"), 
  lastHealthCheck: timestamp("last_health_check"),
  healthDetails: jsonb("health_details").default({}), 
  connectionMethod: varchar("connection_method", { length: 20 }).default("embedded"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdBy: varchar("created_by").default(""),
});

export const templates = pgTable("templates", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  channelId: varchar("channel_id").references(() => channels.id),
  createdBy: varchar("created_by"),
  name: text("name").notNull(),
  category: text("category").notNull(), 
  language: text("language").default("en_US"),
  header: text("header"),
  body: text("body").notNull(),
  footer: text("footer"),
  buttons: jsonb("buttons").default([]),
  variables: jsonb("variables").default([]),
  status: text("status").default("draft"), 
  rejectionReason: text("rejection_reason"), 
  mediaType: text("media_type").default("text"), 
  mediaUrl: text("media_url"), 
  mediaHandle: text("media_handle"), 
  carouselCards: jsonb("carousel_cards").default([]), 
  whatsappTemplateId: text("whatsapp_template_id"), 
  usage_count: integer("usage_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  headerType: text("header_type"),
  bodyVariables: integer("body_variables"),
}, (table) => ({
  templateChannelWaIdUnique: unique("template_channel_wa_id_unique").on(table.whatsappTemplateId, table.channelId),
  templateChannelIdx: index("templates_channel_idx").on(table.channelId),
}));

export const whatsappBusinessAccountsConfig =
  pgTable("whatsapp_business_accounts_config", {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    
    appId: text("app_id").notNull(),
    appSecret: text("app_secret").notNull(),
    configId: text("config_id").notNull(),

    
    createdBy: varchar("created_by")
      .default(""),

    
    isActive: boolean("is_active")
      .default(true),

    
    createdAt: timestamp("created_at")
      .defaultNow(),

    updatedAt: timestamp("updated_at")
      .defaultNow(),
  });

export const session = pgTable("session", {
  sid: varchar("sid").notNull().primaryKey(),
  sess: jsonb("sess").notNull(),
  expire: timestamp("expire", { precision: 6 }).notNull(),
});

export const conversations = pgTable(
  "conversations",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    channelId: varchar("channel_id").references(() => channels.id, {
      onDelete: "cascade",
    }),
    contactId: varchar("contact_id").references(() => contacts.id, {
      onDelete: "cascade",
    }),
    assignedTo: varchar("assigned_to"),
    contactPhone: varchar("contact_phone"), 
    contactName: varchar("contact_name"), 
    status: text("status").default("open"), 
    priority: text("priority").default("normal"), 
    type: text("type").default("whatsapp"), 
    chatbotId: varchar("chatbot_id"),
    sessionId: text("session_id"),
    tags: jsonb("tags").default([]),
    unreadCount: integer("unread_count").default(0), 
    lastMessageAt: timestamp("last_message_at"),
    lastIncomingMessageAt: timestamp("last_incoming_message_at"),
    lastMessageText: text("last_message_text"), 
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    conversationChannelIdx: index("conversations_channel_idx").on(
      table.channelId
    ),
    conversationContactIdx: index("conversations_contact_idx").on(
      table.contactId
    ),
    conversationPhoneIdx: index("conversations_phone_idx").on(
      table.contactPhone
    ),
    conversationStatusIdx: index("conversations_status_idx").on(table.status),
    conversationLastMsgIdx: index("conversations_last_msg_idx").on(table.channelId, table.lastMessageAt),
  })
);

export const messages = pgTable(
  "messages",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    conversationId: varchar("conversation_id").references(
      () => conversations.id,
      {
        onDelete: "cascade",
      }
    ),
    whatsappMessageId: varchar("whatsapp_message_id"), 
    fromUser: boolean("from_user").default(false),
    direction: varchar("direction").default("outbound"), 
    content: text("content").notNull(),
    type: text("type").default("text"), 
    fromType: varchar("from_type").default("user"), 
    messageType: varchar("message_type"), 
    mediaId: varchar("media_id"), 
    mediaUrl: text("media_url"), 
    mediaMimeType: varchar("media_mime_type", { length: 100 }),
    mediaSha256: varchar("media_sha256", { length: 128 }),
    status: text("status").default("sent"), 
    timestamp: timestamp("timestamp"), 
    metadata: jsonb("metadata").default({}), 
    deliveredAt: timestamp("delivered_at"),
    readAt: timestamp("read_at"),
    errorCode: varchar("error_code", { length: 50 }),
    errorMessage: text("error_message"),
    errorDetails: jsonb("error_details"), 
    campaignId: varchar("campaign_id").references(() => campaigns.id, {
      onDelete: "set null",
    }), 
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    messageConversationIdx: index("messages_conversation_idx").on(
      table.conversationId
    ),
    messageWhatsappIdx: index("messages_whatsapp_idx").on(
      table.whatsappMessageId
    ),
    messageDirectionIdx: index("messages_direction_idx").on(table.direction),
    messageStatusIdx: index("messages_status_idx").on(table.status),
    messageTimestampIdx: index("messages_timestamp_idx").on(table.timestamp),
    messageCreatedIdx: index("messages_created_idx").on(table.createdAt),
    messageConvCreatedIdx: index("messages_conv_created_idx").on(table.conversationId, table.createdAt),
  })
);

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),

  title: text("title").notNull(),
  message: text("message").notNull(),

  type: varchar("type").notNull().default("general"),

  createdBy: varchar("created_by").notNull().default("system"),

  channelId: varchar("channel_id").references(() => channels.id, {
    onDelete: "set null",
  }),

  targetType: varchar("target_type").notNull(),

  targetIds: text("target_ids")
    .array()
    .default(sql`ARRAY[]::text[]`),

  status: varchar("status").notNull().default("draft"),
  sentAt: timestamp("sent_at"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const sentNotifications = pgTable("sent_notifications", {
  id: serial("id").primaryKey(),

  notificationId: integer("notification_id")
    .references(() => notifications.id, { onDelete: "cascade" })
    .notNull(),

  userId: varchar("user_id"),

  isRead: boolean("is_read").default(false),
  readAt: timestamp("read_at"),

  sentAt: timestamp("sent_at").defaultNow(),
});

export const notificationTemplates = pgTable("notification_templates", {
  id: serial("id").primaryKey(),
  eventType: varchar("event_type").notNull().unique(),
  label: varchar("label").notNull(),
  description: text("description"),
  subject: text("subject").notNull(),
  htmlBody: text("html_body").notNull(),
  isEmailEnabled: boolean("is_email_enabled").default(true),
  isInAppEnabled: boolean("is_in_app_enabled").default(true),
  variables: text("variables").array().default(sql`ARRAY[]::text[]`),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const userNotificationPreferences = pgTable("user_notification_preferences", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  eventType: varchar("event_type").notNull(),
  inAppEnabled: boolean("in_app_enabled").default(true),
  emailEnabled: boolean("email_enabled").default(true),
  soundEnabled: boolean("sound_enabled").default(true),
});

export const chatbots = pgTable("chatbots", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  uuid: text("uuid").notNull().unique(),
  title: text("title").notNull(),
  bubbleMessage: text("bubble_message"),
  welcomeMessage: text("welcome_message"),
  instructions: text("instructions"),
  connectMessage: text("connect_message"),
  language: text("language").default("en"),
  interactionType: text("interaction_type").default("ai-only"),
  avatarId: integer("avatar_id"),
  avatarEmoji: text("avatar_emoji"),
  avatarColor: text("avatar_color"),
  primaryColor: text("primary_color").default("#3B82F6"),
  logoUrl: text("logo_url"),
  embedWidth: integer("embed_width").default(420),
  embedHeight: integer("embed_height").default(745),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const trainingData = pgTable("training_data", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  chatbotId: varchar("chatbot_id").references(() => chatbots.id),
  type: text("type").notNull(), 
  title: text("title"),
  content: text("content"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const knowledgeCategories = pgTable(
  "knowledge_categories",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    siteId: varchar("site_id").notNull(),
    parentId: varchar("parent_id"),
    name: varchar("name", { length: 255 }).notNull(),
    icon: varchar("icon", { length: 50 }),
    description: text("description"),
    order: integer("order").default(0),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    categorySiteIdx: index("categories_site_idx").on(table.siteId),
    categoryParentIdx: index("categories_parent_idx").on(table.parentId),
  })
);

export const knowledgeArticles = pgTable(
  "knowledge_articles",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    categoryId: varchar("category_id").notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    content: text("content").notNull(),
    order: integer("order").default(0),
    published: boolean("published").default(true),
    views: integer("views").default(0),
    helpful: integer("helpful").default(0),
    notHelpful: integer("not_helpful").default(0),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    articleCategoryIdx: index("articles_category_idx").on(table.categoryId),
    articlePublishedIdx: index("articles_published_idx").on(table.published),
  })
);

export const plans = pgTable("plans", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  description: text("description"),
  icon: varchar("icon"), 
  popular: boolean("popular").default(false),
  badge: varchar("badge"),
  color: varchar("color"),
  buttonColor: varchar("button_color"),

  
  monthlyPrice: numeric("monthly_price", { precision: 10, scale: 2 }).default(
    "0"
  ),
  annualPrice: numeric("annual_price", { precision: 10, scale: 2 }).default(
    "0"
  ),

  
  permissions: jsonb("permissions").$type<{
    channel: string;
    contacts: string;
    automation: string;
    campaign?: string;
    apiRequestsPerMonth?: string;
    apiRateLimitPerMinute?: string;
  }>(),

  
  features: jsonb("features").$type<{ name: string; included: boolean }[]>(),

  stripeProductId: varchar("stripe_product_id"),
  stripePriceIdMonthly: varchar("stripe_price_id_monthly"),
  stripePriceIdAnnual: varchar("stripe_price_id_annual"),
  razorpayPlanIdMonthly: varchar("razorpay_plan_id_monthly"),
  razorpayPlanIdAnnual: varchar("razorpay_plan_id_annual"),
  paypalProductId: varchar("paypal_product_id"),
  paypalPlanIdMonthly: varchar("paypal_plan_id_monthly"),
  paypalPlanIdAnnual: varchar("paypal_plan_id_annual"),
  paystackPlanCodeMonthly: varchar("paystack_plan_code_monthly"),
  paystackPlanCodeAnnual: varchar("paystack_plan_code_annual"),
  mercadopagoPlanIdMonthly: varchar("mercadopago_plan_id_monthly"),
  mercadopagoPlanIdAnnual: varchar("mercadopago_plan_id_annual"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const paymentProviders = pgTable("payment_providers", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(), 
  providerKey: varchar("provider_key").notNull().unique(), 
  description: text("description"),
  logo: varchar("logo"), 
  isActive: boolean("is_active").default(true),
  
  config: jsonb("config").$type<{
    apiKey?: string;
    apiSecret?: string;
    webhookSecret?: string;
    publicKey?: string;
    merchantId?: string;
    [key: string]: any;
  }>(),
  
  supportedCurrencies: jsonb("supported_currencies").$type<string[]>(),
  supportedMethods: jsonb("supported_methods").$type<string[]>(), 
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const subscriptions = pgTable("subscriptions", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: varchar("user_id")
    .notNull()
    .references(() => users.id),
  planId: varchar("plan_id")
    .notNull()
    .references(() => plans.id),
    planData: jsonb("plan_data").notNull(), 
  status: varchar("status").notNull(), 
  billingCycle: varchar("billing_cycle").notNull(), 
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  autoRenew: boolean("auto_renew").default(true),
  gatewaySubscriptionId: varchar("gateway_subscription_id"),
  gatewayProvider: varchar("gateway_provider"), 
  gatewayStatus: varchar("gateway_status"), 
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const transactions = pgTable("transactions", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: varchar("user_id")
    .notNull()
    .references(() => users.id),
  planId: varchar("plan_id")
    .notNull()
    .references(() => plans.id),
  subscriptionId: varchar("subscription_id").references(() => subscriptions.id),
  paymentProviderId: varchar("payment_provider_id")
    .notNull()
    .references(() => paymentProviders.id),

  
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency").default("USD"),
  billingCycle: varchar("billing_cycle").notNull(), 

  
  providerTransactionId: varchar("provider_transaction_id"), 
  providerOrderId: varchar("provider_order_id"), 
  providerPaymentId: varchar("provider_payment_id"), 

  
  status: varchar("status").notNull(), 
  paymentMethod: varchar("payment_method"), 

  
  metadata: jsonb("metadata").$type<{
    cardLast4?: string;
    cardBrand?: string;
    upiId?: string;
    failureReason?: string;
    refundReason?: string;
    [key: string]: any;
  }>(),

  
  paidAt: timestamp("paid_at"),
  refundedAt: timestamp("refunded_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const ticketStatusEnum = pgEnum("ticket_status", [
  "open",
  "in_progress",
  "resolved",
  "closed",
]);
export const ticketPriorityEnum = pgEnum("ticket_priority", [
  "low",
  "medium",
  "high",
  "urgent",
]);
export const userTypeEnum = pgEnum("user_type", [
  "user",
  "team",
  "admin",
  "superadmin",
]);

export const supportTickets = pgTable("support_tickets", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description").notNull(),
  status: ticketStatusEnum("status").notNull().default("open"),
  priority: ticketPriorityEnum("priority").notNull().default("medium"),

  
  creatorId: varchar("creator_id").notNull(), 
  creatorType: userTypeEnum("creator_type").notNull(), 
  creatorName: text("creator_name").notNull(), 
  creatorEmail: text("creator_email").notNull(), 

  
  assignedToId: varchar("assigned_to_id"), 
  assignedToName: text("assigned_to_name"), 

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
  closedAt: timestamp("closed_at"),
});

export const ticketMessages = pgTable("ticket_messages", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  ticketId: varchar("ticket_id")
    .notNull()
    .references(() => supportTickets.id, { onDelete: "cascade" }),

  
  senderId: varchar("sender_id").notNull(),
  senderType: userTypeEnum("sender_type").notNull(), 
  senderName: text("sender_name").notNull(), 

  message: text("message").notNull(),
  isInternal: boolean("is_internal").notNull().default(false), 

  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const supportTicketsRelations = relations(
  supportTickets,
  ({ many }) => ({
    messages: many(ticketMessages),
  })
);

export const ticketMessagesRelations = relations(ticketMessages, ({ one }) => ({
  ticket: one(supportTickets, {
    fields: [ticketMessages.ticketId],
    references: [supportTickets.id],
  }),
}));

export const automations = pgTable(
  "automations",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    channelId: varchar("channel_id").references(() => channels.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    description: text("description"),
    trigger: text("trigger").notNull(), 
    triggerConfig: jsonb("trigger_config").default({}),
    status: text("status").default("inactive"), 
    executionCount: integer("execution_count").default(0),
    lastExecutedAt: timestamp("last_executed_at"),
    createdBy: varchar("created_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    automationChannelIdx: index("automations_channel_idx").on(table.channelId),
    automationStatusIdx: index("automations_status_idx").on(table.status),
  })
);

export const automationNodes = pgTable(
  "automation_nodes",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    automationId: varchar("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    nodeId: varchar("node_id").notNull(),
    type: text("type").notNull(), 
    subtype: text("subtype"), 
    position: jsonb("position").default({}), 
    measured: jsonb("measured").default({}), 
    data: jsonb("data").default({}), 
    connections: jsonb("connections").default([]), 
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    nodeAutomationIdx: index("automation_nodes_automation_idx").on(
      table.automationId
    ),
    nodeUniqueIdx: unique("automation_nodes_unique_idx").on(
      table.automationId,
      table.nodeId
    ),
  })
);

export const automationEdges = pgTable(
  "automation_edges",
  {
    id: varchar("id").primaryKey(), 

    automationId: varchar("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),

    sourceNodeId: varchar("source_node_id").notNull(),

    targetNodeId: varchar("target_node_id").notNull(),

    animated: boolean("animated").default(false),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    automationEdgeIdx: index("automation_edges_automation_idx").on(
      table.automationId
    ),
    edgeUniqueIdx: unique("automation_edges_unique_idx").on(
      table.automationId,
      table.sourceNodeId,
      table.targetNodeId
    ),
  })
);

export const automationExecutions = pgTable(
  "automation_executions",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    automationId: varchar("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    contactId: varchar("contact_id").references(() => contacts.id),
    conversationId: varchar("conversation_id").references(
      () => conversations.id
    ),
    triggerData: jsonb("trigger_data").default({}),
    status: text("status").notNull(), 
    currentNodeId: varchar("current_node_id"),
    executionPath: jsonb("execution_path").default([]),
    variables: jsonb("variables").default({}),
    result: text("result"),
    error: text("error"),
    startedAt: timestamp("started_at").defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (table) => ({
    executionAutomationIdx: index("automation_executions_automation_idx").on(
      table.automationId
    ),
    executionStatusIdx: index("automation_executions_status_idx").on(
      table.status
    ),
  })
);

export const automationExecutionLogs = pgTable(
  "automation_execution_logs",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    executionId: varchar("execution_id")
      .notNull()
      .references(() => automationExecutions.id, { onDelete: "cascade" }),
    nodeId: varchar("node_id").notNull(),
    nodeType: text("node_type").notNull(),
    status: text("status").notNull(), 
    input: jsonb("input").default({}),
    output: jsonb("output").default({}),
    error: text("error"),
    executedAt: timestamp("executed_at").defaultNow(),
  },
  (table) => ({
    logExecutionIdx: index("automation_execution_logs_execution_idx").on(
      table.executionId
    ),
  })
);

export const analytics = pgTable("analytics", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  channelId: varchar("channel_id"),
  date: timestamp("date").notNull(),
  messagesSent: integer("messages_sent").default(0),
  messagesDelivered: integer("messages_delivered").default(0),
  messagesRead: integer("messages_read").default(0),
  messagesReplied: integer("messages_replied").default(0),
  newContacts: integer("new_contacts").default(0),
  activeCampaigns: integer("active_campaigns").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const whatsappChannels = pgTable("whatsapp_channels", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  phoneNumber: varchar("phone_number", { length: 20 }).notNull().unique(),
  phoneNumberId: varchar("phone_number_id", { length: 50 }).notNull(),
  wabaId: varchar("waba_id", { length: 50 }).notNull(),
  accessToken: text("access_token").notNull(), 
  businessAccountId: varchar("business_account_id", { length: 50 }),
  rateLimitTier: varchar("rate_limit_tier", { length: 20 }).default("standard"),
  qualityRating: varchar("quality_rating", { length: 20 }).default("green"), 
  status: varchar("status", { length: 20 }).default("inactive"), 
  errorMessage: text("error_message"),
  lastHealthCheck: timestamp("last_health_check"),
  messageLimit: integer("message_limit"),
  messagesUsed: integer("messages_used"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const channelSignupLogs = pgTable("channel_signup_logs", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("incomplete"),
  step: varchar("step", { length: 50 }).notNull().default("token_exchange"),
  errorMessage: text("error_message"),
  errorDetails: jsonb("error_details"),
  phoneNumber: text("phone_number"),
  wabaId: text("waba_id"),
  channelId: varchar("channel_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const webhookConfigs = pgTable("webhook_configs", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  channelId: varchar("channel_id"), 
  webhookUrl: text("webhook_url").notNull(),
  verifyToken: varchar("verify_token", { length: 100 }).notNull(),
  appSecret: text("app_secret"), 
  events: jsonb("events").default([]).notNull(), 
  isActive: boolean("is_active").default(true),
  lastPingAt: timestamp("last_ping_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const messageQueue = pgTable("message_queue", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  campaignId: varchar("campaign_id").references(() => campaigns.id),
  channelId: varchar("channel_id").references(() => whatsappChannels.id),
  recipientPhone: varchar("recipient_phone", { length: 20 }).notNull(),
  templateName: varchar("template_name", { length: 100 }),
  templateParams: jsonb("template_params").default([]),
  messageType: varchar("message_type", { length: 20 }).notNull(), 
  status: varchar("status", { length: 20 }).default("queued"), 
  attempts: integer("attempts").default(0),
  whatsappMessageId: varchar("whatsapp_message_id", { length: 100 }),
  conversationId: varchar("conversation_id", { length: 100 }),
  sentVia: varchar("sent_via", { length: 20 }), 
  cost: varchar("cost", { length: 20 }), 
  errorCode: varchar("error_code", { length: 50 }),
  errorMessage: text("error_message"),
  scheduledFor: timestamp("scheduled_for"),
  processedAt: timestamp("processed_at"),
  deliveredAt: timestamp("delivered_at"),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const apiLogs = pgTable("api_logs", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  channelId: varchar("channel_id").references(() => channels.id),
  requestType: varchar("request_type", { length: 50 }).notNull(), 
  endpoint: text("endpoint").notNull(),
  method: varchar("method", { length: 10 }).notNull(),
  requestBody: jsonb("request_body"),
  responseStatus: integer("response_status"),
  responseBody: jsonb("response_body"),
  duration: integer("duration"), 
  createdAt: timestamp("created_at").defaultNow(),
});

export const panelConfig = pgTable("panel_config", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  tagline: varchar("tagline"),
  description: text("description"),
  logo: varchar("logo"),
  logo2: varchar("logo2"),
  favicon: varchar("favicon"),
  defaultLanguage: varchar("default_language", { length: 5 }).default("en"),
  supportedLanguages: jsonb("supported_languages").default(sql`'["en"]'`),
  companyName: varchar("company_name"),
  companyWebsite: varchar("company_website"),
  supportEmail: varchar("support_email"),
  currency: varchar("currency", { length: 10 }).default("INR"),
  country: varchar("country", { length: 2 }).default("IN"),
  embeddedSignupEnabled: boolean("embedded_signup_enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const groups = pgTable("groups", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  channelId: uuid("channelId"), 
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: false })
    .defaultNow()
});

export const firebaseConfig = pgTable("firebase_config", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  apiKey: text("api_key"),
  authDomain: text("auth_domain"),
  projectId: text("project_id"),
  storageBucket: text("storage_bucket"),
  messagingSenderId: text("messaging_sender_id"),
  appId: text("app_id"),
  measurementId: text("measurement_id"),
  privateKey: text("private_key"),
  clientEmail: text("client_email"),
  vapidKey: text("vapid_key"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const storageSettings = pgTable("storage_settings", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  provider: text("provider").default("digitalocean"), 
  spaceName: text("space_name").notNull(),
  endpoint: text("endpoint").notNull(),
  region: text("region").notNull(),
  accessKey: text("access_key").notNull(),
  secretKey: text("secret_key").notNull(),
  isActive: boolean("is_active").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const aiSettings = pgTable("ai_settings", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  channelId: varchar("channel_id").references(() => channels.id),
  provider: text("provider").notNull().default("openai"),
  apiKey: text("api_key").notNull(),
  model: text("model").notNull().default("gpt-4o-mini"),
  endpoint: text("endpoint").default("https://api.openai.com/v1"),
  temperature: text("temperature").default("0.7"), 
  maxTokens: text("max_tokens").default("2048"),
  isActive: boolean("is_active").default(false),

  
  words: text("words")
    .array()
    .default(sql`ARRAY[]::text[]`), 

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const sites = pgTable("sites", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  channelId: varchar("channel_id"),
  name: text("name").notNull(),
  domain: text("domain").notNull(),
  widgetCode: text("widget_code").notNull().unique(),
  widgetEnabled: boolean("widget_enabled").notNull().default(true),
  widgetConfig: jsonb("widget_config")
    .notNull()
    .default(sql`'{}'::jsonb`), 
  aiTrainingConfig: jsonb("ai_training_config")
    .notNull()
    .default(sql`'{"trainFromKB": false, "trainFromDocuments": true}'::jsonb`), 
  autoAssignmentConfig: jsonb("auto_assignment_config")
    .notNull()
    .default(sql`'{"enabled": false, "strategy": "round_robin"}'::jsonb`), 
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const smtpConfig = pgTable("smtp_config", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),

  host: text("host").notNull(),
  port: integer("port").notNull(),
  secure: boolean("secure").default(false),
  user: text("user").notNull(),
  password: text("password"),
  fromName: text("from_name").notNull(),
  fromEmail: text("from_email").notNull(),
  logo: text("logo").default("null"), 
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const otpVerifications = pgTable("otp_verifications", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`), 

  userId: varchar("user_id")
    .notNull(), 

  otpCode: varchar("otp_code", { length: 6 }).notNull(), 
  expiresAt: timestamp("expires_at").notNull(), 
  isUsed: boolean("is_used").default(false), 

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const PERMISSIONS = {
  
  DASHBOARD_VIEW: "dashboard:view",
  DASHBOARD_EXPORT: "dashboard:export",

  
  CONTACTS_VIEW: "contacts:view",
  CONTACTS_CREATE: "contacts:create",
  CONTACTS_EDIT: "contacts:edit",
  CONTACTS_DELETE: "contacts:delete",
  CONTACTS_IMPORT: "contacts:import",
  CONTACTS_EXPORT: "contacts:export",

  
  CAMPAIGNS_VIEW: "campaigns:view",
  CAMPAIGNS_CREATE: "campaigns:create",
  CAMPAIGNS_EDIT: "campaigns:edit",
  CAMPAIGNS_DELETE: "campaigns:delete",
  CAMPAIGNS_SEND: "campaigns:send",
  CAMPAIGNS_SCHEDULE: "campaigns:schedule",

  
  TEMPLATES_VIEW: "templates:view",
  TEMPLATES_CREATE: "templates:create",
  TEMPLATES_EDIT: "templates:edit",
  TEMPLATES_DELETE: "templates:delete",
  TEMPLATES_SYNC: "templates:sync",

  
  INBOX_VIEW: "inbox:view",
  INBOX_SEND_MESSAGE: "inbox:send",
  INBOX_ASSIGN: "inbox:assign",
  INBOX_CLOSE: "inbox:close",
  INBOX_DELETE: "inbox:delete",

  
  ANALYTICS_VIEW: "analytics:view",
  ANALYTICS_EXPORT: "analytics:export",

  
  SETTINGS_VIEW: "settings:view",
  SETTINGS_CHANNELS: "settings:channels",
  SETTINGS_WEBHOOK: "settings:webhook",
  SETTINGS_TEAM: "settings:team",
  SETTINGS_API: "settings:api",

  
  TEAM_VIEW: "team:view",
  TEAM_CREATE: "team:create",
  TEAM_EDIT: "team:edit",
  TEAM_DELETE: "team:delete",
  TEAM_PERMISSIONS: "team:permissions",

  
  LOGS_VIEW: "logs:view",

  
  AUTOMATIONS_VIEW: "automations:view",
  AUTOMATIONS_CREATE: "automations:create",
  AUTOMATIONS_EDIT: "automations:edit",
  AUTOMATIONS_DELETE: "automations:delete",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export type PermissionMap = Record<Permission, boolean>;

export const DEFAULT_PERMISSIONS: Record<string, Permission[]> = {
  admin: Object.values(PERMISSIONS), 
  manager: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.DASHBOARD_EXPORT,
    PERMISSIONS.CONTACTS_VIEW,
    PERMISSIONS.CONTACTS_CREATE,
    PERMISSIONS.CONTACTS_EDIT,
    PERMISSIONS.CONTACTS_IMPORT,
    PERMISSIONS.CONTACTS_EXPORT,
    PERMISSIONS.CAMPAIGNS_VIEW,
    PERMISSIONS.CAMPAIGNS_CREATE,
    PERMISSIONS.CAMPAIGNS_EDIT,
    PERMISSIONS.CAMPAIGNS_SEND,
    PERMISSIONS.CAMPAIGNS_SCHEDULE,
    PERMISSIONS.TEMPLATES_VIEW,
    PERMISSIONS.TEMPLATES_CREATE,
    PERMISSIONS.TEMPLATES_EDIT,
    PERMISSIONS.TEMPLATES_SYNC,
    PERMISSIONS.INBOX_VIEW,
    PERMISSIONS.INBOX_SEND_MESSAGE,
    PERMISSIONS.INBOX_ASSIGN,
    PERMISSIONS.INBOX_CLOSE,
    PERMISSIONS.ANALYTICS_VIEW,
    PERMISSIONS.ANALYTICS_EXPORT,
    PERMISSIONS.SETTINGS_VIEW,
    PERMISSIONS.TEAM_VIEW,
  ],
  agent: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.CONTACTS_VIEW,
    PERMISSIONS.CAMPAIGNS_VIEW,
    PERMISSIONS.TEMPLATES_VIEW,
    PERMISSIONS.INBOX_VIEW,
    PERMISSIONS.INBOX_SEND_MESSAGE,
    PERMISSIONS.ANALYTICS_VIEW,
  ],
};

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertContactSchema = createInsertSchema(contacts).omit({
  id: true,
  createdAt: true,
});
export const insertCampaignSchema = createInsertSchema(campaigns).omit({
  id: true,
  createdAt: true,
});
export const insertChannelSchema = createInsertSchema(channels).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertTemplateSchema = createInsertSchema(templates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true,
  createdAt: true,
});
export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
});
export const insertAutomationSchema = createInsertSchema(automations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertAutomationNodeSchema = createInsertSchema(
  automationNodes
).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAutomationExecutionSchema = createInsertSchema(
  automationExecutions
).omit({ id: true, startedAt: true });
export const insertAutomationExecutionLogSchema = createInsertSchema(
  automationExecutionLogs
).omit({ id: true, executedAt: true });
export const insertAnalyticsSchema = createInsertSchema(analytics).omit({
  id: true,
  createdAt: true,
});
export const insertWhatsappChannelSchema = createInsertSchema(
  whatsappChannels
).omit({ id: true, createdAt: true, updatedAt: true });
export const insertWebhookConfigSchema = createInsertSchema(
  webhookConfigs
).omit({ id: true, createdAt: true });
export const insertMessageQueueSchema = createInsertSchema(messageQueue).omit({
  id: true,
  createdAt: true,
});
export const insertApiLogSchema = createInsertSchema(apiLogs).omit({
  id: true,
  createdAt: true,
});
export const insertCampaignRecipientSchema = createInsertSchema(
  campaignRecipients
).omit({ id: true, createdAt: true, updatedAt: true });
export const insertConversationAssignmentSchema = createInsertSchema(
  conversationAssignments
).omit({ id: true, createdAt: true, updatedAt: true });
export const insertUserActivityLogSchema = createInsertSchema(
  userActivityLogs
).omit({ id: true, createdAt: true });

export const insertSiteSchema = createInsertSchema(sites).omit({
  id: true,
  createdAt: true,
  widgetCode: true,
});

export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true,
  createdAt: true,
});

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Contact = typeof contacts.$inferSelect;
export type InsertContact = z.infer<typeof insertContactSchema>;
export type Campaign = typeof campaigns.$inferSelect;
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
export type Channel = typeof channels.$inferSelect;
export type InsertChannel = z.infer<typeof insertChannelSchema>;
export type Template = typeof templates.$inferSelect;
export type InsertTemplate = z.infer<typeof insertTemplateSchema>;
export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Automation = typeof automations.$inferSelect;
export type InsertAutomation = z.infer<typeof insertAutomationSchema>;
export type AutomationNode = typeof automationNodes.$inferSelect;
export type InsertAutomationNode = z.infer<typeof insertAutomationNodeSchema>;
export type AutomationExecution = typeof automationExecutions.$inferSelect;
export type InsertAutomationExecution = z.infer<
  typeof insertAutomationExecutionSchema
>;
export type AutomationExecutionLog =
  typeof automationExecutionLogs.$inferSelect;
export type InsertAutomationExecutionLog = z.infer<
  typeof insertAutomationExecutionLogSchema
>;
export type Analytics = typeof analytics.$inferSelect;
export type InsertAnalytics = z.infer<typeof insertAnalyticsSchema>;
export type WhatsappChannel = typeof whatsappChannels.$inferSelect;
export type InsertWhatsappChannel = z.infer<typeof insertWhatsappChannelSchema>;
export type WebhookConfig = typeof webhookConfigs.$inferSelect;
export type InsertWebhookConfig = z.infer<typeof insertWebhookConfigSchema>;
export type MessageQueue = typeof messageQueue.$inferSelect;
export type InsertMessageQueue = z.infer<typeof insertMessageQueueSchema>;
export type ApiLog = typeof apiLogs.$inferSelect;
export type InsertApiLog = z.infer<typeof insertApiLogSchema>;
export type CampaignRecipient = typeof campaignRecipients.$inferSelect;
export type InsertCampaignRecipient = z.infer<
  typeof insertCampaignRecipientSchema
>;
export type ConversationAssignment =
  typeof conversationAssignments.$inferSelect;
export type InsertConversationAssignment = z.infer<
  typeof insertConversationAssignmentSchema
>;
export type UserActivityLog = typeof userActivityLogs.$inferSelect;
export type InsertUserActivityLog = z.infer<typeof insertUserActivityLogSchema>;
export type PanelConfig = typeof panelConfig.$inferSelect;
export type NewPanelConfig = typeof panelConfig.$inferInsert;

export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notifications.$inferSelect;

export type Site = typeof sites.$inferSelect;
export type InsertSite = z.infer<typeof insertSiteSchema>;

export const channelsRelations = relations(channels, ({ many }) => ({
  contacts: many(contacts),
  campaigns: many(campaigns),
  templates: many(templates),
  conversations: many(conversations),
}));

export const contactsRelations = relations(contacts, ({ one, many }) => ({
  channel: one(channels, {
    fields: [contacts.channelId],
    references: [channels.id],
  }),
  conversations: many(conversations),
  campaignRecipients: many(campaignRecipients),
}));

export const campaignsRelations = relations(campaigns, ({ one, many }) => ({
  channel: one(channels, {
    fields: [campaigns.channelId],
    references: [channels.id],
  }),
  template: one(templates, {
    fields: [campaigns.templateId],
    references: [templates.id],
  }),
  recipients: many(campaignRecipients),
}));

export const campaignRecipientsRelations = relations(
  campaignRecipients,
  ({ one }) => ({
    campaign: one(campaigns, {
      fields: [campaignRecipients.campaignId],
      references: [campaigns.id],
    }),
    contact: one(contacts, {
      fields: [campaignRecipients.contactId],
      references: [contacts.id],
    }),
  })
);

export const templatesRelations = relations(templates, ({ one, many }) => ({
  channel: one(channels, {
    fields: [templates.channelId],
    references: [channels.id],
  }),
  campaigns: many(campaigns),
}));

export const conversationsRelations = relations(
  conversations,
  ({ one, many }) => ({
    channel: one(channels, {
      fields: [conversations.channelId],
      references: [channels.id],
    }),
    contact: one(contacts, {
      fields: [conversations.contactId],
      references: [contacts.id],
    }),

    messages: many(messages),
  })
);

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  assignedConversations: many(conversationAssignments, {
    relationName: "conversation_assigned_user", 
  }),
  assignedByConversations: many(conversationAssignments, {
    relationName: "conversation_assigned_by_user", 
  }),
  activityLogs: many(userActivityLogs),
}));

export const conversationAssignmentsRelations = relations(
  conversationAssignments,
  ({ one }) => ({
    conversation: one(conversations, {
      fields: [conversationAssignments.conversationId],
      references: [conversations.id],
    }),
    user: one(users, {
      fields: [conversationAssignments.userId],
      references: [users.id],
      relationName: "conversation_assigned_user",
    }),
    assignedByUser: one(users, {
      fields: [conversationAssignments.assignedBy],
      references: [users.id],
      relationName: "conversation_assigned_by_user",
    }),
  })
);

export const userActivityLogsRelations = relations(
  userActivityLogs,
  ({ one }) => ({
    user: one(users, {
      fields: [userActivityLogs.userId],
      references: [users.id],
    }),
  })
);

export const automationsRelations = relations(automations, ({ one, many }) => ({
  channel: one(channels, {
    fields: [automations.channelId],
    references: [channels.id],
  }),
  createdByUser: one(users, {
    fields: [automations.createdBy],
    references: [users.id],
  }),
  nodes: many(automationNodes),
  edges: many(automationEdges),
  executions: many(automationExecutions),
}));

export const trainingSources = pgTable("training_sources", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  siteId: varchar("site_id").notNull(),
  channelId: varchar("channel_id"),
  type: text("type").notNull(),
  name: text("name").notNull(),
  url: text("url"),
  content: text("content"),
  status: text("status").notNull().default("pending"),
  errorMessage: text("error_message"),
  chunkCount: integer("chunk_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const trainingChunks = pgTable("training_chunks", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  sourceId: varchar("source_id").notNull(),
  siteId: varchar("site_id").notNull(),
  content: text("content").notNull(),
  embedding: jsonb("embedding"),
  metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").defaultNow(),
});

export const trainingQaPairs = pgTable("training_qa_pairs", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  siteId: varchar("site_id").notNull(),
  channelId: varchar("channel_id"),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  category: text("category").default("general"),
  embedding: jsonb("embedding"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertTrainingSourceSchema = createInsertSchema(trainingSources);
export const insertTrainingQaPairSchema = createInsertSchema(trainingQaPairs);

export const automationNodesRelations = relations(
  automationNodes,
  ({ one }) => ({
    automation: one(automations, {
      fields: [automationNodes.automationId],
      references: [automations.id],
    }),
  })
);

export const automationEdgesRelations = relations(
  automationEdges,
  ({ one }) => ({
    automation: one(automations, {
      fields: [automationEdges.automationId],
      references: [automations.id],
    }),
  })
);

export const automationExecutionsRelations = relations(
  automationExecutions,
  ({ one, many }) => ({
    automation: one(automations, {
      fields: [automationExecutions.automationId],
      references: [automations.id],
    }),
    contact: one(contacts, {
      fields: [automationExecutions.contactId],
      references: [contacts.id],
    }),
    conversation: one(conversations, {
      fields: [automationExecutions.conversationId],
      references: [conversations.id],
    }),
    logs: many(automationExecutionLogs),
  })
);

export const automationExecutionLogsRelations = relations(
  automationExecutionLogs,
  ({ one }) => ({
    execution: one(automationExecutions, {
      fields: [automationExecutionLogs.executionId],
      references: [automationExecutions.id],
    }),
  })
);

export const clientApiKeys = pgTable("client_api_keys", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  channelId: varchar("channel_id").references(() => channels.id),
  name: varchar("name", { length: 100 }).notNull(),
  apiKey: varchar("api_key", { length: 64 }).notNull().unique(),
  secretHash: varchar("secret_hash", { length: 256 }).notNull(),
  permissions: jsonb("permissions").$type<string[]>().default(sql`'[]'`),
  isActive: boolean("is_active").default(true),
  lastUsedAt: timestamp("last_used_at"),
  requestCount: integer("request_count").default(0),
  monthlyRequestCount: integer("monthly_request_count").default(0),
  monthlyResetAt: timestamp("monthly_reset_at"),
  createdAt: timestamp("created_at").defaultNow(),
  revokedAt: timestamp("revoked_at"),
});

export const clientApiUsageLogs = pgTable("client_api_usage_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  apiKeyId: varchar("api_key_id").notNull().references(() => clientApiKeys.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  channelId: varchar("channel_id").references(() => channels.id),
  endpoint: varchar("endpoint", { length: 255 }).notNull(),
  method: varchar("method", { length: 10 }).notNull(),
  statusCode: integer("status_code"),
  responseTime: integer("response_time"),
  ipAddress: varchar("ip_address", { length: 45 }),
  createdAt: timestamp("created_at").defaultNow(),
});

export const clientWebhooks = pgTable("client_webhooks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  channelId: varchar("channel_id").references(() => channels.id),
  url: text("url").notNull(),
  secret: varchar("secret", { length: 256 }),
  events: jsonb("events").$type<string[]>().default(sql`'[]'`),
  isActive: boolean("is_active").default(true),
  lastTriggeredAt: timestamp("last_triggered_at"),
  failureCount: integer("failure_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const platformLanguages = pgTable("platform_languages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: varchar("code", { length: 10 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  nativeName: varchar("native_name", { length: 100 }).notNull(),
  icon: varchar("icon", { length: 10 }),
  direction: varchar("direction", { length: 3 }).notNull().default("ltr"),
  isEnabled: boolean("is_enabled").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false),
  translations: jsonb("translations").default(sql`'{}'`),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
