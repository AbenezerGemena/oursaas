import type { Request, Response } from 'express';
import { OurSaasError, asyncHandler as _dHandler, oursaasLogger, HTTP_STATUS } from "@oursaas/core";
import { storage } from '../storage';
import { insertTemplateSchema } from '@shared/schema';
import { AppError, asyncHandler } from '../middlewares/error.middleware';
import { WhatsAppApiService } from '../services/whatsapp-api';
import type { RequestWithChannel } from '../middlewares/channel.middleware';
import fs from "fs";
import sharp from 'sharp';

export const getTemplates = asyncHandler(
  async (req: RequestWithChannel, res: Response) => {
    const channelId = req.query.channelId as string | undefined;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 100;
    const user = (req.session as any)?.user;

    let result;

    if (channelId) {
      if (user && user.role !== 'superadmin') {
        const ownerId = user.role === 'team' ? user.createdBy : user.id;
        const channels = await storage.getChannelsByUserId(ownerId);
        const channelIds = channels.map((ch: any) => ch.id);
        if (!channelIds.includes(channelId)) {
          return res.status(403).json({ error: 'Access denied to this channel' });
        }
      }
      result = await storage.getTemplatesByChannel(channelId, page, limit);
    } else if (user && user.role === 'superadmin') {
      result = await storage.getTemplates(page, limit);
    } else {
      const ownerId = user?.role === 'team' ? user?.createdBy : user?.id;
      if (!ownerId) {
        return res.status(200).json({ success: true, data: [], pagination: { page, limit, total: 0, totalPages: 0 } });
      }
      const channels = await storage.getChannelsByUserId(ownerId);
      if (channels.length === 0) {
        return res.status(200).json({ success: true, data: [], pagination: { page, limit, total: 0, totalPages: 0 } });
      }
      result = await storage.getTemplatesByChannel(channels[0].id, page, limit);
    }

    res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  }
);

export const getTemplatesByUser = asyncHandler(async (req: RequestWithChannel, res: Response) => {
  const channelId = req.query.channelId as string;
  const userId = (req.session as any).user.id;
  if (!channelId) {
    return res.status(400).json({ message: "channelId is required" });
  }

  const templates = await storage.getTemplatesByChannelAndUser(channelId, userId);
  res.json(templates);
});

export const getTemplate = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const template = await storage.getTemplate(id);
  if (!template) {
    throw new AppError(404, 'Template not found');
  }
  const user = (req.session as any)?.user;
  if (user && user.role !== 'superadmin' && template.channelId) {
    const ownerId = user.role === 'team' ? user.createdBy : user.id;
    const channels = await storage.getChannelsByUserId(ownerId);
    const channelIds = channels.map((ch: any) => ch.id);
    if (!channelIds.includes(template.channelId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
  }
  res.json(template);
});

export const getTemplateByUserID = asyncHandler(async (req: Request, res: Response) => {
  const { userId, page = 1, limit = 10 } = req.body;
  const user = (req.session as any)?.user;

  if (user && user.role !== 'superadmin') {
    const ownerId = user.role === 'team' ? user.createdBy : user.id;
    if (userId !== ownerId && userId !== user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
  }

  const templates = await storage.getTemplatesByUserId(userId, Number(page), Number(limit));

  if (!templates || templates.data.length === 0) {
    return res.status(404).json({ status: 'error', message: 'Template not found' });
  }

  res.json({
    status: 'success',
    data: templates.data,
    pagination: {
      page: templates.page,
      limit: templates.limit,
      total: templates.total,
      totalPages: templates.totalPages,
    },
  });
});

export const createTemplate = asyncHandler(
  async (req: RequestWithChannel, res: Response) => {
    const mediaFile =
      Array.isArray(req.files?.mediaFile) ? req.files.mediaFile[0] : undefined;

    const validatedTemplate = req.body;

    let category = validatedTemplate.category?.toLowerCase() || "marketing";
    if (!["marketing", "utility", "authentication"].includes(category)) {
      category = "marketing";
    }
    category = category.toUpperCase();

    const mediaType = validatedTemplate.mediaType
      ? validatedTemplate.mediaType.toLowerCase()
      : "text";

    const isAuthentication = category === "AUTHENTICATION";
    const marketingSubType = validatedTemplate.marketingSubType || "CUSTOM";

    const bodyText = validatedTemplate.body || "";
    const placeholderPattern = /\{\{(\d+)\}\}/g;
    const placeholders = bodyText
      ? Array.from(bodyText.matchAll(placeholderPattern))
          .map((m: any) => parseInt(m[1], 10))
          .sort((a: number, b: number) => a - b)
      : [];

    for (let i = 0; i < placeholders.length; i++) {
      if (placeholders[i] !== i + 1) {
        throw new AppError(400, "Placeholders must be sequential starting from {{1}}");
      }
    }

    let samples: string[] = [];
    if (validatedTemplate.samples) {
      if (typeof validatedTemplate.samples === "string") {
        samples = JSON.parse(validatedTemplate.samples);
      } else if (Array.isArray(validatedTemplate.samples)) {
        samples = validatedTemplate.samples;
      }
    }

    if (placeholders.length && samples.length !== placeholders.length) {
      throw new AppError(400, `Expected ${placeholders.length} sample values, got ${samples.length}`);
    }

    const channelId = validatedTemplate.channelId;
    if (!channelId) throw new AppError(400, "channelId is required");

    const createdBy = req.user?.id;
    if (!createdBy) throw new AppError(401, "User not authenticated");

    const channel = await storage.getChannel(channelId);
    if (!channel) throw new AppError(404, "Channel not found");

    try {
      const whatsappApi = new WhatsAppApiService(channel);
      const components: any[] = [];

      let mediaId: string | undefined;
      let headerHandle: string | undefined;

      if (isAuthentication) {
        const authType = validatedTemplate.authType || "COPY_CODE";
        const codeExpiry = parseInt(validatedTemplate.authCodeExpiry) || 10;
        const securityDisclaimer = validatedTemplate.authSecurityDisclaimer !== "false";

        const authBody: any = {
          type: "BODY",
          add_security_recommendation: securityDisclaimer,
        };
        components.push(authBody);

        components.push({
          type: "FOOTER",
          code_expiration_minutes: codeExpiry,
        });

        if (authType === "COPY_CODE") {
          components.push({
            type: "BUTTONS",
            buttons: [{ type: "OTP", otp_type: "COPY_CODE", text: "Copy Code" }],
          });
        } else if (authType === "ONE_TAP") {
          const otpBtn: any = {
            type: "OTP",
            otp_type: "ONE_TAP",
            text: "Autofill",
            autofill_text: "Autofill",
            package_name: validatedTemplate.authPackageName || "",
            signature_hash: validatedTemplate.authSignatureHash || "",
          };
          components.push({ type: "BUTTONS", buttons: [otpBtn] });
        } else if (authType === "ZERO_TAP") {
          const otpBtn: any = {
            type: "OTP",
            otp_type: "ZERO_TAP",
            text: "Autofill",
            autofill_text: "Autofill",
            package_name: validatedTemplate.authPackageName || "",
            signature_hash: validatedTemplate.authSignatureHash || "",
          };
          components.push({ type: "BUTTONS", buttons: [otpBtn] });
        }
      } else {
        if (mediaType === "text" && validatedTemplate.header) {
          const headerObj: any = {
            type: "HEADER",
            format: "TEXT",
            text: validatedTemplate.header,
          };
          if (validatedTemplate.headerVariable && validatedTemplate.header.includes("{{1}}")) {
            headerObj.example = {
              header_text: [validatedTemplate.headerVariable],
            };
          }
          components.push(headerObj);
        }

        if (mediaType !== "text") {
          if (!mediaFile || !mediaFile.path) {
            throw new AppError(400, "Media header requires file upload");
          }
          const fileBuffer = fs.readFileSync(mediaFile.path);

          try {
            mediaId = await whatsappApi.uploadMediaBufferHeader(
              fileBuffer, mediaFile.mimetype, mediaFile.originalname
            );
            headerHandle = await whatsappApi.uploadTemplateMedia(
              fileBuffer, mediaFile.mimetype, mediaFile.originalname
            );
          } finally {
            try { fs.unlinkSync(mediaFile.path); } catch {}
          }

          components.push({
            type: "HEADER",
            format: mediaType.toUpperCase(),
            example: { header_handle: [headerHandle] },
          });
        }

        if (marketingSubType === "LIMITED_TIME_OFFER") {
          const ltoComponent: any = {
            type: "LIMITED_TIME_OFFER",
            limited_time_offer: {
              text: validatedTemplate.offerText || "",
              has_expiration: validatedTemplate.hasExpiration === "true" || validatedTemplate.hasExpiration === true,
            },
          };
          components.push(ltoComponent);
        }

        const bodyObj: any = { type: "BODY", text: bodyText };
        if (placeholders.length > 0) {
          bodyObj.example = { body_text: [samples] };
        }
        components.push(bodyObj);

        if (validatedTemplate.footer && marketingSubType !== "LIMITED_TIME_OFFER") {
          components.push({ type: "FOOTER", text: validatedTemplate.footer });
        }

        let buttons = validatedTemplate.buttons;
        if (typeof buttons === "string") {
          try { buttons = JSON.parse(buttons); } catch { buttons = []; }
        }

        if (marketingSubType === "COUPON_CODE") {
          const couponCode = validatedTemplate.couponCode || "";
          const existingBtns = Array.isArray(buttons) ? buttons : [];
          const copyCodeBtn: any = {
            type: "COPY_CODE",
            example: couponCode,
          };
          const allButtons = [copyCodeBtn, ...existingBtns.map((btn: any) => {
            const obj: any = { type: btn.type, text: btn.text };
            if (btn.url) obj.url = btn.url;
            if (btn.phoneNumber) obj.phone_number = btn.phoneNumber;
            return obj;
          })];
          components.push({ type: "BUTTONS", buttons: allButtons });
        } else if (Array.isArray(buttons) && buttons.length > 0) {
          components.push({
            type: "BUTTONS",
            buttons: buttons.map((btn: any) => {
              const obj: any = { type: btn.type, text: btn.text };
              if (btn.type === "URL" && btn.url) obj.url = btn.url;
              if (btn.type === "PHONE_NUMBER" && btn.phoneNumber) obj.phone_number = btn.phoneNumber;
              if (btn.type === "COPY_CODE") {
                obj.example = btn.couponCode || "";
              }
              return obj;
            }),
          });
        }

        if (marketingSubType === "CAROUSEL") {
          let carouselCards = validatedTemplate.carouselCards;
          if (typeof carouselCards === "string") {
            try { carouselCards = JSON.parse(carouselCards); } catch { carouselCards = []; }
          }
          if (Array.isArray(carouselCards) && carouselCards.length >= 2) {
            const allFiles = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
            for (let idx = 0; idx < carouselCards.length; idx++) {
              if (!allFiles?.[`carouselCardMedia_${idx}`]?.[0]) {
                throw new AppError(400, `Card ${idx + 1} is missing sample media. Each carousel card requires an image or video for Meta template review.`);
              }
            }
            const cards = [];
            for (let idx = 0; idx < carouselCards.length; idx++) {
              const card = carouselCards[idx];
              const cardComponents: any[] = [];
              const cardMediaType = (card.mediaType || "image").toUpperCase();
              const headerComp: any = {
                type: "HEADER",
                format: cardMediaType,
              };

              const cardMediaFiles = allFiles?.[`carouselCardMedia_${idx}`];
              const cardMediaFile = cardMediaFiles?.[0];
              if (cardMediaFile && cardMediaFile.path) {
                const cardFileBuffer = fs.readFileSync(cardMediaFile.path);
                try {
                  const cardHandle = await whatsappApi.uploadTemplateMedia(
                    cardFileBuffer, cardMediaFile.mimetype, cardMediaFile.originalname
                  );
                  headerComp.example = { header_handle: [cardHandle] };
                } finally {
                  try { fs.unlinkSync(cardMediaFile.path); } catch {}
                }
              }

              cardComponents.push(headerComp);
              if (card.body) {
                cardComponents.push({ type: "BODY", text: card.body });
              }
              if (card.buttons?.length) {
                cardComponents.push({
                  type: "BUTTONS",
                  buttons: card.buttons.map((btn: any) => {
                    const obj: any = { type: btn.type, text: btn.text };
                    if (btn.type === "URL" && btn.url) obj.url = btn.url;
                    if (btn.type === "PHONE_NUMBER" && btn.phoneNumber) obj.phone_number = btn.phoneNumber;
                    return obj;
                  }),
                });
              }
              cards.push({ components: cardComponents });
            }
            components.push({ type: "CAROUSEL", cards });
          }
        }
      }

      const templatePayload: any = {
        name: validatedTemplate.name,
        category,
        language: validatedTemplate.language,
        components,
      };

      if (category === "MARKETING" && validatedTemplate.creativeOptimizations) {
        try {
          const opts = typeof validatedTemplate.creativeOptimizations === "string"
            ? JSON.parse(validatedTemplate.creativeOptimizations)
            : validatedTemplate.creativeOptimizations;
          const creative_features_spec: Record<string, { enroll_status: string }> = {};
          for (const [key, value] of Object.entries(opts)) {
            creative_features_spec[key] = { enroll_status: value === "OPT_OUT" ? "OPT_OUT" : "OPT_IN" };
          }
          templatePayload.degrees_of_freedom_spec = { creative_features_spec };
        } catch (e) {
          console.warn("Invalid creativeOptimizations format, skipping:", e);
        }
      }

      if (validatedTemplate.messageTtlSeconds) {
        const ttl = parseInt(validatedTemplate.messageTtlSeconds, 10);
        if (isNaN(ttl)) {
          throw new AppError(400, "messageTtlSeconds must be a valid number");
        }
        const ttlRanges: Record<string, { min: number; max: number; label: string }> = {
          MARKETING: { min: 43200, max: 2592000, label: "12 hours to 30 days (43200–2592000 seconds)" },
          UTILITY: { min: 30, max: 43200, label: "30 seconds to 12 hours (30–43200 seconds)" },
          AUTHENTICATION: { min: 30, max: 900, label: "30 seconds to 15 minutes (30–900 seconds)" },
        };
        const range = ttlRanges[category];
        if (range && (ttl < range.min || ttl > range.max)) {
          throw new AppError(400, `TTL for ${category} templates must be ${range.label}. Got ${ttl} seconds.`);
        }
        if (range) {
          templatePayload.message_send_ttl_seconds = ttl;
        }
      }

      const result = await whatsappApi.createTemplate(templatePayload);

      if (!result?.id) {
        throw new Error("WhatsApp did not return template ID");
      }

      const template = await storage.createTemplate({
        ...validatedTemplate,
        category,
        channelId,
        createdBy,
        status: (result.status || "PENDING").toUpperCase(),
        whatsappTemplateId: result.id,
        mediaType,
        mediaHandle: headerHandle,
        mediaUrl: mediaId,
        variables: samples,
      });

      return res.json(template);
    } catch (err: any) {
      const errorMsg = err?.response?.data?.error?.error_user_msg
        || err?.response?.data?.error?.message
        || err?.message
        || "Template creation failed";

      return res.status(500).json({
        success: false,
        message: errorMsg,
        error: err.message,
      });
    }
  }
);

async function waitForTemplateDeletion(api: WhatsAppApiService, templateName: string) {

  for (let i = 0; i < 20; i++) {   
    await new Promise((resolve) => setTimeout(resolve, 5000)); 

    try {
      const status = await api.getTemplateStatus(templateName);

      
      if (status === "NOT_FOUND") {
        return;
      }

      
      if (status === "DELETING" || status === "PENDING_DELETION") {
        continue;
      }

    } catch (err) {
      
      return;
    }
  }

  throw new Error("⚠️ Timeout: template language still deleting after 100 seconds");
}

export const updateTemplate = asyncHandler(
  async (req: RequestWithChannel, res: Response) => {
    const { id } = req.params;
    const validatedTemplate = req.body;

    
    const existingTemplate = await storage.getTemplate(id);
    if (!existingTemplate) throw new AppError(404, "Template not found");

    
    const hasWhatsappTemplate = !!existingTemplate.whatsappTemplateId;

    
    const mediaFile =
      Array.isArray(req.files?.mediaFile) ? req.files.mediaFile[0] : undefined;

    
    let category =
      validatedTemplate.category?.toLowerCase() ||
      existingTemplate.category?.toLowerCase() ||
      "authentication";

    if (!["marketing", "utility", "authentication"].includes(category)) {
      category = "authentication";
    }
    category = category.toUpperCase();

    const mediaType = validatedTemplate.mediaType
      ? validatedTemplate.mediaType.toLowerCase()
      : "text";

    
    if (!validatedTemplate.body) {
      throw new AppError(400, "body is required");
    }

    const placeholderPattern = /\{\{(\d+)\}\}/g;
    const placeholderMatches = Array.from(
      validatedTemplate.body.matchAll(placeholderPattern)
    );

    const placeholders = placeholderMatches
      .map((m) => parseInt(m[1], 10))
      .sort((a, b) => a - b);

    for (let i = 0; i < placeholders.length; i++) {
      if (placeholders[i] !== i + 1) {
        throw new AppError(
          400,
          "Placeholders must be sequential starting from {{1}}"
        );
      }
    }

    
    let samples: string[] = [];

    if (validatedTemplate.samples) {
      if (typeof validatedTemplate.samples === "string") {
        try {
          samples = JSON.parse(validatedTemplate.samples);
        } catch {
          throw new AppError(400, "Invalid samples format");
        }
      } else if (Array.isArray(validatedTemplate.samples)) {
        samples = validatedTemplate.samples;
      }
    }

    if (placeholders.length > 0) {
      if (samples.length !== placeholders.length) {
        throw new AppError(
          400,
          `Expected ${placeholders.length} sample values, got ${samples.length}`
        );
      }

      if (samples.some((s) => !String(s).trim())) {
        throw new AppError(
          400,
          "Sample values for template variables cannot be empty"
        );
      }
    }

    
    const channelId = validatedTemplate.channelId || existingTemplate.channelId;
    if (!channelId) throw new AppError(400, "channelId is required");

    const channel = await storage.getChannel(channelId);
    if (!channel) throw new AppError(400, "Channel not found");

    
    const updatePayload: Record<string, any> = {
      name: validatedTemplate.name,
      category,
      language: validatedTemplate.language,
      body: validatedTemplate.body,
      samples,
      footer: validatedTemplate.footer,
      buttons: validatedTemplate.buttons,
      channelId,
      status: "pending",
      updatedAt: new Date(),
    };

    
    Object.keys(updatePayload).forEach(
      (k) => updatePayload[k] === undefined && delete updatePayload[k]
    );

    if (Object.keys(updatePayload).length === 0) {
      throw new AppError(400, "No fields provided to update");
    }

    const updatedTemplate = await storage.updateTemplate(id, updatePayload);

    
    const whatsappApi = new WhatsAppApiService(channel);

    
    try {
      const components: any[] = [];

      
      if (mediaType === "text" && validatedTemplate.header) {
        components.push({
          type: "HEADER",
          format: "TEXT",
          text: validatedTemplate.header,
        });
      }

      if (mediaType !== "text") {
        let mediaId: string;

        if (mediaFile) {
          mediaId = await whatsappApi.uploadTemplateMedia(
            mediaFile.buffer,
            mediaFile.mimetype,
            mediaFile.originalname
          );
          await new Promise((r) => setTimeout(r, 1000));
        } else if (validatedTemplate.mediaUrl) {
          let mimeType = "image/jpeg";
          if (mediaType === "video") mimeType = "video/mp4";
          if (mediaType === "document") mimeType = "application/pdf";

          mediaId = await whatsappApi.uploadMediaFromUrl(
            validatedTemplate.mediaUrl,
            mimeType
          );
          await new Promise((r) => setTimeout(r, 1000));
        } else {
          throw new AppError(
            400,
            "Media header requires file upload or mediaUrl"
          );
        }

        if (!/^\d+$/.test(mediaId)) {
          throw new AppError(400, `Invalid media ID: ${mediaId}`);
        }

        components.push({
          type: "HEADER",
          format: mediaType.toUpperCase(),
          example: {
            header_handle: [mediaId],
          },
        });
      }

      
      const bodyObj: any = {
        type: "BODY",
        text: validatedTemplate.body,
      };

      if (placeholders.length > 0) {
        bodyObj.example = {
          body_text: [samples],
        };
      }

      components.push(bodyObj);

      
      if (validatedTemplate.footer) {
        components.push({
          type: "FOOTER",
          text: validatedTemplate.footer,
        });
      }

      
      if (validatedTemplate.buttons) {
        const buttons =
          typeof validatedTemplate.buttons === "string"
            ? JSON.parse(validatedTemplate.buttons)
            : validatedTemplate.buttons;

        if (Array.isArray(buttons) && buttons.length) {
          components.push({
            type: "BUTTONS",
            buttons: buttons.map((btn: any) => {
              const type =
                btn.type === "URL"
                  ? "URL"
                  : btn.type === "PHONE_NUMBER"
                  ? "PHONE_NUMBER"
                  : "QUICK_REPLY";

              const obj: any = { type, text: btn.text };
              if (type === "URL") obj.url = btn.url;
              if (type === "PHONE_NUMBER")
                obj.phone_number = btn.phoneNumber;
              return obj;
            }),
          });
        }
      }

      
      const templatePayload: any = {
        name: validatedTemplate.name,
        category,
        language: validatedTemplate.language,
        components,
      };

      if (category === "MARKETING" && validatedTemplate.creativeOptimizations) {
        try {
          const opts = typeof validatedTemplate.creativeOptimizations === "string"
            ? JSON.parse(validatedTemplate.creativeOptimizations)
            : validatedTemplate.creativeOptimizations;
          const creative_features_spec: Record<string, { enroll_status: string }> = {};
          for (const [key, value] of Object.entries(opts)) {
            creative_features_spec[key] = { enroll_status: value === "OPT_OUT" ? "OPT_OUT" : "OPT_IN" };
          }
          templatePayload.degrees_of_freedom_spec = { creative_features_spec };
        } catch (e) {
          console.warn("Invalid creativeOptimizations format, skipping:", e);
        }
      }

      if (validatedTemplate.messageTtlSeconds) {
        const ttl = parseInt(validatedTemplate.messageTtlSeconds, 10);
        if (!isNaN(ttl)) {
          const ttlRanges: Record<string, { min: number; max: number; label: string }> = {
            MARKETING: { min: 43200, max: 2592000, label: "12 hours to 30 days (43200–2592000 seconds)" },
            UTILITY: { min: 30, max: 43200, label: "30 seconds to 12 hours (30–43200 seconds)" },
            AUTHENTICATION: { min: 30, max: 900, label: "30 seconds to 15 minutes (30–900 seconds)" },
          };
          const range = ttlRanges[category];
          if (range && (ttl < range.min || ttl > range.max)) {
            throw new AppError(400, `TTL for ${category} templates must be ${range.label}. Got ${ttl} seconds.`);
          }
          if (range) {
            templatePayload.message_send_ttl_seconds = ttl;
          }
        }
      }

      let result: any;

      if (hasWhatsappTemplate && existingTemplate.whatsappTemplateId) {
        
        try {
          const editPayload: any = { category, components };
          if (templatePayload.degrees_of_freedom_spec) {
            editPayload.degrees_of_freedom_spec = templatePayload.degrees_of_freedom_spec;
          }
          if (templatePayload.message_send_ttl_seconds) {
            editPayload.message_send_ttl_seconds = templatePayload.message_send_ttl_seconds;
          }
          result = await whatsappApi.editTemplate(
            existingTemplate.whatsappTemplateId,
            editPayload
          );

          
          if (result?.id) {
            await storage.updateTemplate(updatedTemplate.id, {
              whatsappTemplateId: result.id,
              status: (result.status || "PENDING").toUpperCase(),
            });
          }

          return res.json({
            ...updatedTemplate,
            message: "Template edited successfully on WhatsApp",
          });
        } catch (editError: any) {
          console.warn("⚠️ Edit failed, falling back to delete + create:", editError.message);

          
          try {
            await whatsappApi.deleteTemplate(existingTemplate.name);
            await waitForTemplateDeletion(whatsappApi, existingTemplate.name);
          } catch {
            console.warn("⚠️ Failed to delete old template");
          }

          result = await whatsappApi.createTemplate(templatePayload);
        }
      } else {
        result = await whatsappApi.createTemplate(templatePayload);
      }

      if (result?.id) {
        await storage.updateTemplate(updatedTemplate.id, {
          whatsappTemplateId: result.id,
          status: (result.status || "PENDING").toUpperCase(),
        });
      }

      return res.json({
        ...updatedTemplate,
        message: "Template updated and submitted to WhatsApp",
      });
    } catch (err: any) {
      console.error("❌ Update template error:", err);
      return res.json({
        ...updatedTemplate,
        warning: "Template updated locally but failed to submit to WhatsApp",
        error: err.message,
      });
    }
  }
);

export const updateTemplate4JANNN2026 = asyncHandler(
  async (req: RequestWithChannel, res: Response) => {
    const { id } = req.params;
    const validatedTemplate = req.body;

    
    const existingTemplate = await storage.getTemplate(id);
    if (!existingTemplate) throw new AppError(404, "Template not found");

    
    const mediaFile =
      Array.isArray(req.files?.mediaFile) ? req.files.mediaFile[0] : undefined;

    
    let category =
      validatedTemplate.category?.toLowerCase() ||
      existingTemplate.category?.toLowerCase() ||
      "authentication";

    if (!["marketing", "utility", "authentication"].includes(category)) {
      category = "authentication";
    }
    category = category.toUpperCase();

    const mediaType = validatedTemplate.mediaType
      ? validatedTemplate.mediaType.toLowerCase()
      : "text";

    
    if (!validatedTemplate.body) {
      throw new AppError(400, "body is required");
    }

    const placeholderPattern = /\{\{(\d+)\}\}/g;
    const placeholderMatches = Array.from(
      validatedTemplate.body.matchAll(placeholderPattern)
    );

    const placeholders = placeholderMatches
      .map((m) => parseInt(m[1], 10))
      .sort((a, b) => a - b);

    for (let i = 0; i < placeholders.length; i++) {
      if (placeholders[i] !== i + 1) {
        throw new AppError(
          400,
          "Placeholders must be sequential starting from {{1}}"
        );
      }
    }

    
    let samples: string[] = [];

    if (validatedTemplate.samples) {
      if (typeof validatedTemplate.samples === "string") {
        try {
          samples = JSON.parse(validatedTemplate.samples);
        } catch {
          throw new AppError(400, "Invalid samples format");
        }
      } else if (Array.isArray(validatedTemplate.samples)) {
        samples = validatedTemplate.samples;
      }
    }

    if (placeholders.length > 0) {
      if (samples.length !== placeholders.length) {
        throw new AppError(
          400,
          `Expected ${placeholders.length} sample values, got ${samples.length}`
        );
      }

      if (samples.some((s) => !String(s).trim())) {
        throw new AppError(
          400,
          "Sample values for template variables cannot be empty"
        );
      }
    }

    
    const channelId = validatedTemplate.channelId || existingTemplate.channelId;
    if (!channelId) throw new AppError(400, "channelId is required");

    const channel = await storage.getChannel(channelId);
    if (!channel) throw new AppError(400, "Channel not found");

    
    const updatePayload: Record<string, any> = {
      name: validatedTemplate.name,
      category,
      language: validatedTemplate.language,
      body: validatedTemplate.body,
      samples,
      footer: validatedTemplate.footer,
      buttons: validatedTemplate.buttons,
      channelId,
      status: "pending",
      updatedAt: new Date(), 
    };

    
    Object.keys(updatePayload).forEach(
      (k) => updatePayload[k] === undefined && delete updatePayload[k]
    );

    if (Object.keys(updatePayload).length === 0) {
      throw new AppError(400, "No fields provided to update");
    }

    const updatedTemplate = await storage.updateTemplate(id, updatePayload);

    
    const whatsappApi = new WhatsAppApiService(channel);

    
    if (existingTemplate.whatsappTemplateId) {
      try {
        await whatsappApi.deleteTemplate(existingTemplate.name);
        await waitForTemplateDeletion(whatsappApi, existingTemplate.name);
      } catch {
        console.warn("⚠️ Failed to delete old template. Continuing.");
      }
    }

    
    try {
      const components: any[] = [];

      
      if (mediaType === "text" && validatedTemplate.header) {
        components.push({
          type: "HEADER",
          format: "TEXT",
          text: validatedTemplate.header,
        });
      }

      if (mediaType !== "text") {
        let mediaId: string;

        if (mediaFile) {
          mediaId = await whatsappApi.uploadTemplateMedia(
            mediaFile.buffer,
            mediaFile.mimetype,
            mediaFile.originalname
          );
          await new Promise((r) => setTimeout(r, 1000));
        } else if (validatedTemplate.mediaUrl) {
          let mimeType = "image/jpeg";
          if (mediaType === "video") mimeType = "video/mp4";
          if (mediaType === "document") mimeType = "application/pdf";

          mediaId = await whatsappApi.uploadMediaFromUrl(
            validatedTemplate.mediaUrl,
            mimeType
          );
          await new Promise((r) => setTimeout(r, 1000));
        } else {
          throw new AppError(
            400,
            "Media header requires file upload or mediaUrl"
          );
        }

        if (!/^\d+$/.test(mediaId)) {
          throw new AppError(400, `Invalid media ID: ${mediaId}`);
        }

        components.push({
          type: "HEADER",
          format: mediaType.toUpperCase(),
          example: {
            header_handle: [mediaId],
          },
        });
      }

      
      const bodyObj: any = {
        type: "BODY",
        text: validatedTemplate.body,
      };

      if (placeholders.length > 0) {
        bodyObj.example = {
          body_text: [samples],
        };
      }

      components.push(bodyObj);

      
      if (validatedTemplate.footer) {
        components.push({
          type: "FOOTER",
          text: validatedTemplate.footer,
        });
      }

      
      if (validatedTemplate.buttons) {
        const buttons =
          typeof validatedTemplate.buttons === "string"
            ? JSON.parse(validatedTemplate.buttons)
            : validatedTemplate.buttons;

        if (Array.isArray(buttons) && buttons.length) {
          components.push({
            type: "BUTTONS",
            buttons: buttons.map((btn: any) => {
              const type =
                btn.type === "URL"
                  ? "URL"
                  : btn.type === "PHONE_NUMBER"
                  ? "PHONE_NUMBER"
                  : "QUICK_REPLY";

              const obj: any = { type, text: btn.text };
              if (type === "URL") obj.url = btn.url;
              if (type === "PHONE_NUMBER")
                obj.phone_number = btn.phoneNumber;
              return obj;
            }),
          });
        }
      }

      
      const templatePayload = {
        name: validatedTemplate.name,
        category,
        language: validatedTemplate.language,
        components,
      };

      const result = await whatsappApi.createTemplate(templatePayload);

      if (result?.id) {
        await storage.updateTemplate(updatedTemplate.id, {
          whatsappTemplateId: result.id,
          status: (result.status || "PENDING").toUpperCase(),
        });
      }

      return res.json({
        ...updatedTemplate,
        message: "Template updated and resubmitted to WhatsApp",
      });
    } catch (err: any) {
      console.error("❌ Update template error:", err);
      return res.json({
        ...updatedTemplate,
        warning: "Template updated locally but failed to submit to WhatsApp",
        error: err.message,
      });
    }
  }
);

export const deleteTemplate = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const success = await storage.deleteTemplate(id);
  if (!success) {
    throw new AppError(404, 'Template not found');
  }
  res.status(204).send();
});

export const syncTemplates30DECCE = asyncHandler(
  async (req: RequestWithChannel, res: Response) => {
    let channelId =
      (req.body.channelId as string) ||
      (req.query.channelId as string) ||
      req.channelId;

    if (!channelId) {
      const activeChannel = await storage.getActiveChannel();
      if (!activeChannel) {
        throw new AppError(400, "No active channel found");
      }
      channelId = activeChannel.id;
    }

    const channel = await storage.getChannel(channelId);
    if (!channel) throw new AppError(404, "Channel not found");

    const whatsappApi = new WhatsAppApiService(channel);
    const whatsappTemplates = await whatsappApi.getTemplates();

    const { data: dbTemplates } = await storage.getTemplatesByChannel(channelId);
    const existingTemplates = Array.isArray(dbTemplates) ? dbTemplates : [];

    
    if (existingTemplates.length > 0) {
    }

    
    existingTemplates.forEach(t => {
    });

    
    const existingByWhatsappId = new Map<string, any>();
    const existingByName = new Map<string, any>();

    for (const t of existingTemplates) {
      if (t.whatsappTemplateId) {
        const normalizedId = String(t.whatsappTemplateId).trim();
        existingByWhatsappId.set(normalizedId, t);
      }
      if (t.name) {
        const normalizedName = t.name.trim().toLowerCase();
        existingByName.set(normalizedName, t);
      }
    }

    let updatedCount = 0;
    let skippedCount = 0;
    let createdCount = 0;
    const detailedResults: any[] = [];

    for (const waTemplate of whatsappTemplates) {
      const waId = String(waTemplate.id).trim();
      const waName = waTemplate.name.trim();
      const waNameLower = waName.toLowerCase();
      const waStatus = (waTemplate.status || "PENDING").toUpperCase();

      
      let existing = existingByWhatsappId.get(waId);
      let matchMethod = "NONE";
      
      if (existing) {
        matchMethod = "BY_WHATSAPP_ID";
      } else {
        existing = existingByName.get(waNameLower);
        if (existing) {
          matchMethod = "BY_NAME";
        } else {
        }
      }

      if (existing) {
        
        if (existing.status !== waStatus) {
          
          try {
            await storage.updateTemplate(existing.id, {
              status: waStatus,
              whatsappTemplateId: waId 
            });

            detailedResults.push({
              id: existing.id,
              name: waName,
              whatsappId: waId,
              oldStatus: existing.status,
              newStatus: waStatus,
              action: "UPDATED"
            });
            updatedCount++;
          } catch (error) {
            console.error(`  ❌ Update failed:`, error);
            detailedResults.push({
              id: existing.id,
              name: waName,
              action: "UPDATE_FAILED",
              error: error instanceof Error ? error.message : String(error)
            });
          }
        } else {
          
          if (!existing.whatsappTemplateId || existing.whatsappTemplateId !== waId) {
            await storage.updateTemplate(existing.id, {
              whatsappTemplateId: waId
            });
          }
          
          detailedResults.push({
            id: existing.id,
            name: waName,
            whatsappId: waId,
            status: waStatus,
            action: "SKIPPED"
          });
          skippedCount++;
        }
      } else {
        
        
        try {
          
          const components = waTemplate.components || [];
          
          
          const bodyComponent = components.find((c: any) => c.type === "BODY");
          const bodyText = bodyComponent?.text || "";
          
          
          const bodyVariableMatches = bodyText.match(/\{\{(\d+)\}\}/g) || [];
          const bodyVariables = bodyVariableMatches.map((match: string) => 
            match.replace(/\{\{|\}\}/g, "")
          );
          
          
          const headerComponent = components.find((c: any) => c.type === "HEADER");
          let headerType = "NONE";
          
          if (headerComponent) {
            if (headerComponent.format === "TEXT") {
              headerType = "TEXT";
            } else if (headerComponent.format === "IMAGE") {
              headerType = "IMAGE";
            } else if (headerComponent.format === "VIDEO") {
              headerType = "VIDEO";
            } else if (headerComponent.format === "DOCUMENT") {
              headerType = "DOCUMENT";
            }
          }

          const created = await storage.createTemplate({
            name: waTemplate.name,
            language: waTemplate.language || "en_US",
            category: waTemplate.category || "MARKETING",
            status: (waTemplate.status || "PENDING").toUpperCase(),
            body: bodyText,
            headerType,
            bodyVariables,
            channelId,
            whatsappTemplateId: waId,
          });

          if (created) {
            detailedResults.push({
              id: created.id,
              name: waName,
              whatsappId: waId,
              status: waStatus,
              action: "CREATED"
            });
            createdCount++;
          } else {
            detailedResults.push({
              name: waName,
              whatsappId: waId,
              action: "CREATE_FAILED",
              error: "Create returned null"
            });
          }
        } catch (error) {
          console.error(`  ❌ Failed to create ${waName}:`, error);
          console.error(`  Error details:`, error instanceof Error ? error.message : String(error));
          detailedResults.push({
            name: waName,
            whatsappId: waId,
            action: "CREATE_FAILED",
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }

    res.json({
      success: true, 
      message: "Templates synced successfully",
      totalFromWhatsApp: whatsappTemplates.length,
      totalInDatabase: existingTemplates.length,
      updatedCount,
      createdCount,
      skippedCount,
      detailedResults,
      note: createdCount > 0 
        ? `${createdCount} new templates were automatically created from WhatsApp`
        : "All templates are in sync"
    });
  }
);

function getStarterTemplates() {
  return [
    {
      metaPayload: {
        name: "exclusive_coupon_offer",
        category: "MARKETING",
        language: "en_US",
        components: [
          {
            type: "HEADER",
            format: "TEXT",
            text: "Exclusive Offer for You!",
          },
          {
            type: "BODY",
            text: "Great news, {{1}}! Use this exclusive coupon code to get a special discount on your next purchase. Limited redemptions available.",
            example: { body_text: [["John"]] },
          },
          { type: "FOOTER", text: "Terms and conditions apply" },
          {
            type: "BUTTONS",
            buttons: [{ type: "COPY_CODE", example: "SAVE20" }],
          },
        ],
      },
      localData: {
        body: "Great news, {{1}}! Use this exclusive coupon code to get a special discount on your next purchase. Limited redemptions available.",
        footer: "Terms and conditions apply",
        mediaType: "text",
        header: "Exclusive Offer for You!",
        buttons: [{ type: "COPY_CODE", text: "Copy offer code" }],
      },
    },
    {
      metaPayload: {
        name: "account_status_update",
        category: "UTILITY",
        language: "en_US",
        components: [
          {
            type: "BODY",
            text: "Hi {{1}}, your account at {{2}} has been successfully updated. If you did not make this change, please contact our support team immediately.",
            example: { body_text: [["John", "Acme Corp"]] },
          },
          { type: "FOOTER", text: "This is an automated notification" },
          {
            type: "BUTTONS",
            buttons: [
              { type: "URL", text: "View Account", url: "https://example.com/account" },
            ],
          },
        ],
      },
      localData: {
        body: "Hi {{1}}, your account at {{2}} has been successfully updated. If you did not make this change, please contact our support team immediately.",
        footer: "This is an automated notification",
        mediaType: "text",
        header: "",
        buttons: [{ type: "URL", text: "View Account", url: "https://example.com/account" }],
      },
    },
    {
      metaPayload: {
        name: "limited_time_discount",
        category: "MARKETING",
        language: "en_US",
        components: [
          {
            type: "HEADER",
            format: "TEXT",
            text: "Limited Time Offer!",
          },
          {
            type: "BODY",
            text: "Dear customer, grab our exclusive package with a limited time discount using code {{1}}. Offer valid for 7 days.",
            example: { body_text: [["FLAT50"]] },
          },
          {
            type: "BUTTONS",
            buttons: [
              { type: "QUICK_REPLY", text: "Yes, interested" },
              { type: "QUICK_REPLY", text: "Not interested" },
            ],
          },
        ],
      },
      localData: {
        body: "Dear customer, grab our exclusive package with a limited time discount using code {{1}}. Offer valid for 7 days.",
        footer: "",
        mediaType: "text",
        header: "Limited Time Offer!",
        buttons: [
          { type: "QUICK_REPLY", text: "Yes, interested" },
          { type: "QUICK_REPLY", text: "Not interested" },
        ],
      },
    },
    {
      metaPayload: {
        name: "otp_verify_code",
        category: "AUTHENTICATION",
        language: "en_US",
        components: [
          {
            type: "BODY",
            add_security_recommendation: true,
          },
          {
            type: "FOOTER",
            code_expiration_minutes: 10,
          },
          {
            type: "BUTTONS",
            buttons: [{ type: "OTP", otp_type: "COPY_CODE", text: "Copy Code" }],
          },
        ],
      },
      localData: {
        body: "{{1}} is your verification code. For your security, do not share this code.",
        footer: "Expires in 10 minutes.",
        mediaType: "text",
        header: "",
        buttons: [{ type: "OTP", text: "Copy Code" }],
      },
    },
    {
      metaPayload: {
        name: "order_shipment_update",
        category: "UTILITY",
        language: "en_US",
        components: [
          {
            type: "HEADER",
            format: "TEXT",
            text: "Order #{{1}} Update",
            example: { header_text: ["12345"] },
          },
          {
            type: "BODY",
            text: "Hi {{1}}, your order has been shipped! Your tracking number is {{2}}. Estimated delivery: {{3}}. You can track your package using the button below.",
            example: { body_text: [["John", "TRK123456", "Feb 25, 2026"]] },
          },
          { type: "FOOTER", text: "Thank you for shopping with us" },
          {
            type: "BUTTONS",
            buttons: [
              { type: "URL", text: "Track Order", url: "https://example.com/track/{{1}}", example: ["TRK123456"] },
            ],
          },
        ],
      },
      localData: {
        body: "Hi {{1}}, your order has been shipped! Your tracking number is {{2}}. Estimated delivery: {{3}}. You can track your package using the button below.",
        footer: "Thank you for shopping with us",
        mediaType: "text",
        header: "Order #{{1}} Update",
        buttons: [{ type: "URL", text: "Track Order", url: "https://example.com/track/{{1}}" }],
      },
    },
    {
      metaPayload: {
        name: "call_permission_request",
        category: "MARKETING",
        language: "en_US",
        components: [
          {
            type: "BODY",
            text: "Hi {{1}}, this is {{2}} from {{3}}. We'd like to call you regarding your recent inquiry. Would it be a good time to connect?",
            example: { body_text: [["John", "Sarah", "Acme Corp"]] },
          },
          { type: "FOOTER", text: "You can always opt out" },
          {
            type: "BUTTONS",
            buttons: [
              { type: "QUICK_REPLY", text: "Yes, call me" },
              { type: "QUICK_REPLY", text: "Not now" },
            ],
          },
        ],
      },
      localData: {
        body: "Hi {{1}}, this is {{2}} from {{3}}. We'd like to call you regarding your recent inquiry. Would it be a good time to connect?",
        footer: "You can always opt out",
        mediaType: "text",
        header: "",
        buttons: [
          { type: "QUICK_REPLY", text: "Yes, call me" },
          { type: "QUICK_REPLY", text: "Not now" },
        ],
      },
    },
  ];
}

export const syncTemplates = asyncHandler(
  async (req: RequestWithChannel, res: Response) => {
    let channelId =
      (req.body.channelId as string) ||
      (req.query.channelId as string) ||
      req.channelId;

    if (!channelId) {
      const activeChannel = await storage.getActiveChannel();
      if (!activeChannel) {
        throw new AppError(400, "No active channel found");
      }
      channelId = activeChannel.id;
    }

    const channel = await storage.getChannel(channelId);
    if (!channel) throw new AppError(404, "Channel not found");

    const whatsappApi = new WhatsAppApiService(channel);
    const whatsappTemplates = await whatsappApi.getTemplates();

    console.log(`[Template Sync] Channel: ${channel.phoneNumber} (${channelId}), WABA: ${channel.whatsappBusinessAccountId}, Templates from Meta: ${whatsappTemplates.length}`);

    const { data: dbTemplates } = await storage.getTemplatesByChannel(channelId);
    const existingTemplates = Array.isArray(dbTemplates) ? dbTemplates : [];

    
    const normalizeWaStatus = (status: string): string => {
      switch (status.toUpperCase()) {
        case "APPROVED":
          return "APPROVED";
        case "REJECTED":
          return "REJECTED";
        case "PENDING":
          return "PENDING";
        default:
          return "DRAFT";
      }
    };

    
    const existingByWhatsappId = new Map<string, any>();
    const existingByName = new Map<string, any>();

    for (const t of existingTemplates) {
      if (t.whatsappTemplateId) {
        existingByWhatsappId.set(String(t.whatsappTemplateId).trim(), t);
      }
      if (t.name) {
        existingByName.set(t.name.trim(), t);
      }
    }

    let updatedCount = 0;
    let skippedCount = 0;
    let createdCount = 0;
    let deletedCount = 0;

    const user = (req.session as any)?.user;

    const syncedDbIds = new Set<string>();

    const extractTemplateFields = (waTemplate: any) => {
      const headerComp = waTemplate.components?.find((c: any) => c.type === "HEADER");
      const bodyComp = waTemplate.components?.find((c: any) => c.type === "BODY");
      const footerComp = waTemplate.components?.find((c: any) => c.type === "FOOTER");
      const buttonsComp = waTemplate.components?.find((c: any) => c.type === "BUTTONS");

      let mediaType = "text";
      let header = "";
      if (headerComp) {
        if (headerComp.format === "IMAGE") mediaType = "image";
        else if (headerComp.format === "VIDEO") mediaType = "video";
        else if (headerComp.format === "DOCUMENT") mediaType = "document";
        else if (headerComp.format === "TEXT") header = headerComp.text || "";
      }

      const buttons = buttonsComp?.buttons || [];

      return {
        category: (waTemplate.category || "MARKETING").toUpperCase(),
        language: waTemplate.language || "en_US",
        header,
        body: bodyComp?.text || "",
        footer: footerComp?.text || "",
        buttons,
        mediaType,
      };
    };

    for (const waTemplate of whatsappTemplates) {
      const waId = String(waTemplate.id).trim();
      const waName = waTemplate.name.trim();
      const waStatus = normalizeWaStatus(waTemplate.status);

      const existing =
        existingByWhatsappId.get(waId) ||
        existingByName.get(waName);

      if (existing) {
        syncedDbIds.add(existing.id);

        const fields = extractTemplateFields(waTemplate);
        await storage.updateTemplate(existing.id, {
          name: waName,
          status: waStatus,
          whatsappTemplateId: waId,
          category: fields.category,
          language: fields.language,
          header: fields.header,
          body: fields.body,
          footer: fields.footer,
          buttons: fields.buttons,
          mediaType: fields.mediaType,
          updatedAt: new Date(),
        });
        updatedCount++;
      } else {
        const fields = extractTemplateFields(waTemplate);

        try {
          await storage.createTemplate({
            name: waName,
            ...fields,
            variables: [],
            status: waStatus,
            whatsappTemplateId: waId,
            channelId: channelId,
            createdBy: channel.createdBy || user?.id || "",
          });
          createdCount++;
        } catch (err: any) {
          console.error(`Failed to import template "${waName}":`, err.message);
        }
      }
    }

    if (whatsappTemplates.length > 0) {
      for (const dbTemplate of existingTemplates) {
        if (!syncedDbIds.has(dbTemplate.id)) {
          try {
            await storage.deleteTemplate(dbTemplate.id);
            deletedCount++;
            console.log(`[Template Sync] Removed stale template "${dbTemplate.name}" (not found on Meta)`);
          } catch (err: any) {
            console.error(`[Template Sync] Failed to remove stale template "${dbTemplate.name}":`, err.message);
          }
        }
      }
    }

    if (whatsappTemplates.length === 0) {
      console.log(`[Template Sync] No templates found on WABA ${channel.whatsappBusinessAccountId}, auto-creating starter templates...`);
      
      const starterTemplates = getStarterTemplates();
      let autoCreatedCount = 0;
      const autoCreateResults: Array<{ name: string; status: string; error?: string }> = [];

      for (const starter of starterTemplates) {
        try {
          const result = await whatsappApi.createTemplate(starter.metaPayload);
          
          if (!result?.id) {
            throw new Error("WhatsApp API did not return a template ID");
          }

          await storage.createTemplate({
            name: starter.metaPayload.name,
            category: starter.metaPayload.category,
            language: starter.metaPayload.language,
            header: starter.localData.header || "",
            body: starter.localData.body,
            footer: starter.localData.footer || "",
            buttons: starter.localData.buttons || [],
            variables: [],
            status: (result.status || "PENDING").toUpperCase(),
            mediaType: starter.localData.mediaType || "text",
            whatsappTemplateId: result.id,
            channelId: channelId,
            createdBy: channel.createdBy || user?.id || "",
          });
          autoCreatedCount++;
          autoCreateResults.push({ name: starter.metaPayload.name, status: (result.status || "PENDING").toUpperCase() });
          console.log(`[Template Sync] Auto-created template "${starter.metaPayload.name}" → ${result.status || "PENDING"}`);
        } catch (err: any) {
          console.error(`[Template Sync] Failed to auto-create "${starter.metaPayload.name}":`, err.message);
          autoCreateResults.push({ name: starter.metaPayload.name, status: "FAILED", error: err.message });
        }
      }

      return res.json({
        success: true,
        message: "Starter templates submitted for approval",
        totalFromWhatsApp: 0,
        createdCount: autoCreatedCount,
        updatedCount: 0,
        skippedCount: 0,
        autoCreated: true,
        autoCreateResults,
      });
    }

    res.json({
      success: true,
      message: "Templates synced successfully",
      totalFromWhatsApp: whatsappTemplates.length,
      createdCount,
      updatedCount,
      deletedCount,
    });
  }
);

export const syncTemplatesAKKKK = asyncHandler(
  async (req: RequestWithChannel, res: Response) => {
    let channelId =
      (req.body.channelId as string) ||
      (req.query.channelId as string) ||
      req.channelId;

    if (!channelId) {
      const activeChannel = await storage.getActiveChannel();
      if (!activeChannel) {
        throw new AppError(400, "No active channel found");
      }
      channelId = activeChannel.id;
    }

    const channel = await storage.getChannel(channelId);
    if (!channel) throw new AppError(404, "Channel not found");

    const whatsappApi = new WhatsAppApiService(channel);
    const whatsappTemplates = await whatsappApi.getTemplates();

    const { data: dbTemplates } =
      await storage.getTemplatesByChannel(channelId);

    const existingTemplates = Array.isArray(dbTemplates) ? dbTemplates : [];

    
    const existingByWhatsappId = new Map<string, any>();

    for (const t of existingTemplates) {
      if (t.whatsappTemplateId) {
        existingByWhatsappId.set(String(t.whatsappTemplateId), t);
      }
    }

    let createdCount = 0;
    let updatedCount = 0;

    for (const waTemplate of whatsappTemplates) {
      const waId = String(waTemplate.id); 

      const existing = existingByWhatsappId.get(waId);

      const bodyComponent = Array.isArray(waTemplate.components)
        ? waTemplate.components.find((c: any) => c.type === "BODY")
        : null;

      const bodyText = bodyComponent?.text || "";

      
      const headerComponent = waTemplate.components?.find(
        (c: any) => c.type === "HEADER"
      );

      const headerType = headerComponent?.format || null;

      
      const bodyVariables =
        (bodyText.match(/\{\{\d+\}\}/g) || []).length;

      if (existing) {
        
        const needsUpdate =
          existing.status !== (waTemplate.status || "PENDING").toUpperCase() ||
          existing.body !== bodyText ||
          existing.headerType !== headerType ||
          existing.bodyVariables !== bodyVariables;

        if (needsUpdate) {
          await storage.updateTemplate(existing.id, {
            status: (waTemplate.status || "PENDING").toUpperCase(),
            body: bodyText,
            headerType,
            bodyVariables,
          });

          updatedCount++;
        }
      } else {
        
        await storage.createTemplate({
          name: waTemplate.name,
          language: waTemplate.language || "en_US",
          category: waTemplate.category || "MARKETING",
          status: (waTemplate.status || "PENDING").toUpperCase(),
          body: bodyText,
          headerType,        
          bodyVariables,     
          channelId,
          whatsappTemplateId: waId, 
        });

        createdCount++;
      }
    }

    res.json({
      success: true,
      message: "Templates synced successfully",
      totalFromWhatsApp: whatsappTemplates.length,
      createdCount,
      updatedCount,
    });
  }
);

export const seedTemplates = asyncHandler(async (req: RequestWithChannel, res: Response) => {
  const channelId = req.query.channelId as string | undefined;
  
  
  let finalChannelId = channelId;
  if (!finalChannelId) {
    const activeChannel = await storage.getActiveChannel();
    if (activeChannel) {
      finalChannelId = activeChannel.id;
    } else {
      throw new AppError(400, 'No active channel found. Please configure a channel first.');
    }
  }
  
  const templates = [
    {
      name: "hello_world",
      body: "Hello {{1}}! Welcome to our WhatsApp Business platform.",
      category: "utility" as const,
      language: "en",
      status: "pending",
      channelId: finalChannelId
    },
    {
      name: "order_confirmation",
      body: "Hi {{1}}, your order #{{2}} has been confirmed and will be delivered by {{3}}.",
      category: "utility" as const,
      language: "en",
      status: "pending",
      channelId: finalChannelId
    },
    {
      name: "appointment_reminder",
      body: "Hello {{1}}, this is a reminder about your appointment on {{2}} at {{3}}. Reply YES to confirm.",
      category: "utility" as const,
      language: "en",
      status: "pending",
      channelId: finalChannelId
    }
  ];

  const createdTemplates = await Promise.all(
    templates.map(template => storage.createTemplate(template))
  );

  res.json({ message: "Templates seeded successfully", templates: createdTemplates });
});
