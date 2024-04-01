import { eq, and, inArray } from "drizzle-orm";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import {
  notifications,
  sentNotifications,
  notificationTemplates,
  userNotificationPreferences,
  users,
} from "@shared/schema";
import { db } from "server/db";
import nodemailer from "nodemailer";

export const NOTIFICATION_EVENTS = {
  NEW_MESSAGE: 'new_message',
  NEW_MESSAGE_DIGEST: 'new_message_digest',
  TEMPLATE_APPROVED: 'template_approved',
  TEMPLATE_REJECTED: 'template_rejected',
  CAMPAIGN_COMPLETED: 'campaign_completed',
  CAMPAIGN_FAILED: 'campaign_failed',
  CHANNEL_HEALTH_WARNING: 'channel_health_warning',
  TICKET_REPLY: 'ticket_reply',
} as const;

function replaceVariables(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? `{{${key}}}`);
}

async function getEmailTransporter() {
  const { getSMTPConfig } = await import("server/controllers/smtp.controller");
  const config = await getSMTPConfig();
  if (config) {
    const port = parseInt(config.port, 10);
    const secure = port === 465;
    return nodemailer.createTransport({
      host: config.host,
      port,
      secure,
      ...(!secure && (port === 587 || !!config.secure) ? { requireTLS: true } : {}),
      auth: {
        user: config.user,
        pass: config.password,
      },
    });
  }
  return nodemailer.createTransport({
    jsonTransport: true,
  });
}

export async function sendNotificationEmail(to: string, subject: string, htmlBody: string) {
  try {
    const transporter = await getEmailTransporter();
    const { getSMTPConfig } = await import("server/controllers/smtp.controller");
    const config = await getSMTPConfig();
    const fromName = config?.fromName || "Notifications";
    const fromEmail = config?.fromEmail || "noreply@example.com";

    const mailOptions = {
      from: `"${fromName}" <${fromEmail}>`,
      to,
      subject,
      html: htmlBody,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("✉️ [Notification Email] Sent to:", to);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("❌ [Notification Email] Failed to send:", error);
    return { success: false, error };
  }
}

export async function getUserNotificationPreferences(userId: string) {
  const prefs = await db
    .select()
    .from(userNotificationPreferences)
    .where(eq(userNotificationPreferences.userId, userId));

  if (prefs.length === 0) {
    const defaults: Record<string, { inAppEnabled: boolean; emailEnabled: boolean; soundEnabled: boolean }> = {};
    for (const event of Object.values(NOTIFICATION_EVENTS)) {
      defaults[event] = {
        inAppEnabled: true,
        emailEnabled: true,
        soundEnabled: true,
      };
    }
    return defaults;
  }

  const result: Record<string, { inAppEnabled: boolean; emailEnabled: boolean; soundEnabled: boolean }> = {};
  for (const pref of prefs) {
    result[pref.eventType] = {
      inAppEnabled: pref.inAppEnabled ?? true,
      emailEnabled: pref.emailEnabled ?? true,
      soundEnabled: pref.soundEnabled ?? true,
    };
  }

  for (const event of Object.values(NOTIFICATION_EVENTS)) {
    if (!result[event]) {
      result[event] = {
        inAppEnabled: true,
        emailEnabled: true,
        soundEnabled: true,
      };
    }
  }

  return result;
}

export async function updateUserNotificationPreference(
  userId: string,
  eventType: string,
  prefs: { inAppEnabled?: boolean; emailEnabled?: boolean; soundEnabled?: boolean }
) {
  const existing = await db
    .select()
    .from(userNotificationPreferences)
    .where(
      and(
        eq(userNotificationPreferences.userId, userId),
        eq(userNotificationPreferences.eventType, eventType)
      )
    );

  if (existing.length > 0) {
    const [updated] = await db
      .update(userNotificationPreferences)
      .set(prefs)
      .where(
        and(
          eq(userNotificationPreferences.userId, userId),
          eq(userNotificationPreferences.eventType, eventType)
        )
      )
      .returning();
    return updated;
  } else {
    const [inserted] = await db
      .insert(userNotificationPreferences)
      .values({
        userId,
        eventType,
        inAppEnabled: prefs.inAppEnabled ?? true,
        emailEnabled: prefs.emailEnabled ?? true,
        soundEnabled: prefs.soundEnabled ?? true,
      })
      .returning();
    return inserted;
  }
}

function generateCleanMessage(eventType: string, variables: Record<string, string>): string {
  switch (eventType) {
    case NOTIFICATION_EVENTS.NEW_MESSAGE:
      return `New message from ${variables.contactName || variables.contactPhone || "Unknown"}: ${variables.messagePreview || ""}`;
    case NOTIFICATION_EVENTS.TEMPLATE_APPROVED:
      return `Your template "${variables.templateName || ""}" has been approved and is ready to use.`;
    case NOTIFICATION_EVENTS.TEMPLATE_REJECTED:
      return `Your template "${variables.templateName || ""}" was rejected. ${variables.rejectionReason ? "Reason: " + variables.rejectionReason : ""}`;
    case NOTIFICATION_EVENTS.CAMPAIGN_COMPLETED:
      return `Campaign "${variables.campaignName || ""}" completed. Sent: ${variables.totalSent || "0"}, Delivered: ${variables.deliveredCount || "0"}, Failed: ${variables.failedCount || "0"}.`;
    case NOTIFICATION_EVENTS.CAMPAIGN_FAILED:
      return `Campaign "${variables.campaignName || ""}" had issues. Failed: ${variables.failedCount || "0"}. ${variables.errorMessage || ""}`;
    case NOTIFICATION_EVENTS.CHANNEL_HEALTH_WARNING:
      return `Channel ${variables.channelName || ""} (${variables.channelPhone || ""}) health: ${variables.healthStatus || "Warning"}. Quality: ${variables.qualityRating || "Unknown"}.`;
    case NOTIFICATION_EVENTS.TICKET_REPLY:
      return `New reply on ticket "${variables.ticketTitle || ""}": ${variables.messagePreview || ""}`;
    default:
      return variables.messagePreview || "You have a new notification.";
  }
}

function getNotificationLink(eventType: string): string {
  switch (eventType) {
    case NOTIFICATION_EVENTS.NEW_MESSAGE:
      return "/inbox";
    case NOTIFICATION_EVENTS.TEMPLATE_APPROVED:
    case NOTIFICATION_EVENTS.TEMPLATE_REJECTED:
      return "/templates";
    case NOTIFICATION_EVENTS.CAMPAIGN_COMPLETED:
    case NOTIFICATION_EVENTS.CAMPAIGN_FAILED:
      return "/campaigns";
    case NOTIFICATION_EVENTS.CHANNEL_HEALTH_WARNING:
      return "/settings";
    case NOTIFICATION_EVENTS.TICKET_REPLY:
      return "/support";
    default:
      return "/notifications";
  }
}

const THROTTLE_WINDOW_MS = 2 * 60 * 1000;
const THROTTLE_FLUSH_DELAY_MS = 30 * 1000;

interface ThrottleEntry {
  count: number;
  firstAt: number;
  contacts: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
  channelId?: string;
  channelName: string;
}

const throttleMap = new Map<string, ThrottleEntry>();

function isUserOnline(userId: string): boolean {
  const io = (global as any).io;
  if (!io) return false;
  const room = io.sockets.adapter.rooms.get(`user:${userId}`);
  return !!room && room.size > 0;
}

async function flushDigest(key: string) {
  const entry = throttleMap.get(key);
  if (!entry || entry.count === 0) {
    throttleMap.delete(key);
    return;
  }

  const parts = key.split(":");
  const userId = parts[0];
  const contactList = Array.from(entry.contacts);
  const contactSummary = contactList.length <= 3
    ? contactList.join(", ")
    : `${contactList.slice(0, 3).join(", ")} and ${contactList.length - 3} more`;

  const digestMessage = entry.count === 1
    ? `New message from ${contactSummary} on ${entry.channelName}`
    : `You have ${entry.count} new messages from ${contactList.length} contact${contactList.length > 1 ? "s" : ""} (${contactSummary}) on ${entry.channelName}`;

  const digestTitle = `${entry.count} new message${entry.count > 1 ? "s" : ""}`;

  throttleMap.delete(key);

  try {
    const io = (global as any).io;
    if (io) {
      io.to(`user:${userId}`).emit('notification:new', {
        id: `digest-${Date.now()}`,
        title: digestTitle,
        message: digestMessage,
        type: NOTIFICATION_EVENTS.NEW_MESSAGE,
        link: "/inbox",
        channelId: entry.channelId || null,
        createdAt: new Date().toISOString(),
        soundEnabled: true,
      });
    }

    const [notif] = await db
      .insert(notifications)
      .values({
        title: digestTitle,
        message: digestMessage,
        type: NOTIFICATION_EVENTS.NEW_MESSAGE,
        createdBy: "system",
        channelId: entry.channelId || null,
        targetType: "single",
        targetIds: [userId],
        status: "sent",
        sentAt: new Date(),
      })
      .returning();

    await db.insert(sentNotifications).values({
      notificationId: notif.id,
      userId,
    });

    if (!isUserOnline(userId)) {
      const userRows = await db.select().from(users).where(eq(users.id, userId));
      if (userRows.length > 0 && userRows[0].email) {
        const userPrefs = await getUserNotificationPreferences(userId);
        const eventPrefs = userPrefs[NOTIFICATION_EVENTS.NEW_MESSAGE] || { emailEnabled: true };
        if (eventPrefs.emailEnabled) {
          const [digestTemplate] = await db
            .select()
            .from(notificationTemplates)
            .where(eq(notificationTemplates.eventType, NOTIFICATION_EVENTS.NEW_MESSAGE_DIGEST));

          const userName = userRows[0].username || userRows[0].email || "User";
          const templateVars: Record<string, string> = {
            messageCount: String(entry.count),
            contactCount: String(contactList.length),
            contactSummary,
            channelName: entry.channelName,
            userName,
            appUrl: process.env.APP_URL || "",
          };

          let emailSubject = digestTitle;
          let emailHtml = `<p>${digestMessage}</p><p><a href="/inbox">Open Inbox</a></p>`;

          if (digestTemplate?.isEmailEnabled) {
            emailSubject = replaceVariables(digestTemplate.subject, templateVars);
            emailHtml = replaceVariables(digestTemplate.htmlBody, templateVars);
          }

          await sendNotificationEmail(userRows[0].email, emailSubject, emailHtml);
        }
      }
    }

    console.log(`[Notification Throttle] Flushed digest for user ${userId}: ${entry.count} messages from ${contactList.length} contacts`);
  } catch (error) {
    console.error("[Notification Throttle] Error flushing digest:", error);
  }
}

export async function triggerThrottledNotification(
  variables: Record<string, string>,
  targetUserIds: string[],
  channelId?: string
) {
  const contactName = variables.contactName || variables.contactPhone || "Unknown";
  const channelName = variables.channelName || "Unknown";

  for (const userId of targetUserIds) {
    const key = `${userId}:${channelId || "default"}`;
    const existing = throttleMap.get(key);

    if (existing) {
      existing.count++;
      existing.contacts.add(contactName);

      if (existing.timer) {
        clearTimeout(existing.timer);
      }
      existing.timer = setTimeout(() => flushDigest(key), THROTTLE_FLUSH_DELAY_MS);
      continue;
    }

    const now = Date.now();
    throttleMap.set(key, {
      count: 1,
      firstAt: now,
      contacts: new Set([contactName]),
      timer: null,
      channelId,
      channelName,
    });

    const skipEmail = isUserOnline(userId);

    try {
      await triggerNotification(
        NOTIFICATION_EVENTS.NEW_MESSAGE,
        variables,
        [userId],
        channelId,
        skipEmail
      );
    } catch (err) {
      console.error(`[Notification Throttle] Error sending first notification to ${userId}:`, err);
    }

    const entry = throttleMap.get(key);
    if (entry) {
      entry.count = 0;
      entry.contacts.clear();
    }

    setTimeout(() => {
      const entry = throttleMap.get(key);
      if (!entry) return;
      if (entry.count > 0) {
        flushDigest(key);
      } else {
        throttleMap.delete(key);
      }
    }, THROTTLE_WINDOW_MS);
  }
}

export async function triggerNotification(
  eventType: string,
  variables: Record<string, string>,
  targetUserIds: string[],
  channelId?: string,
  skipEmail: boolean = false
) {
  try {
    const [template] = await db
      .select()
      .from(notificationTemplates)
      .where(eq(notificationTemplates.eventType, eventType));

    if (!template) {
      console.warn(`[Notification] No template found for event: ${eventType}`);
      return { success: false, reason: "Template not found" };
    }

    const filteredUsers = await db
      .select()
      .from(users)
      .where(inArray(users.id, targetUserIds));

    const resolvedTitle = replaceVariables(template.subject, variables);
    const resolvedHtmlBody = replaceVariables(template.htmlBody, variables);
    const cleanMessage = generateCleanMessage(eventType, variables);
    const link = getNotificationLink(eventType);

    for (const user of filteredUsers) {
      const userPrefs = await getUserNotificationPreferences(user.id);
      const eventPrefs = userPrefs[eventType] || { inAppEnabled: true, emailEnabled: true, soundEnabled: true };

      const userVariables = { ...variables, userName: user.username || user.email || "User" };
      const userResolvedTitle = replaceVariables(template.subject, userVariables);
      const userResolvedHtmlBody = replaceVariables(template.htmlBody, userVariables);

      if (template.isInAppEnabled && eventPrefs.inAppEnabled) {
        const [notif] = await db
          .insert(notifications)
          .values({
            title: userResolvedTitle,
            message: cleanMessage,
            type: eventType,
            createdBy: "system",
            channelId: channelId || null,
            targetType: "single",
            targetIds: [user.id],
            status: "sent",
            sentAt: new Date(),
          })
          .returning();

        await db.insert(sentNotifications).values({
          notificationId: notif.id,
          userId: user.id,
        });

        const io = (global as any).io;
        if (io) {
          io.to(`user:${user.id}`).emit('notification:new', {
            id: notif.id,
            title: userResolvedTitle,
            message: cleanMessage,
            type: eventType,
            link,
            channelId: channelId || null,
            createdAt: notif.createdAt,
            soundEnabled: eventPrefs.soundEnabled !== false,
          });
        }
      }

      if (!skipEmail && template.isEmailEnabled && eventPrefs.emailEnabled && user.email) {
        await sendNotificationEmail(user.email, userResolvedTitle, userResolvedHtmlBody);
      }
    }

    return { success: true };
  } catch (error) {
    console.error("[Notification] Error triggering notification:", error);
    return { success: false, error };
  }
}
