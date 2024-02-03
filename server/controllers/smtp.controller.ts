import { Request, Response } from 'express';
import { OurSaasError, asyncHandler as _dHandler, oursaasLogger, HTTP_STATUS } from "@oursaas/core";
import { db } from '../db';
import { smtpConfig } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { sendContactEmail, resetEmailCache } from 'server/services/email.service';
import { cacheGet, cacheInvalidate, CACHE_KEYS, CACHE_TTL } from '../services/cache';

export const upsertSMTPConfig = async (req: Request, res: Response) => {
  try {
    const {
      host,
      port,
      secure,
      user,
      password,
      fromName,
      fromEmail,
      logo,
    } = req.body;

    
    const existingConfig = await db.select().from(smtpConfig).limit(1);

    let result;
    if (existingConfig.length > 0) {
      
      result = await db
        .update(smtpConfig)
        .set({
          host,
          port,
          secure,
          user,
          password,
          fromName,
          fromEmail,
          logo,
          updatedAt: new Date(),
        })
        .where(eq(smtpConfig.id, existingConfig[0].id))
        .returning();
    } else {
      
      result = await db
        .insert(smtpConfig)
        .values({
          host,
          port,
          secure,
          user,
          password,
          fromName,
          fromEmail,
          logo,
        })
        .returning();
    }

    await cacheInvalidate(CACHE_KEYS.smtpConfig());
    resetEmailCache();

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error('SMTP upsert error:', error);
    res
      .status(500)
      .json({ success: false, message: 'Failed to save SMTP config', error });
  }
};

export const getSMTPConfigHandler = async (req: Request, res: Response) => {
  try {
    
    const config = await db.select().from(smtpConfig).limit(1);

    if (!config || config.length === 0) {
      return res.status(404).json({
        success: false,
        message: "SMTP configuration not found",
      });
    }

    res.status(200).json({
      success: true,
      data: config[0],
    });
  } catch (error) {
    console.error("SMTP fetch error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch SMTP configuration",
      error,
    });
  }
};

export const getSMTPConfig = async () => {
  return cacheGet(CACHE_KEYS.smtpConfig(), CACHE_TTL.smtpConfig, async () => {
    const configs = await db.select().from(smtpConfig).limit(1);
    if (!configs || configs.length === 0) {
      console.warn('⚠️ No SMTP configuration found');
      return null;
    }
    return configs[0];
  });
};

export const sendMailRoute = async (req: Request, res: Response) => {
  try {
    const { name, email, company, subject, message } = req.body;

    if (!name || !email || !subject || !message) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    const result = await sendContactEmail({
      name,
      email,
      company,
      subject,
      message,
    });

    console.log("Contact form email sent:", result);

    return res.json({
      success: true,
      message: "Message sent successfully",
      messageId: result.messageId,
    });
  } catch (error: any) {
    console.error("Contact form error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to send message",
    });
  }
}
