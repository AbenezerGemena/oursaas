import { db } from "./db";
import {
  users,
  platformLanguages,
  panelConfig,
  notificationTemplates,
  plans,
  paymentProviders,
  whatsappBusinessAccountsConfig,
} from "@shared/schema";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";

interface User {
  username: string;
  password: string;
  email: string;
  firstName: string;
  lastName: string;
  role: "admin" | "user" | "superadmin";
  status: "active" | "inactive";
  permissions: string[];
  isEmailVerified?: boolean;
}

async function seed() {
  try {
    console.log("🌱 Seeding database...\n");

    
    
    
    console.log("━━━ [1/6] Users ━━━");

    async function createUserIfNotExists({ username, password, email, firstName, lastName, role, status, permissions }: User) {
      const [existingUser] = await db
        .select()
        .from(users)
        .where(eq(users.username, username));

      if (existingUser) {
        console.log(`  User '${username}' already exists`);
        return existingUser;
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const [newUser] = await db
        .insert(users)
        .values({
          username,
          password: hashedPassword,
          email,
          firstName,
          lastName,
          role,
          status,
          permissions,
          isEmailVerified: true
        })
        .returning();

      console.log(`  ✅ User '${username}' created`);
      return newUser;
    }

    const superAdminPermissions = [
      'dashboard:view',
      'campaigns:view', 'campaigns:create', 'campaigns:edit', 'campaigns:delete', 'campaigns:export',
      'templates:view', 'templates:create', 'templates:edit', 'templates:delete', 'templates:export',
      'contacts:view', 'contacts:create', 'contacts:edit', 'contacts:delete', 'contacts:export',
      'chathub:view', 'chathub:send', 'chathub:assign', 'chathub:delete',
      'botflow:view', 'botflow:create', 'botflow:edit', 'botflow:delete',
      'workflows:view', 'workflows:create', 'workflows:edit', 'workflows:delete',
      'aiassistant:use', 'aiassistant:configure',
      'autoresponses:view', 'autoresponses:create', 'autoresponses:edit', 'autoresponses:delete',
      'waba:view', 'waba:connect', 'waba:disconnect',
      'multi_number:view', 'multi_number:add', 'multi_number:edit', 'multi_number:delete',
      'webhooks:view', 'webhooks:create', 'webhooks:edit', 'webhooks:delete',
      'qrcodes:view', 'qrcodes:generate', 'qrcodes:delete',
      'crm:view',
      'leads:view', 'leads:create', 'leads:edit', 'leads:delete',
      'bulk_import:leads',
      'segmentation:view', 'segmentation:create', 'segmentation:edit', 'segmentation:delete',
      'analytics:view', 'message_logs:view', 'health_monitor:view',
      'reports:view', 'reports:export',
      'team:view', 'team:create', 'team:edit', 'team:delete',
      'support_tickets:view', 'support_tickets:create', 'support_tickets:edit', 'support_tickets:close',
      'notifications:view', 'notifications:send',
      'settings:view', 'settings:edit',
    ];

    const defaultPermissions = [
      'contacts:view', 'contacts:create', 'contacts:edit', 'contacts:delete', 'contacts:export',
      'campaigns:view', 'campaigns:create', 'campaigns:edit', 'campaigns:delete',
      'templates:view', 'templates:create', 'templates:edit', 'templates:delete', 'templates:sync',
      'analytics:view',
      'team:view', 'team:create', 'team:edit', 'team:delete',
      'settings:view',
      'inbox:view', 'inbox:send', 'inbox:assign',
      'automations:view', 'automations:create', 'automations:edit', 'automations:delete',
    ];

    const superadminUser = await createUserIfNotExists({
      username: "superadmin",
      password: "Superadmin@123",
      email: "superadmin@oursaas.com",
      firstName: "Super",
      lastName: "Admin",
      role: "superadmin",
      status: "active",
      isEmailVerified: true,
      permissions: superAdminPermissions,
    });

    await createUserIfNotExists({
      username: "demoadmin",
      password: "Admin@123",
      email: "demoadmin@oursaas.com",
      firstName: "Demo",
      lastName: "Admin",
      role: "superadmin",
      status: "active",
      permissions: defaultPermissions,
      isEmailVerified: true,
    });

    
    
    
    console.log("\n━━━ [2/6] Platform Languages ━━━");

    const languageConfigs = [
      { code: "en", name: "English", nativeName: "English", icon: "🇬🇧", direction: "ltr", isDefault: true, sortOrder: 0 },
      { code: "es", name: "Spanish", nativeName: "Español", icon: "🇪🇸", direction: "ltr", isDefault: false, sortOrder: 1 },
      { code: "fr", name: "French", nativeName: "Français", icon: "🇫🇷", direction: "ltr", isDefault: false, sortOrder: 2 },
      { code: "de", name: "German", nativeName: "Deutsch", icon: "🇩🇪", direction: "ltr", isDefault: false, sortOrder: 3 },
      { code: "pt", name: "Portuguese", nativeName: "Português", icon: "🇧🇷", direction: "ltr", isDefault: false, sortOrder: 4 },
      { code: "ar", name: "Arabic", nativeName: "العربية", icon: "🇸🇦", direction: "rtl", isDefault: false, sortOrder: 5 },
      { code: "hi", name: "Hindi", nativeName: "हिन्दी", icon: "🇮🇳", direction: "ltr", isDefault: false, sortOrder: 6 },
      { code: "zh", name: "Chinese", nativeName: "中文", icon: "🇨🇳", direction: "ltr", isDefault: false, sortOrder: 7 },
    ];

    for (const lang of languageConfigs) {
      const [existing] = await db
        .select()
        .from(platformLanguages)
        .where(eq(platformLanguages.code, lang.code));

      if (existing) {
        console.log(`  Language '${lang.name}' already exists`);
        continue;
      }

      let translations = {};
      const seedDir = path.dirname(new URL(import.meta.url).pathname);
      const translationPaths = [
        path.join(process.cwd(), "client", "src", "lib", "translations", `${lang.code}.json`),
        path.join(seedDir, "..", "client", "src", "lib", "translations", `${lang.code}.json`),
      ];

      for (const translationPath of translationPaths) {
        if (fs.existsSync(translationPath)) {
          try {
            const fileContent = fs.readFileSync(translationPath, "utf-8");
            translations = JSON.parse(fileContent);
            break;
          } catch (err) {
            console.log(`  ⚠️ Could not parse ${lang.code}.json, using empty translations`);
          }
        }
      }

      await db.insert(platformLanguages).values({
        code: lang.code,
        name: lang.name,
        nativeName: lang.nativeName,
        icon: lang.icon,
        direction: lang.direction,
        isEnabled: true,
        isDefault: lang.isDefault,
        translations,
        sortOrder: lang.sortOrder,
      });

      console.log(`  ✅ Language '${lang.name}' (${lang.code}) created`);
    }

    
    
    
    console.log("\n━━━ [3/6] Panel Config ━━━");

    const existingPanelConfigs = await db.select().from(panelConfig).limit(1);

    if (existingPanelConfigs.length > 0) {
      console.log("  Panel config already exists");
    } else {
      await db.insert(panelConfig).values({
        name: "OurSaas",
        tagline: "WhatsApp Marketing Platform",
        description: "A comprehensive SaaS platform for WhatsApp marketing, customer engagement, and business growth.",
        defaultLanguage: "en",
        supportedLanguages: ["en", "es", "fr", "de", "pt", "ar", "hi", "zh"],
        currency: "USD",
        country: "US",
        embeddedSignupEnabled: true,
        companyName: "Your Company",
        supportEmail: "support@example.com",
      });
      console.log("  ✅ Default panel config created");
    }

    
    
    
    console.log("\n━━━ [4/6] Notification Templates ━━━");

    const notifTemplates = [
      {
        eventType: "new_message",
        label: "New Message",
        description: "Sent when a new message is received from a contact",
        subject: "New message from {{contactName}}",
        htmlBody: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f9fafb;border-radius:8px">
  <div style="background:#25D366;padding:16px 24px;border-radius:8px 8px 0 0">
    <h2 style="color:#fff;margin:0;font-size:18px">💬 New Message Received</h2>
  </div>
  <div style="background:#fff;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb">
    <p style="color:#374151;font-size:14px;line-height:1.6">You have a new message from <strong>{{contactName}}</strong> ({{contactPhone}}):</p>
    <div style="background:#f3f4f6;padding:12px 16px;border-radius:6px;margin:16px 0;border-left:4px solid #25D366">
      <p style="color:#1f2937;font-size:14px;margin:0">{{messagePreview}}</p>
    </div>
    <a href="{{appUrl}}/inbox" style="display:inline-block;background:#25D366;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-size:14px;margin-top:8px">View in Inbox</a>
  </div>
</div>`,
        variables: ["contactName", "contactPhone", "messagePreview", "appUrl"],
      },
      {
        eventType: "template_approved",
        label: "Template Approved",
        description: "Sent when a WhatsApp message template is approved by Meta",
        subject: "Template '{{templateName}}' has been approved",
        htmlBody: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f9fafb;border-radius:8px">
  <div style="background:#059669;padding:16px 24px;border-radius:8px 8px 0 0">
    <h2 style="color:#fff;margin:0;font-size:18px">✅ Template Approved</h2>
  </div>
  <div style="background:#fff;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb">
    <p style="color:#374151;font-size:14px;line-height:1.6">Great news! Your WhatsApp message template <strong>"{{templateName}}"</strong> has been approved by Meta and is now ready to use.</p>
    <p style="color:#6b7280;font-size:13px">Category: {{category}}</p>
    <a href="{{appUrl}}/templates" style="display:inline-block;background:#059669;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-size:14px;margin-top:8px">View Templates</a>
  </div>
</div>`,
        variables: ["templateName", "category", "appUrl"],
      },
      {
        eventType: "template_rejected",
        label: "Template Rejected",
        description: "Sent when a WhatsApp message template is rejected by Meta",
        subject: "Template '{{templateName}}' was rejected",
        htmlBody: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f9fafb;border-radius:8px">
  <div style="background:#dc2626;padding:16px 24px;border-radius:8px 8px 0 0">
    <h2 style="color:#fff;margin:0;font-size:18px">❌ Template Rejected</h2>
  </div>
  <div style="background:#fff;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb">
    <p style="color:#374151;font-size:14px;line-height:1.6">Your WhatsApp message template <strong>"{{templateName}}"</strong> was rejected by Meta.</p>
    <div style="background:#fef2f2;padding:12px 16px;border-radius:6px;margin:16px 0;border-left:4px solid #dc2626">
      <p style="color:#991b1b;font-size:13px;margin:0"><strong>Reason:</strong> {{rejectionReason}}</p>
    </div>
    <p style="color:#6b7280;font-size:13px">Please review Meta's template guidelines and resubmit after making the necessary changes.</p>
    <a href="{{appUrl}}/templates" style="display:inline-block;background:#dc2626;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-size:14px;margin-top:8px">Edit Template</a>
  </div>
</div>`,
        variables: ["templateName", "rejectionReason", "appUrl"],
      },
      {
        eventType: "campaign_completed",
        label: "Campaign Completed",
        description: "Sent when a campaign finishes sending all messages",
        subject: "Campaign '{{campaignName}}' completed",
        htmlBody: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f9fafb;border-radius:8px">
  <div style="background:#2563eb;padding:16px 24px;border-radius:8px 8px 0 0">
    <h2 style="color:#fff;margin:0;font-size:18px">🎯 Campaign Completed</h2>
  </div>
  <div style="background:#fff;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb">
    <p style="color:#374151;font-size:14px;line-height:1.6">Your campaign <strong>"{{campaignName}}"</strong> has finished processing.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:8px 12px;background:#f3f4f6;border-radius:4px;color:#374151;font-size:13px">Total Sent</td><td style="padding:8px 12px;text-align:right;font-weight:bold;color:#1f2937">{{totalSent}}</td></tr>
      <tr><td style="padding:8px 12px;color:#374151;font-size:13px">Delivered</td><td style="padding:8px 12px;text-align:right;font-weight:bold;color:#059669">{{deliveredCount}}</td></tr>
      <tr><td style="padding:8px 12px;background:#f3f4f6;border-radius:4px;color:#374151;font-size:13px">Read</td><td style="padding:8px 12px;text-align:right;font-weight:bold;color:#2563eb">{{readCount}}</td></tr>
      <tr><td style="padding:8px 12px;color:#374151;font-size:13px">Failed</td><td style="padding:8px 12px;text-align:right;font-weight:bold;color:#dc2626">{{failedCount}}</td></tr>
    </table>
    <a href="{{appUrl}}/campaigns" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-size:14px;margin-top:8px">View Campaign</a>
  </div>
</div>`,
        variables: ["campaignName", "totalSent", "deliveredCount", "readCount", "failedCount", "appUrl"],
      },
      {
        eventType: "campaign_failed",
        label: "Campaign Failed",
        description: "Sent when a campaign encounters critical errors",
        subject: "Campaign '{{campaignName}}' has issues",
        htmlBody: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f9fafb;border-radius:8px">
  <div style="background:#dc2626;padding:16px 24px;border-radius:8px 8px 0 0">
    <h2 style="color:#fff;margin:0;font-size:18px">⚠️ Campaign Issues</h2>
  </div>
  <div style="background:#fff;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb">
    <p style="color:#374151;font-size:14px;line-height:1.6">Your campaign <strong>"{{campaignName}}"</strong> encountered issues during processing.</p>
    <div style="background:#fef2f2;padding:12px 16px;border-radius:6px;margin:16px 0;border-left:4px solid #dc2626">
      <p style="color:#991b1b;font-size:13px;margin:0"><strong>Failed messages:</strong> {{failedCount}}</p>
      <p style="color:#991b1b;font-size:13px;margin:4px 0 0 0">{{errorMessage}}</p>
    </div>
    <a href="{{appUrl}}/campaigns" style="display:inline-block;background:#dc2626;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-size:14px;margin-top:8px">Review Campaign</a>
  </div>
</div>`,
        variables: ["campaignName", "failedCount", "errorMessage", "appUrl"],
      },
      {
        eventType: "channel_health_warning",
        label: "Channel Health Warning",
        description: "Sent when a WhatsApp channel health status degrades",
        subject: "Channel health alert: {{channelName}}",
        htmlBody: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f9fafb;border-radius:8px">
  <div style="background:#d97706;padding:16px 24px;border-radius:8px 8px 0 0">
    <h2 style="color:#fff;margin:0;font-size:18px">🔔 Channel Health Alert</h2>
  </div>
  <div style="background:#fff;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb">
    <p style="color:#374151;font-size:14px;line-height:1.6">Your WhatsApp channel <strong>{{channelName}}</strong> ({{channelPhone}}) requires attention.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:8px 12px;background:#f3f4f6;border-radius:4px;color:#374151;font-size:13px">Health Status</td><td style="padding:8px 12px;text-align:right;font-weight:bold;color:#d97706">{{healthStatus}}</td></tr>
      <tr><td style="padding:8px 12px;color:#374151;font-size:13px">Quality Rating</td><td style="padding:8px 12px;text-align:right;font-weight:bold">{{qualityRating}}</td></tr>
    </table>
    <p style="color:#6b7280;font-size:13px">Please review your messaging practices to maintain good channel health.</p>
    <a href="{{appUrl}}/settings" style="display:inline-block;background:#d97706;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-size:14px;margin-top:8px">Check Settings</a>
  </div>
</div>`,
        variables: ["channelName", "channelPhone", "healthStatus", "qualityRating", "appUrl"],
      },
      {
        eventType: "ticket_reply",
        label: "Ticket Reply",
        description: "Sent when a support ticket receives a new reply",
        subject: "New reply on ticket: {{ticketTitle}}",
        htmlBody: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f9fafb;border-radius:8px">
  <div style="background:#7c3aed;padding:16px 24px;border-radius:8px 8px 0 0">
    <h2 style="color:#fff;margin:0;font-size:18px">💬 New Ticket Reply</h2>
  </div>
  <div style="background:#fff;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb">
    <p style="color:#374151;font-size:14px;line-height:1.6">There's a new reply on your support ticket <strong>"{{ticketTitle}}"</strong>:</p>
    <div style="background:#f3f4f6;padding:12px 16px;border-radius:6px;margin:16px 0;border-left:4px solid #7c3aed">
      <p style="color:#1f2937;font-size:14px;margin:0">{{messagePreview}}</p>
    </div>
    <a href="{{appUrl}}/support" style="display:inline-block;background:#7c3aed;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-size:14px;margin-top:8px">View Ticket</a>
  </div>
</div>`,
        variables: ["ticketTitle", "messagePreview", "appUrl"],
      },
      {
        eventType: "new_message_digest",
        label: "New Messages Digest",
        description: "Sent as a batched summary when multiple messages are received within a short period",
        subject: "{{messageCount}} new messages on {{channelName}}",
        htmlBody: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f9fafb;border-radius:8px">
  <div style="background:#25D366;padding:16px 24px;border-radius:8px 8px 0 0">
    <h2 style="color:#fff;margin:0;font-size:18px">💬 {{messageCount}} New Messages</h2>
  </div>
  <div style="background:#fff;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb">
    <p style="color:#374151;font-size:14px;line-height:1.6">Hello {{userName}},</p>
    <p style="color:#374151;font-size:14px;line-height:1.6">You have received <strong>{{messageCount}} new messages</strong> from <strong>{{contactCount}} contact(s)</strong> on <strong>{{channelName}}</strong>.</p>
    <div style="background:#f3f4f6;padding:12px 16px;border-radius:6px;margin:16px 0;border-left:4px solid #25D366">
      <p style="color:#1f2937;font-size:14px;margin:0"><strong>Contacts:</strong> {{contactSummary}}</p>
    </div>
    <p style="color:#6b7280;font-size:13px">Log in to your inbox to view and respond to these messages.</p>
    <a href="{{appUrl}}/inbox" style="display:inline-block;background:#25D366;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-size:14px;margin-top:8px">Open Inbox</a>
  </div>
</div>`,
        variables: ["messageCount", "contactCount", "contactSummary", "channelName", "userName", "appUrl"],
      },
    ];

    for (const tmpl of notifTemplates) {
      const [existing] = await db
        .select()
        .from(notificationTemplates)
        .where(eq(notificationTemplates.eventType, tmpl.eventType));

      if (existing) {
        console.log(`  Notification template '${tmpl.label}' already exists`);
        continue;
      }

      await db.insert(notificationTemplates).values({
        eventType: tmpl.eventType,
        label: tmpl.label,
        description: tmpl.description,
        subject: tmpl.subject,
        htmlBody: tmpl.htmlBody,
        isEmailEnabled: true,
        isInAppEnabled: true,
        variables: tmpl.variables,
      });

      console.log(`  ✅ Notification template '${tmpl.label}' created`);
    }

    
    
    
    console.log("\n━━━ [5/6] Subscription Plans ━━━");

    const existingPlans = await db.select().from(plans).limit(1);

    if (existingPlans.length > 0) {
      console.log("  Plans already exist");
    } else {
      const defaultPlans = [
        {
          name: "Free",
          description: "Get started with WhatsApp marketing. Perfect for small businesses and testing.",
          icon: "Sparkles",
          popular: false,
          badge: "Free Forever",
          color: "#6b7280",
          buttonColor: "#6b7280",
          monthlyPrice: "0",
          annualPrice: "0",
          permissions: {
            channel: "1",
            contacts: "500",
            automation: "1",
            apiRequestsPerMonth: "1000",
            apiRateLimitPerMinute: "10",
          },
          features: [
            { name: "1 WhatsApp Channel", included: true },
            { name: "Up to 500 Contacts", included: true },
            { name: "1 Automation Workflow", included: true },
            { name: "Basic Analytics", included: true },
            { name: "Template Management", included: true },
            { name: "1,000 API Requests/month", included: true },
            { name: "Community Support", included: true },
            { name: "AI Auto-Reply", included: false },
            { name: "Team Members", included: false },
            { name: "Priority Support", included: false },
          ],
        },
        {
          name: "Professional",
          description: "Scale your WhatsApp marketing with advanced features and more capacity.",
          icon: "Zap",
          popular: true,
          badge: "Most Popular",
          color: "#2563eb",
          buttonColor: "#2563eb",
          monthlyPrice: "29",
          annualPrice: "290",
          permissions: {
            channel: "3",
            contacts: "5000",
            automation: "10",
            apiRequestsPerMonth: "50000",
            apiRateLimitPerMinute: "60",
          },
          features: [
            { name: "3 WhatsApp Channels", included: true },
            { name: "Up to 5,000 Contacts", included: true },
            { name: "10 Automation Workflows", included: true },
            { name: "Advanced Analytics", included: true },
            { name: "Template Management", included: true },
            { name: "50,000 API Requests/month", included: true },
            { name: "AI Auto-Reply", included: true },
            { name: "Up to 5 Team Members", included: true },
            { name: "Campaign Scheduling", included: true },
            { name: "Email Support", included: true },
          ],
        },
        {
          name: "Enterprise",
          description: "Unlimited access with premium support for high-volume businesses.",
          icon: "Crown",
          popular: false,
          badge: "Best Value",
          color: "#7c3aed",
          buttonColor: "#7c3aed",
          monthlyPrice: "99",
          annualPrice: "990",
          permissions: {
            channel: "unlimited",
            contacts: "unlimited",
            automation: "unlimited",
            apiRequestsPerMonth: "unlimited",
            apiRateLimitPerMinute: "300",
          },
          features: [
            { name: "Unlimited WhatsApp Channels", included: true },
            { name: "Unlimited Contacts", included: true },
            { name: "Unlimited Automations", included: true },
            { name: "Advanced Analytics & Reports", included: true },
            { name: "Template Management", included: true },
            { name: "Unlimited API Requests", included: true },
            { name: "AI Auto-Reply + Knowledge Base", included: true },
            { name: "Unlimited Team Members", included: true },
            { name: "Campaign Scheduling", included: true },
            { name: "Priority Support", included: true },
          ],
        },
      ];

      for (const plan of defaultPlans) {
        await db.insert(plans).values(plan);
        console.log(`  ✅ Plan '${plan.name}' created`);
      }
    }

    
    
    
    console.log("\n━━━ [6/6] Payment Providers & WABA Config ━━━");

    const defaultProviders = [
      {
        name: "Stripe",
        providerKey: "stripe",
        description: "Accept payments via credit/debit cards worldwide",
        logo: "stripe",
        isActive: false,
        config: {},
        supportedCurrencies: ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "CHF", "SGD", "HKD", "NZD"],
        supportedMethods: ["card"],
      },
      {
        name: "Razorpay",
        providerKey: "razorpay",
        description: "Accept payments via cards, UPI, wallets, and netbanking in India",
        logo: "razorpay",
        isActive: false,
        config: {},
        supportedCurrencies: ["INR"],
        supportedMethods: ["card", "upi", "wallet", "netbanking"],
      },
      {
        name: "PayPal",
        providerKey: "paypal",
        description: "Accept payments via PayPal and credit/debit cards globally",
        logo: "paypal",
        isActive: false,
        config: {},
        supportedCurrencies: ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "CHF", "SGD", "HKD", "NZD", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "ILS", "MXN", "BRL", "TWD", "THB", "PHP", "MYR"],
        supportedMethods: ["paypal", "card"],
      },
      {
        name: "Paystack",
        providerKey: "paystack",
        description: "Accept payments via cards, bank transfers, and mobile money in Africa",
        logo: "paystack",
        isActive: false,
        config: {},
        supportedCurrencies: ["NGN", "GHS", "ZAR", "KES", "USD"],
        supportedMethods: ["card", "bank_transfer", "mobile_money", "ussd"],
      },
      {
        name: "Mercado Pago",
        providerKey: "mercadopago",
        description: "Accept payments via cards, Pix, and boleto in Latin America",
        logo: "mercadopago",
        isActive: false,
        config: {},
        supportedCurrencies: ["BRL", "ARS", "MXN", "CLP", "COP", "PEN", "UYU"],
        supportedMethods: ["card", "pix", "boleto", "debit"],
      },
    ];

    for (const provider of defaultProviders) {
      const [existing] = await db
        .select()
        .from(paymentProviders)
        .where(eq(paymentProviders.providerKey, provider.providerKey));

      if (existing) {
        console.log(`  Payment provider '${provider.name}' already exists`);
        continue;
      }

      await db.insert(paymentProviders).values(provider);
      console.log(`  ✅ Payment provider '${provider.name}' created (inactive — configure API keys in settings)`);
    }

    const existingWabaConfig = await db.select().from(whatsappBusinessAccountsConfig).limit(1);

    if (existingWabaConfig.length > 0) {
      if (existingWabaConfig[0].createdBy === "" && superadminUser?.id) {
        await db
          .update(whatsappBusinessAccountsConfig)
          .set({ createdBy: superadminUser.id })
          .where(eq(whatsappBusinessAccountsConfig.id, existingWabaConfig[0].id));
        console.log("  WABA config already exists — updated createdBy to superadmin");
      } else {
        console.log("  WABA config already exists");
      }
    } else {
      await db.insert(whatsappBusinessAccountsConfig).values({
        appId: "",
        appSecret: "",
        configId: "",
        isActive: false,
        createdBy: superadminUser?.id || "",
      });
      console.log("  ✅ WABA config placeholder created (configure in settings)");
    }

    
    
    
    console.log("\n╔════════════════════════════════════════════╗");
    console.log("║         Seed Completed Successfully        ║");
    console.log("╠════════════════════════════════════════════╣");
    console.log("║                                            ║");
    console.log("║  Default Login Credentials:                ║");
    console.log("║  ─────────────────────────                 ║");
    console.log("║  Super Admin:                              ║");
    console.log("║    Username: superadmin                    ║");
    console.log("║    Password: Superadmin@123                ║");
    console.log("║                                            ║");
    console.log("║  Demo Admin (restricted):                  ║");
    console.log("║    Username: demoadmin                     ║");
    console.log("║    Password: Admin@123                     ║");
    console.log("║                                            ║");
    console.log("║  Next Steps:                               ║");
    console.log("║  1. Login as superadmin                    ║");
    console.log("║  2. Configure WABA in Settings             ║");
    console.log("║  3. Set up Payment Gateway keys            ║");
    console.log("║  4. Customize branding in Settings         ║");
    console.log("║                                            ║");
    console.log("╚════════════════════════════════════════════╝");

  } catch (error) {
    console.error("❌ Error seeding database:", error);
    process.exit(1);
  }
}

seed()
  .then(() => {
    console.log("\n✅ Seeding completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Seeding failed:", error);
    process.exit(1);
  });
