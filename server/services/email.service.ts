import nodemailer from "nodemailer";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import { getSMTPConfig } from "server/controllers/smtp.controller";
import { getFirstPanelConfig, getPanelConfigs } from "./panel.config";
import { cacheGet, cacheInvalidate, CACHE_KEYS, CACHE_TTL } from './cache';

let transporter: any = null;

function resolveLogoUrl(smtpLogo?: string | null, panelLogo?: string | null): string | undefined {
  const logo = smtpLogo || panelLogo;
  if (!logo) return undefined;
  if (logo.startsWith("http://") || logo.startsWith("https://")) return logo;
  const baseUrl = (process.env.APP_URL || ("" ? `https://${""}` : "")).replace(/\/$/, "");
  if (!baseUrl) return undefined;
  const path = logo.startsWith("/") ? logo : `/uploads/${logo}`;
  return `${baseUrl}${path}`;
}

async function getTransporter() {
  if (transporter) return transporter;

  const config = await getSMTPConfig();

  if (config) {
    const port = parseInt(config.port, 10);
    const secure = port === 465;

    transporter = nodemailer.createTransport({
      host: config.host,
      port,
      secure,
      ...(!secure && (port === 587 || !!config.secure) ? { requireTLS: true } : {}),
      auth: {
        user: config.user,
        pass: config.password,
      },
    });
  } else {
    console.warn("Using fallback SMTP settings (emails will not be sent)");
    transporter = nodemailer.createTransport({
      jsonTransport: true,
    });
  }

  return transporter;
}

async function getConfig() {
  return getSMTPConfig();
}

async function getPanelConfig() {
  const configs = await getPanelConfigs();
  return Array.isArray(configs) ? configs[0] : configs;
}

export function resetEmailCache() {
  transporter = null;
  cacheInvalidate(CACHE_KEYS.smtpConfig()).catch(() => {});
  cacheInvalidate(CACHE_KEYS.panelConfig()).catch(() => {});
}

function generateOTPEmailHTML(
  companyName?: string,
  logo?: string,
  otpCode?: string,
  name?: string
): string {
  const displayName = companyName || "Your Company";
  const headerContent = logo
    ? `<img src="${logo}" alt="${displayName} Logo" style="max-height: 60px; margin-bottom: 10px;">`
    : `<div class="logo">${displayName}</div>`;

  const messageText = `Please use the verification code below to verify your identity.`;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .container { background: #ffffff; border-radius: 8px; padding: 40px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .logo { font-size: 28px; font-weight: bold; color: #1f2937; margin-bottom: 10px; }
        .otp-box { background: #f3f4f6; border: 2px solid #e5e7eb; border-radius: 8px; padding: 20px; text-align: center; margin: 30px 0; }
        .otp-code { font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #1f2937; font-family: 'Courier New', monospace; }
        .message { font-size: 16px; color: #4b5563; margin: 20px 0; }
        .warning { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px; margin: 20px 0; font-size: 14px; color: #92400e; }
        .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          ${headerContent}
          <p style="color: #6b7280; margin: 0;">Our Platform</p>
        </div>
        
        <div class="message">
          ${name ? `<p>Hello <strong>${name}</strong>,</p>` : "<p>Hello,</p>"}
          <p>${messageText}</p>
        </div>
        
        <div class="otp-box">
          <div style="font-size: 14px; color: #6b7280; margin-bottom: 10px;">Your Verification Code</div>
          <div class="otp-code">${otpCode}</div>
          <div style="font-size: 12px; color: #9ca3af; margin-top: 10px;">Valid for 5 minutes</div>
        </div>
        
        <div class="warning">
          <strong>Security Notice:</strong> Never share this code with anyone. ${displayName} will never ask for your verification code.
        </div>
        
        <div class="message">
          <p>If you didn't request this code, please ignore this email or contact our support team.</p>
        </div>
        
        <div class="footer">
          <p>This is an automated message from ${displayName}.</p>
          <p>&copy; ${new Date().getFullYear()} ${displayName}. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

function generateOTPEmailText(
  companyName: string,
  otpCode: string,
  name?: string
): string {
  return `
Hello${name ? " " + name : ""},

Thank you for signing up for ${companyName}!

Your verification code is: ${otpCode}

This code will expire in 5 minutes.

If you didn't request this code, please ignore this email.

---
${companyName}
Our Platform
  `.trim();
}

function generateForgotPasswordEmailHTML(
  companyName?: string,
  logo?: string,
  otpCode?: string,
  name?: string
): string {
  const displayName = companyName || "Your Company";
  const headerContent = logo
    ? `<img src="${logo}" alt="${displayName} Logo" style="max-height: 60px; margin-bottom: 10px;">`
    : `<div class="logo">${displayName}</div>`;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .container { background: #ffffff; border-radius: 8px; padding: 40px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .logo { font-size: 28px; font-weight: bold; color: #1f2937; margin-bottom: 10px; }
        .otp-box { background: #f3f4f6; border: 2px solid #e5e7eb; border-radius: 8px; padding: 20px; text-align: center; margin: 30px 0; }
        .otp-code { font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #1f2937; font-family: 'Courier New', monospace; }
        .message { font-size: 16px; color: #4b5563; margin: 20px 0; }
        .warning { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px; margin: 20px 0; font-size: 14px; color: #92400e; }
        .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          ${headerContent}
          <p style="color: #6b7280; margin: 0;">Our Platform</p>
        </div>

        <div class="message">
          ${name ? `<p>Hello <strong>${name}</strong>,</p>` : "<p>Hello,</p>"}
          <p>You requested to reset your password. Use the verification code below to reset your password.</p>
        </div>

        <div class="otp-box">
          <div style="font-size: 14px; color: #6b7280; margin-bottom: 10px;">Your Verification Code</div>
          <div class="otp-code">${otpCode}</div>
          <div style="font-size: 12px; color: #9ca3af; margin-top: 10px;">Valid for 5 minutes</div>
        </div>

        <div class="warning">
          <strong>Security Notice:</strong> Never share this code with anyone. ${displayName} will never ask for your verification code.
        </div>

        <div class="message">
          <p>If you didn't request this password reset, please ignore this email or contact our support team.</p>
        </div>

        <div class="footer">
          <p>This is an automated message from ${displayName}.</p>
          <p>&copy; ${new Date().getFullYear()} ${displayName}. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

function generateForgotPasswordEmailText(
  companyName: string,
  otpCode: string,
  name?: string
): string {
  return `
Hello${name ? " " + name : ""},

You requested to reset your password for ${companyName}.

Your verification code is: ${otpCode}

This code will expire in 5 minutes.

If you didn't request a password reset, please ignore this email.

---
${companyName}
Our Platform
  `.trim();
}

export async function sendOTPEmail(
  email: string,
  otpCode: string,
  name?: string
) {
  const config = await getConfig();
  const configs = await getPanelConfig();
  const mailer = await getTransporter();

  const companyName = configs?.name || "Your Company";
  const fromName = config?.fromName || companyName;
  const fromEmail = config?.fromEmail;

  const mailOptions = {
    from: `"${fromName}" <${fromEmail}>`,
    to: email,
    subject: `Your ${companyName} Verification Code`,
    html: generateForgotPasswordEmailHTML(
      companyName,
      resolveLogoUrl(config?.logo, configs?.logo),
      otpCode,
      name
    ),
    text: generateForgotPasswordEmailText(companyName, otpCode, name),
  };

  try {
    const info = await mailer.sendMail(mailOptions);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("[Email] Failed to send OTP:", error);
    throw new Error("Failed to send verification email");
  }
}

export async function sendContactEmail(data: {
  name: string;
  email: string;
  company?: string;
  subject: string;
  message: string;
}) {
  const { name, email, company, subject, message } = data;

  const config = await getConfig();
  const configs = await getPanelConfig();
  const mailer = await getTransporter();

  const companyName = configs?.name || "Your Company";
  const fromName = config?.fromName || companyName;
  const fromEmail = config?.fromEmail;

  const html = `
  <div style="background:#f4f5f7; padding:40px; font-family:Arial, sans-serif;">
    <div style="max-width:600px; margin:auto; background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 4px 12px rgba(0,0,0,0.08);">
      <div style="background:#4f46e5; padding:24px; color:#ffffff; text-align:center;">
        <h2 style="margin:0; font-size:24px; font-weight:600;">New Contact Form Message</h2>
        <p style="margin:6px 0 0; opacity:0.85;">${companyName}</p>
      </div>
      <div style="padding:30px;">
        <p style="font-size:16px; color:#111827;">You have received a new message from your website contact form.</p>
        <table style="width:100%; margin-top:20px;">
          <tr>
            <td style="padding:10px 0; font-size:16px; font-weight:600; width:150px; color:#374151;">Name:</td>
            <td style="padding:10px 0; font-size:16px; color:#111827;">${name}</td>
          </tr>
          <tr>
            <td style="padding:10px 0; font-size:16px; font-weight:600; color:#374151;">Email:</td>
            <td style="padding:10px 0; font-size:16px; color:#111827;">${email}</td>
          </tr>
          <tr>
            <td style="padding:10px 0; font-size:16px; font-weight:600; color:#374151;">Company:</td>
            <td style="padding:10px 0; font-size:16px; color:#111827;">${company || "-"}</td>
          </tr>
          <tr>
            <td style="padding:10px 0; font-size:16px; font-weight:600; color:#374151;">Subject:</td>
            <td style="padding:10px 0; font-size:16px; color:#111827;">${subject}</td>
          </tr>
        </table>
        <div style="margin-top:30px;">
          <p style="font-size:16px; font-weight:600; color:#374151; margin-bottom:8px;">Message:</p>
          <div style="background:#f9fafb; padding:20px; border-radius:10px; font-size:15px; line-height:1.6; color:#111827;">
            ${message.replace(/\n/g, "<br>")}
          </div>
        </div>
      </div>
      <div style="background:#f3f4f6; padding:18px; text-align:center; font-size:13px; color:#6b7280;">
        This email was sent from the contact form on <strong>${companyName}</strong>.
      </div>
    </div>
  </div>
`;

  const mailOptions = {
    from: `"${fromName}" <${fromEmail}>`,
    to: fromEmail,
    subject: `Contact Form: ${subject}`,
    html,
    text: `${name} (${email}) says: ${message}`,
  };

  try {
    const info = await mailer.sendMail(mailOptions);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("[Contact] Failed:", error);
    throw new Error("Failed to send contact message");
  }
}

export async function sendOTPEmailVerify(
  email: string,
  otpCode: string,
  name?: string
) {
  const config = await getConfig();
  const configs = await getPanelConfig();
  const mailer = await getTransporter();

  const companyName = configs?.name || "Your Company";
  const fromName = config?.fromName || companyName;
  const fromEmail = config?.fromEmail;

  const mailOptions = {
    from: `"${fromName}" <${fromEmail}>`,
    to: email,
    subject: `Your ${companyName} Verification Code`,
    html: generateOTPEmailHTML(companyName, resolveLogoUrl(config?.logo, configs?.logo), otpCode, name),
    text: generateOTPEmailText(companyName, otpCode, name),
  };

  try {
    const info = await mailer.sendMail(mailOptions);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("[Email] Failed to send OTP:", error);
    throw new Error("Failed to send verification email");
  }
}

export async function verifyEmailConfiguration(): Promise<boolean> {
  try {
    const mailer = await getTransporter();
    await mailer.verify();
    return true;
  } catch (error) {
    console.error("[Email] SMTP configuration error:", error);
    return false;
  }
}
