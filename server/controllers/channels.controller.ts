import type { Request, Response } from 'express';
import { OurSaasError, asyncHandler as _dHandler, oursaasLogger, HTTP_STATUS } from "@oursaas/core";
import { storage } from '../storage';
import { insertChannelSchema, Channel, whatsappBusinessAccountsConfig, channelSignupLogs, channels, users } from '@shared/schema';
import { AppError, asyncHandler } from '../middlewares/error.middleware';
import type { RequestWithChannel } from '../middlewares/channel.middleware';
import fetch from "node-fetch";
import { db } from '../db';
import { eq, ne, desc, like, or, and, sql, count } from 'drizzle-orm';
import { getOAuthError } from '@shared/whatsapp-error-codes';

export const getAllChannels = asyncHandler(async (req: Request, res: Response) => {
  const user = (req.session as any)?.user;
  if (!user || user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Access denied' });
  }
  const channels = await storage.getChannels();
  res.json(channels);
});

export const getChannels = asyncHandler(async (req: Request, res: Response) => {
  
  const user = (req.session as any).user;

  if (!user) {
    return res.status(401).json({ message: 'Not authenticated' });
  }

  let channels: Channel[] = [];

  if (user.role === 'superadmin') {
    
    channels = await storage.getChannels();
  } else {
    
    channels = await storage.getChannelsByUser(user.id);
  }

  
  res.json(channels);
});

export const getChannelsByUserId = asyncHandler(async (req: Request, res: Response) => {
  const { userId, page = 1, limit = 10 } = req.body;
  const user = (req.session as any)?.user;

  if (!userId) {
    return res.status(400).json({ message: "userId is required" });
  }

  
  if (user && user.role !== 'superadmin') {
    const ownerId = user.role === 'team' ? user.createdBy : user.id;
    if (userId !== ownerId && userId !== user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
  }

  try {
    const channels = await storage.getChannelsByUser(userId, Number(page), Number(limit));

    return res.json({
      status: "success",
      data: channels.data,
      pagination: channels.pagination,
    });
  } catch (error) {
    console.error("Error fetching channels:", error);
    return res.status(500).json({ message: "Server error while fetching channels" });
  }
});

  

export const getActiveChannel = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user;

  if (!user) {
    throw new AppError(401, 'User not found');
  }

  
  const userId = user.role === "team" ? user.createdBy : user.id;

  if (!userId) {
    throw new AppError(404, 'No active channel found');
  }

  const channel = await storage.getActiveChannelByUserId(userId);

  if (!channel) {
    throw new AppError(404, 'No active channel found');
  }

  res.json(channel);
});

export const createChannel = asyncHandler(async (req: Request, res: Response) => {
  const validatedChannel = insertChannelSchema.parse(req.body);
  
  const createdBy = (req.session as any).user.id || 'unknown';
  validatedChannel.createdBy = createdBy;
  validatedChannel.connectionMethod = 'manual';
  
  
  if (validatedChannel.isActive) {
    const channels = await storage.getChannelsByUserId(createdBy);
    for (const channel of channels) {
      if (channel.isActive) {
        await storage.updateChannel(channel.id, { isActive: false });
      }
    }
  }
  
  
  const channel = await storage.createChannel(validatedChannel);
  
  
  try {
    const apiVersion = process.env.WHATSAPP_API_VERSION || 'v24.0';
    
    const fields = 'id,account_mode,display_phone_number,is_official_business_account,is_pin_enabled,is_preverified_number,messaging_limit_tier,name_status,new_name_status,platform_type,quality_rating,quality_score,search_visibility,status,throughput,verified_name,code_verification_status,certificate';
    const url = `https://graph.facebook.com/${apiVersion}/${channel.phoneNumberId}?fields=${fields}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${channel.accessToken}`
      }
    });

    const data = await response.json();
    
    if (response.ok) {
      console.log('Channel health data:', JSON.stringify(data, null, 2));
      
      const healthDetails = {
        
        status: data.account_mode || 'UNKNOWN',
        name_status: data.name_status || 'UNKNOWN',
        phone_number: data.display_phone_number || channel.phoneNumber,
        quality_rating: data.quality_rating || 'UNKNOWN',
        throughput_level: data.throughput?.level || 'STANDARD',
        verification_status: data.code_verification_status || 'NOT_VERIFIED',
        messaging_limit: data.messaging_limit_tier || 'UNKNOWN',
        verified_name: typeof data.verified_name === 'string' ? data.verified_name : '',
        
        platform_type: data.platform_type,
        is_official_business_account: data.is_official_business_account,
        quality_score: data.quality_score,
        is_preverified_number: data.is_preverified_number,
        search_visibility: data.search_visibility,
        is_pin_enabled: data.is_pin_enabled,
        code_verification_status: data.code_verification_status,
        certificate: data.certificate
      };

      await storage.updateChannel(channel.id, {
        healthStatus: 'healthy',
        lastHealthCheck: new Date(),
        healthDetails
      });
    } else {
      await storage.updateChannel(channel.id, {
        healthStatus: 'error',
        lastHealthCheck: new Date(),
        healthDetails: { 
          error: data.error?.message || 'Unknown error',
          error_code: data.error?.code,
          error_type: data.error?.type
        }
      });
    }
  } catch (error) {
    console.error('Error checking channel health after creation:', error);
  }
  
  
  const updatedChannel = await storage.getChannel(channel.id);
  res.json(updatedChannel);
});

export const disconnectChannel = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const user = (req.session as any).user;

    if (!user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const channel = await storage.getChannel(id);
    if (!channel) {
      throw new AppError(404, "Channel not found");
    }

    if (user.role !== "superadmin" && channel.createdBy !== user.id) {
      return res.status(403).json({ error: "Access denied" });
    }

    try {
      const deregisterRes = await fetch(
        `https://graph.facebook.com/v24.0/${channel.phoneNumberId}/deregister`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${channel.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ messaging_product: "whatsapp" }),
        }
      );
      const deregisterData: any = await deregisterRes.json();
      console.log("[Disconnect] Deregister response:", JSON.stringify(deregisterData, null, 2));
    } catch (err) {
      console.error("[Disconnect] Deregister API call failed:", err);
    }

    await storage.updateChannel(id, { isActive: false });

    res.json({ success: true, message: "Channel disconnected successfully" });
  }
);

export const embeddedSignup = asyncHandler(
  async (req: Request, res: Response) => {
    const { code, coexistence } = req.body;
    const user = (req.session as any).user;

    if (!code) {
      return res.status(400).json({ message: "Code missing" });
    }

    if (!user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    let logId: string | undefined;
    try {
      const [signupLog] = await db.insert(channelSignupLogs).values({
        userId: user.id,
        status: "incomplete",
        step: "token_exchange",
      }).returning();
      logId = signupLog.id;
    } catch (logErr) {
      console.warn("[EmbeddedSignup] Failed to create signup log entry:", (logErr as Error).message);
    }

    const updateLog = async (data: Record<string, any>) => {
      if (!logId) return;
      try {
        await db.update(channelSignupLogs).set(data).where(eq(channelSignupLogs.id, logId));
      } catch (logErr) {
        console.warn("[EmbeddedSignup] Failed to update signup log:", (logErr as Error).message);
      }
    };

    let userConfig = await db.query.whatsappBusinessAccountsConfig.findFirst({
      where: ne(whatsappBusinessAccountsConfig.appId, ""),
    });
    if (!userConfig) {
      userConfig = await db.query.whatsappBusinessAccountsConfig.findFirst();
    }

    if (!userConfig || !userConfig.appId || !userConfig.appSecret) {
      await updateLog({
        status: "failed",
        step: "token_exchange",
        errorMessage: "Missing Embedded Signup config (App ID, App Secret, Config ID)",
      });
      return res.status(400).json({
        message: "Please save your Embedded Signup config first (App ID, App Secret, Config ID)",
      });
    }

    const { appId, appSecret } = userConfig;

    if (typeof code !== "string" || code.trim().length === 0) {
      await updateLog({
        status: "failed",
        step: "token_exchange",
        errorMessage: "Authorization code is empty or invalid",
        errorDetails: { description: "The authorization code received from Facebook was empty.", suggestion: "Please try the signup flow again. If the issue persists, clear your browser cache and try in an incognito window." },
      });
      return res.status(400).json({ message: "Authorization code is empty or invalid" });
    }

    console.log(`[EmbeddedSignup] Starting token exchange | App ID: ${appId} | Code length: ${code.length} chars | User: ${user.id}`);

    
    const t1Start = Date.now();
    const tokenRes = await fetch(
      `https://graph.facebook.com/v24.0/oauth/access_token?` +
        `client_id=${appId}` +
        `&client_secret=${appSecret}` +
        `&code=${code}`
    );

    const tokenData: any = await tokenRes.json();
    const t1Elapsed = Date.now() - t1Start;

    if (!tokenData.access_token) {
      const errMsg = tokenData.error?.message || "Token exchange failed";
      console.error(`[EmbeddedSignup] Token exchange FAILED (${t1Elapsed}ms) | Error: ${JSON.stringify(tokenData.error)}`);

      let userSuggestion: string;
      const metaMsg = (tokenData.error?.message || "").toLowerCase();
      if (metaMsg.includes("authorization code has been used")) {
        userSuggestion = "This authorization code was already used. Please close the popup and try the signup flow again.";
      } else if (metaMsg.includes("code has expired")) {
        userSuggestion = "The authorization code has expired. Please try the signup flow again — complete the Facebook popup promptly.";
      } else if (metaMsg.includes("validating client secret") || metaMsg.includes("invalid client_id")) {
        userSuggestion = "The Meta App credentials (App ID or App Secret) appear to be incorrect. Please verify them in Settings → Embedded Signup and update if needed.";
      } else {
        const oauthError = getOAuthError(tokenData.error?.code, tokenData.error?.type, tokenData.error?.message);
        userSuggestion = oauthError.suggestion;
      }

      const oauthError = getOAuthError(tokenData.error?.code, tokenData.error?.type, tokenData.error?.message);
      await updateLog({
        status: "failed",
        step: "token_exchange",
        errorMessage: `${errMsg} — Suggestion: ${userSuggestion}`,
        errorDetails: tokenData.error ? {
          code: tokenData.error.code,
          type: tokenData.error.type,
          fbtrace_id: tokenData.error.fbtrace_id,
          description: oauthError.description,
          suggestion: userSuggestion,
        } : null,
      });
      return res.status(400).json({ message: errMsg, suggestion: userSuggestion });
    }

    const accessToken = tokenData.access_token;
    console.log(`[EmbeddedSignup] Token exchange OK (${t1Elapsed}ms)`);

    
    const t2Start = Date.now();
    const longTokenRes = await fetch(
      `https://graph.facebook.com/v24.0/oauth/access_token?` +
        `grant_type=fb_exchange_token` +
        `&client_id=${appId}` +
        `&client_secret=${appSecret}` +
        `&fb_exchange_token=${accessToken}`
    );

    const longTokenData: any = await longTokenRes.json();
    const t2Elapsed = Date.now() - t2Start;

    if (longTokenData.access_token) {
      console.log(`[EmbeddedSignup] Long-lived token exchange OK (${t2Elapsed}ms)`);
    } else {
      console.warn(`[EmbeddedSignup] Long-lived token exchange failed (${t2Elapsed}ms), using short-lived token as fallback | Error code: ${longTokenData.error?.code || "unknown"}`);
    }

    const longLivedToken = longTokenData.access_token || accessToken;

    await updateLog({ step: "waba_discovery" });

    
    const t3Start = Date.now();
    const debugRes = await fetch(
      `https://graph.facebook.com/v24.0/debug_token?input_token=${longLivedToken}&access_token=${appId}|${appSecret}`
    );
    const debugData: any = await debugRes.json();
    const t3Elapsed = Date.now() - t3Start;
    console.log(`[EmbeddedSignup] debug_token response (${t3Elapsed}ms):`, JSON.stringify(debugData, null, 2));

    let wabaId: string | undefined;

    if (debugData?.data?.error) {
      console.error("[EmbeddedSignup] debug_token returned error:", debugData.data.error);
    }

    const granularScopes = debugData?.data?.granular_scopes || [];
    const wabaPermissions = [
      "whatsapp_business_management",
      "whatsapp_business_messaging",
      "business_management",
    ];
    for (const s of granularScopes) {
      const permName = s.scope || s.permission;
      if (
        wabaPermissions.includes(permName) &&
        Array.isArray(s.target_ids) &&
        s.target_ids.length > 0
      ) {
        wabaId = s.target_ids[0];
        console.log(`[EmbeddedSignup] Found WABA ${wabaId} from permission: ${permName}`);
        break;
      }
    }

    
    if (!wabaId) {
      console.log("[EmbeddedSignup] debug_token did not yield WABA, trying /me/businesses fallback");
      const businessRes = await fetch(
        `https://graph.facebook.com/v24.0/me?fields=businesses&access_token=${longLivedToken}`
      );
      const businessData: any = await businessRes.json();
      console.log("[EmbeddedSignup] /me/businesses response:", JSON.stringify(businessData, null, 2));
      const businessId = businessData.businesses?.data?.[0]?.id || businessData.id;

      if (businessId) {
        const wabaRes = await fetch(
          `https://graph.facebook.com/v24.0/${businessId}/owned_whatsapp_business_accounts?access_token=${longLivedToken}`
        );
        const wabaData: any = await wabaRes.json();
        console.log("[EmbeddedSignup] owned_whatsapp_business_accounts response:", JSON.stringify(wabaData, null, 2));
        wabaId = wabaData.data?.[0]?.id;
      }
    }

    if (!wabaId) {
      console.error("[EmbeddedSignup] Could not discover WABA. debug_token data:", JSON.stringify(debugData, null, 2));
      const wabaErrCode = debugData?.data?.error?.code;
      const wabaErrLookup = wabaErrCode ? getOAuthError(wabaErrCode, debugData?.data?.error?.type, debugData?.data?.error?.message) : null;
      await updateLog({
        status: "failed",
        step: "waba_discovery",
        errorMessage: "No WhatsApp Business Account found. Please ensure you completed all signup steps in the Facebook popup.",
        errorDetails: debugData?.data?.error ? {
          code: debugData.data.error.code,
          message: debugData.data.error.message,
          subcode: debugData.data.error.subcode,
          description: wabaErrLookup?.description || "The WhatsApp Business Account could not be discovered from the user's granted permissions.",
          suggestion: wabaErrLookup?.suggestion || "The user should try the signup flow again and ensure they complete all steps in the Facebook popup, including granting all requested permissions.",
        } : {
          description: "The WhatsApp Business Account could not be discovered from the user's granted permissions.",
          suggestion: "The user should try the signup flow again and ensure they complete all steps in the Facebook popup, including granting all requested permissions.",
        },
      });
      throw new Error("No WhatsApp Business Account found. Please ensure you completed all signup steps in the Facebook popup.");
    }

    console.log("[EmbeddedSignup] Discovered WABA ID:", wabaId);
    await updateLog({ step: "phone_fetch", wabaId });

    
    const phoneRes = await fetch(
      `https://graph.facebook.com/v24.0/${wabaId}/phone_numbers?access_token=${longLivedToken}`
    );
    const phoneData: any = await phoneRes.json();
    console.log("[EmbeddedSignup] phone_numbers response:", JSON.stringify(phoneData, null, 2));

    const phoneNumberId = phoneData.data?.[0]?.id;
    const displayPhoneNumber = phoneData.data?.[0]?.display_phone_number;

    if (!phoneNumberId) {
      const phoneErrCode = phoneData.error?.code;
      const phoneErrLookup = phoneErrCode ? getOAuthError(phoneErrCode, phoneData.error?.type, phoneData.error?.message) : null;
      await updateLog({
        status: "failed",
        step: "phone_fetch",
        errorMessage: "No phone number found in the connected WhatsApp Business Account",
        errorDetails: phoneData.error ? {
          code: phoneData.error.code,
          type: phoneData.error.type,
          message: phoneData.error.message,
          description: phoneErrLookup?.description || "No phone numbers were found associated with the WhatsApp Business Account.",
          suggestion: phoneErrLookup?.suggestion || "Ensure a phone number was added during the Embedded Signup flow. The user can try the signup process again.",
        } : {
          description: "No phone numbers were found associated with the WhatsApp Business Account.",
          suggestion: "Ensure a phone number was added during the Embedded Signup flow. The user can try the signup process again.",
        },
      });
      throw new Error("No phone number found in the connected WhatsApp Business Account");
    }

    await updateLog({ step: "channel_creation", phoneNumber: displayPhoneNumber || null });

    
    let existing = await storage.getChannelByPhoneNumberId(phoneNumberId);

    if (!existing && displayPhoneNumber) {
      const phoneMatches = await storage.getChannelsByPhoneNumber(displayPhoneNumber);
      const ownedMatch = phoneMatches.find(c => c.createdBy === user.id);
      if (ownedMatch) {
        existing = ownedMatch;
        console.log(`[EmbeddedSignup] Found existing channel by phone number ${displayPhoneNumber} (owned by ${user.id}), updating phoneNumberId from ${existing.phoneNumberId} to ${phoneNumberId}`);
      }
    }

    if (existing) {
      await storage.updateChannel(existing.id, {
        accessToken: longLivedToken,
        whatsappBusinessAccountId: wabaId,
        phoneNumberId,
        isActive: true,
        connectionMethod: "embedded",
      });
      console.log("[EmbeddedSignup] Reconnected existing channel:", existing.id, "- updated access token and phoneNumberId");

      if (displayPhoneNumber) {
        const allWithSamePhone = await storage.getChannelsByPhoneNumber(displayPhoneNumber);
        for (const dup of allWithSamePhone) {
          if (dup.id !== existing.id && dup.createdBy === user.id) {
            console.log(`[EmbeddedSignup] Deactivating stale duplicate channel: ${dup.id}`);
            await storage.updateChannel(dup.id, { isActive: false });
          }
        }
      }

      try {
        const subscribeRes = await fetch(
          `https://graph.facebook.com/v24.0/${wabaId}/subscribed_apps?access_token=${longLivedToken}`,
          { method: "POST" }
        );
        const subscribeData: any = await subscribeRes.json();
        console.log("[EmbeddedSignup] WABA subscription (reconnect):", JSON.stringify(subscribeData, null, 2));

        if (!subscribeRes.ok || !subscribeData.success) {
          console.warn("[EmbeddedSignup] WABA subscription may have failed:", JSON.stringify(subscribeData, null, 2));
        }
      } catch (err) {
        console.error("[EmbeddedSignup] WABA subscription failed on reconnect:", err);
      }

      try {
        const registerRes = await fetch(
          `https://graph.facebook.com/v24.0/${phoneNumberId}/register`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${longLivedToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              pin: "123456",
            }),
          }
        );
        const registerData: any = await registerRes.json();
        console.log("[EmbeddedSignup] Phone registration (reconnect):", JSON.stringify(registerData, null, 2));
      } catch (regErr) {
        console.error("[EmbeddedSignup] Phone registration failed on reconnect:", regErr);
      }

      await updateLog({
        status: "success",
        step: "completed",
        channelId: existing.id,
        phoneNumber: displayPhoneNumber || null,
        wabaId,
      });

      const updated = await storage.getChannel(existing.id);
      return res.json(updated || existing);
    }

    
    const channel = await storage.createChannel({
      name: displayPhoneNumber || "WhatsApp Channel",
      phoneNumberId,
      accessToken: longLivedToken,
      whatsappBusinessAccountId: wabaId,
      phoneNumber: displayPhoneNumber,
      appId,
      isActive: true,
      isCoexistence: coexistence === true,
      createdBy: user.id,
      connectionMethod: "embedded",
    });

    
    try {
      const subscribeRes = await fetch(
        `https://graph.facebook.com/v24.0/${wabaId}/subscribed_apps?access_token=${longLivedToken}`,
        {
          method: "POST",
        }
      );
      const subscribeData: any = await subscribeRes.json();
      console.log("[EmbeddedSignup] WABA subscription response:", JSON.stringify(subscribeData, null, 2));

      if (!subscribeRes.ok || !subscribeData.success) {
        console.warn("[EmbeddedSignup] WABA subscription may have failed:", JSON.stringify(subscribeData, null, 2));
      }
    } catch (webhookErr) {
      console.error("[EmbeddedSignup] WABA subscription failed (channel still created):", webhookErr);
    }

    
    try {
      const registerRes = await fetch(
        `https://graph.facebook.com/v24.0/${phoneNumberId}/register`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${longLivedToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            pin: "123456",
          }),
        }
      );
      const registerData: any = await registerRes.json();
      console.log("[EmbeddedSignup] Phone registration:", JSON.stringify(registerData, null, 2));
    } catch (regErr) {
      console.error("[EmbeddedSignup] Phone registration failed:", regErr);
    }

    await updateLog({
      status: "success",
      step: "completed",
      channelId: channel.id,
      phoneNumber: displayPhoneNumber || null,
      wabaId,
    });

    res.json(channel);
  }
);

export const updateChannel = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId =  req.user.id ; 

  if(!userId){
    throw new AppError(404, 'No active channel found');
  }
  
  
  if (req.body.isActive === true) {
    const channels = await storage.getChannelsByUserId(userId);
    for (const channel of channels) {
      if (channel.id !== id && channel.isActive) {
        await storage.updateChannel(channel.id, { isActive: false });
      }
    }
  }
  
  const channel = await storage.updateChannel(id, req.body);
  if (!channel) {
    throw new AppError(404, 'Channel not found');
  }
  res.json(channel);
});

export const deleteChannel = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const user = (req.session as any)?.user;
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const channel = await storage.getChannel(id);
  if (!channel) {
    throw new AppError(404, 'Channel not found');
  }

  if (user.role !== 'superadmin' && channel.createdBy !== user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const success = await storage.deleteChannel(id);
  if (!success) {
    throw new AppError(404, 'Channel not found');
  }
  res.status(204).send();
});

export const checkChannelHealth = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const channel = await storage.getChannel(id);
  if (!channel) {
    throw new AppError(404, 'Channel not found');
  }

  try {
    const apiVersion = process.env.WHATSAPP_API_VERSION || 'v24.0';
    
    const fields = 'id,account_mode,display_phone_number,is_official_business_account,is_pin_enabled,is_preverified_number,messaging_limit_tier,name_status,new_name_status,platform_type,quality_rating,quality_score,search_visibility,status,throughput,verified_name,code_verification_status,certificate';
    const url = `https://graph.facebook.com/${apiVersion}/${channel.phoneNumberId}?fields=${fields}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${channel.accessToken}`
      }
    });

    const data = await response.json();
    
    if (response.ok) {
      console.log('Channel health API response:', JSON.stringify(data, null, 2));
      
      const healthDetails = {
        status: data.account_mode || 'UNKNOWN',
        name_status: data.name_status || 'UNKNOWN',
        phone_number: data.display_phone_number || channel.phoneNumber,
        quality_rating: data.quality_rating || 'UNKNOWN',
        throughput_level: data.throughput?.level || 'STANDARD',
        verification_status: data.code_verification_status || 'NOT_VERIFIED',
        messaging_limit: data.messaging_limit_tier || 'UNKNOWN',
        verified_name: typeof data.verified_name === 'string' ? data.verified_name : '',
        
        platform_type: data.platform_type,
        is_official_business_account: data.is_official_business_account,
        quality_score: data.quality_score,
        is_preverified_number: data.is_preverified_number,
        search_visibility: data.search_visibility,
        is_pin_enabled: data.is_pin_enabled,
        code_verification_status: data.code_verification_status,
        certificate: data.certificate
      };

      await storage.updateChannel(id, {
        healthStatus: 'healthy',
        lastHealthCheck: new Date(),
        healthDetails
      });

      res.json({
        status: 'healthy',
        details: healthDetails,
        lastCheck: new Date()
      });
    } else {
      await storage.updateChannel(id, {
        healthStatus: 'error',
        lastHealthCheck: new Date(),
        healthDetails: { error: data.error?.message || 'Unknown error' }
      });

      res.json({
        status: 'error',
        error: data.error?.message || 'Failed to fetch channel health',
        lastCheck: new Date()
      });
    }
  } catch (error) {
    await storage.updateChannel(id, {
      healthStatus: 'error',
      lastHealthCheck: new Date(),
      healthDetails: { error: 'Network error' }
    });

    res.json({
      status: 'error',
      error: 'Failed to check channel health',
      lastCheck: new Date()
    });
  }
});

export const getDisplayName = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const channel = await storage.getChannel(id);
  if (!channel) {
    throw new AppError(404, 'Channel not found');
  }

  const user = (req.session as any)?.user;
  if (user?.role !== 'superadmin' && channel.createdBy !== user?.id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const apiVersion = process.env.WHATSAPP_API_VERSION || 'v24.0';
    const fields = 'verified_name,name_status,new_name_status,display_phone_number';
    const url = `https://graph.facebook.com/${apiVersion}/${channel.phoneNumberId}?fields=${fields}`;
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${channel.accessToken}` }
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(400).json({ error: data.error?.message || 'Failed to fetch display name info' });
    }

    const existingHealth = (channel.healthDetails as Record<string, any>) || {};
    const healthDetails = {
      ...existingHealth,
      verified_name: typeof data.verified_name === 'string' && data.verified_name ? data.verified_name : (existingHealth.verified_name || ''),
      name_status: data.name_status || 'UNKNOWN',
      new_name_status: data.new_name_status || undefined,
    };

    await storage.updateChannel(id, { healthDetails });

    res.json({
      verified_name: healthDetails.verified_name,
      name_status: healthDetails.name_status,
      new_name_status: data.new_name_status || null,
      display_phone_number: data.display_phone_number || channel.phoneNumber,
    });
  } catch (error: any) {
    console.error('Error fetching display name:', error);
    res.status(500).json({ error: 'Failed to fetch display name information' });
  }
});

export const updateDisplayName = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { display_name } = req.body;

  if (!display_name || typeof display_name !== 'string' || display_name.trim().length === 0) {
    return res.status(400).json({ error: 'Display name is required' });
  }

  const trimmedName = display_name.trim();
  if (trimmedName.length < 3 || trimmedName.length > 512) {
    return res.status(400).json({ error: 'Display name must be between 3 and 512 characters' });
  }

  const channel = await storage.getChannel(id);
  if (!channel) {
    throw new AppError(404, 'Channel not found');
  }

  const user = (req.session as any)?.user;
  if (user?.role !== 'superadmin' && channel.createdBy !== user?.id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const apiVersion = process.env.WHATSAPP_API_VERSION || 'v24.0';
    const url = `https://graph.facebook.com/${apiVersion}/${channel.phoneNumberId}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${channel.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ display_name: trimmedName }),
    });

    const data = await response.json();
    if (!response.ok) {
      const errorMsg = data.error?.message || 'Failed to update display name';
      return res.status(400).json({ error: errorMsg, details: data.error });
    }

    const healthDetails = {
      ...(channel.healthDetails as Record<string, any> || {}),
      new_name_status: 'PENDING_REVIEW',
    };
    await storage.updateChannel(id, { healthDetails });

    res.json({
      success: true,
      message: 'Display name change request submitted. Meta will review it (usually 24-48 hours).',
      new_name_status: 'PENDING_REVIEW',
    });
  } catch (error: any) {
    console.error('Error updating display name:', error);
    res.status(500).json({ error: 'Failed to submit display name change request' });
  }
});

export const checkAllChannelsHealth = asyncHandler(async (req: Request, res: Response) => {
  const { channelHealthMonitor } = await import('../cron/channel-health-monitor');
  await channelHealthMonitor.runManualCheck();
  res.json({
    message: 'Health check triggered for all channels',
    timestamp: new Date()
  });
});

export const getBusinessProfile = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const channel = await storage.getChannel(id);
  if (!channel) {
    return res.status(404).json({ error: 'Channel not found' });
  }

  const user = (req.session as any)?.user;
  if (user?.role !== 'superadmin' && channel.createdBy !== user?.id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const url = `https://graph.facebook.com/v24.0/${channel.phoneNumberId}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${channel.accessToken}` },
  });
  const data = await response.json() as any;

  if (data.error) {
    return res.status(400).json({ error: data.error.message });
  }

  const profile = data.data?.[0] || {};
  res.json(profile);
});

export const updateBusinessProfile = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const channel = await storage.getChannel(id);
  if (!channel) {
    return res.status(404).json({ error: 'Channel not found' });
  }

  const user = (req.session as any)?.user;
  if (user?.role !== 'superadmin' && channel.createdBy !== user?.id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const { about, address, description, email, websites, vertical } = req.body;

  if (about !== undefined && typeof about === 'string' && about.length > 139) {
    return res.status(400).json({ error: 'About must be 139 characters or less' });
  }
  if (description !== undefined && typeof description === 'string' && description.length > 512) {
    return res.status(400).json({ error: 'Description must be 512 characters or less' });
  }
  if (address !== undefined && typeof address === 'string' && address.length > 256) {
    return res.status(400).json({ error: 'Address must be 256 characters or less' });
  }
  if (email !== undefined && typeof email === 'string' && email.length > 128) {
    return res.status(400).json({ error: 'Email must be 128 characters or less' });
  }
  if (websites !== undefined && Array.isArray(websites) && websites.length > 2) {
    return res.status(400).json({ error: 'Maximum 2 websites allowed' });
  }

  const messaging_product = "whatsapp";
  const profileData: any = { messaging_product };

  if (typeof about === 'string' && about.trim()) profileData.about = about.trim();
  if (typeof address === 'string' && address.trim()) profileData.address = address.trim();
  if (typeof description === 'string' && description.trim()) profileData.description = description.trim();
  if (typeof email === 'string' && email.trim()) profileData.email = email.trim();
  if (Array.isArray(websites)) {
    const validWebsites = websites.filter((w: string) => typeof w === 'string' && w.trim());
    if (validWebsites.length > 0) profileData.websites = validWebsites;
  }
  if (typeof vertical === 'string' && vertical.trim()) profileData.vertical = vertical.trim();

  if (Object.keys(profileData).length <= 1) {
    return res.status(400).json({ error: 'No valid fields to update. Please fill in at least one field.' });
  }

  const url = `https://graph.facebook.com/v24.0/${channel.phoneNumberId}/whatsapp_business_profile`;
  console.log(`[ProfileUpdate] Sending to ${url}:`, JSON.stringify(profileData));
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${channel.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(profileData),
  });

  const data = await response.json() as any;
  console.log(`[ProfileUpdate] Response:`, JSON.stringify(data));

  if (data.error) {
    const code = data.error.code;
    if (code === 200 || code === 10 || code === 190) {
      return res.status(403).json({
        error: 'Permission denied. Your access token needs the "whatsapp_business_management" permission. Please go to Meta Business Manager → System Users → generate a new token with both whatsapp_business_messaging and whatsapp_business_management permissions, then update the channel access token.'
      });
    }
    const errorDetail = data.error.error_user_msg || data.error.message || 'Unknown error';
    return res.status(400).json({ error: errorDetail });
  }

  res.json({ success: true, ...data });
});

export const uploadProfilePhoto = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const channel = await storage.getChannel(id);
  if (!channel) {
    return res.status(404).json({ error: 'Channel not found' });
  }

  const user = (req.session as any)?.user;
  if (user?.role !== 'superadmin' && channel.createdBy !== user?.id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const file = (req as any).file;
  if (!file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const allowedTypes = ['image/jpeg', 'image/png'];
  if (!allowedTypes.includes(file.mimetype)) {
    return res.status(400).json({ error: 'Only JPEG and PNG images are allowed' });
  }
  if (file.size > 5 * 1024 * 1024) {
    return res.status(400).json({ error: 'Image must be smaller than 5MB' });
  }

  const fs = await import('fs');

  const cleanupFile = () => {
    try { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch {}
  };

  try {
    const fileBuffer = fs.readFileSync(file.path);
    const API_VERSION = 'v21.0';

    console.log(`[ProfilePhoto] Step 1: Creating upload session for appId=${channel.appId}, fileSize=${file.size}, mimeType=${file.mimetype}`);

    const uploadUrl = `https://graph.facebook.com/${API_VERSION}/${channel.appId}/uploads`;
    const sessionRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `OAuth ${channel.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        file_name: file.originalname || 'profile.jpg',
        file_length: file.size,
        file_type: file.mimetype,
      }),
    });
    const sessionData = await sessionRes.json() as any;
    console.log(`[ProfilePhoto] Step 1 response:`, JSON.stringify(sessionData));

    if (sessionData.error) {
      cleanupFile();
      const code = sessionData.error.code;
      if (code === 200 || code === 10 || code === 190) {
        return res.status(403).json({
          error: 'Permission denied. Your access token needs the "whatsapp_business_management" permission to upload profile photos.'
        });
      }
      return res.status(400).json({ error: sessionData.error.message || 'Failed to create upload session' });
    }

    const uploadSessionId = sessionData.id;
    if (!uploadSessionId) {
      cleanupFile();
      return res.status(400).json({ error: 'Failed to get upload session ID from Meta' });
    }

    console.log(`[ProfilePhoto] Step 2: Uploading file to session ${uploadSessionId}`);

    const uploadFileUrl = `https://graph.facebook.com/${API_VERSION}/${uploadSessionId}`;
    const uploadRes = await fetch(uploadFileUrl, {
      method: 'POST',
      headers: {
        Authorization: `OAuth ${channel.accessToken}`,
        file_offset: '0',
        'Content-Type': file.mimetype,
      },
      body: fileBuffer,
    });

    const uploadResult = await uploadRes.json() as any;
    console.log(`[ProfilePhoto] Step 2 response:`, JSON.stringify(uploadResult));

    if (uploadResult.error) {
      cleanupFile();
      const code = uploadResult.error.code;
      if (code === 200 || code === 10 || code === 190) {
        return res.status(403).json({
          error: 'Permission denied. Your access token needs the "whatsapp_business_management" permission to upload profile photos.'
        });
      }
      return res.status(400).json({ error: uploadResult.error.message || 'Failed to upload file' });
    }

    const handle = uploadResult.h;
    if (!handle) {
      cleanupFile();
      console.log(`[ProfilePhoto] ERROR: No handle returned. Full response:`, JSON.stringify(uploadResult));
      return res.status(400).json({ error: 'Upload succeeded but no file handle was returned' });
    }

    console.log(`[ProfilePhoto] Step 3: Setting profile picture with handle (length=${handle.length})`);

    const profileUrl = `https://graph.facebook.com/${API_VERSION}/${channel.phoneNumberId}/whatsapp_business_profile`;
    const profilePayload = {
      messaging_product: 'whatsapp',
      profile_picture_handle: handle,
    };
    console.log(`[ProfilePhoto] Step 3 request:`, JSON.stringify(profilePayload));

    const profileRes = await fetch(profileUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${channel.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(profilePayload),
    });

    const profileResult = await profileRes.json() as any;
    console.log(`[ProfilePhoto] Step 3 response:`, JSON.stringify(profileResult));

    if (profileResult.error) {
      cleanupFile();
      const code = profileResult.error.code;
      if (code === 200 || code === 10 || code === 190) {
        return res.status(403).json({
          error: 'Permission denied. Your access token needs the "whatsapp_business_management" permission to update the profile photo.'
        });
      }
      return res.status(400).json({ error: profileResult.error.message || 'Failed to set profile photo' });
    }

    cleanupFile();
    res.json({ success: true });
  } catch (err) {
    cleanupFile();
    throw err;
  }
});

export const getMessagingLimit = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const channel = await storage.getChannel(id);
  if (!channel) {
    return res.status(404).json({ error: "Channel not found" });
  }

  const tierMap: Record<string, number> = {
    TIER_250: 250,
    TIER_1K: 1000,
    TIER_10K: 10000,
    TIER_100K: 100000,
    UNLIMITED: Infinity,
  };

  const tier = (channel.healthDetails as any)?.messaging_limit || "UNKNOWN";
  const limit = tierMap[tier?.toUpperCase()] ?? 250;

  res.json({
    tier,
    limit: limit === Infinity ? "unlimited" : limit,
    qualityRating: (channel.healthDetails as any)?.quality_rating || "UNKNOWN",
  });
});

export const getAllChannelsAdmin = asyncHandler(async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const search = (req.query.search as string) || '';
  const statusFilter = (req.query.status as string) || '';
  const healthFilter = (req.query.health as string) || '';
  const offset = (page - 1) * limit;

  const conditions: any[] = [];

  if (search) {
    conditions.push(
      or(
        like(channels.name, `%${search}%`),
        like(channels.phoneNumber, `%${search}%`),
        like(users.username, `%${search}%`)
      )
    );
  }

  if (statusFilter === 'active') {
    conditions.push(eq(channels.isActive, true));
  } else if (statusFilter === 'inactive') {
    conditions.push(eq(channels.isActive, false));
  }

  if (healthFilter && ['healthy', 'warning', 'error', 'unknown'].includes(healthFilter)) {
    conditions.push(eq(channels.healthStatus, healthFilter));
  }

  const searchConditions = conditions.length > 0 ? and(...conditions) : undefined;

  const [channelsData, totalResult] = await Promise.all([
    db
      .select({
        id: channels.id,
        name: channels.name,
        phoneNumber: channels.phoneNumber,
        phoneNumberId: channels.phoneNumberId,
        whatsappBusinessAccountId: channels.whatsappBusinessAccountId,
        isActive: channels.isActive,
        isCoexistence: channels.isCoexistence,
        healthStatus: channels.healthStatus,
        lastHealthCheck: channels.lastHealthCheck,
        healthDetails: channels.healthDetails,
        connectionMethod: channels.connectionMethod,
        createdAt: channels.createdAt,
        updatedAt: channels.updatedAt,
        createdBy: channels.createdBy,
        ownerUsername: users.username,
        ownerEmail: users.email,
      })
      .from(channels)
      .leftJoin(users, eq(channels.createdBy, users.id))
      .where(searchConditions)
      .orderBy(desc(channels.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: count() })
      .from(channels)
      .leftJoin(users, eq(channels.createdBy, users.id))
      .where(searchConditions),
  ]);

  const total = totalResult[0]?.total || 0;

  res.json({
    success: true,
    data: channelsData,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

export const testCredentials = asyncHandler(async (req: Request, res: Response) => {
  const config = await db.query.whatsappBusinessAccountsConfig.findFirst({
    where: ne(whatsappBusinessAccountsConfig.appId, ""),
  });

  if (!config || !config.appId || !config.appSecret) {
    return res.json({
      success: false,
      message: "No Embedded Signup configuration found. Please save your Meta App credentials first.",
      appCredentials: { valid: false, error: "Not configured" },
      configId: { valid: false, error: "Not configured" },
    });
  }

  const results: {
    appCredentials: { valid: boolean; error?: string; appName?: string };
    configId: { valid: boolean; error?: string };
  } = {
    appCredentials: { valid: false },
    configId: { valid: false },
  };

  try {
    const tokenRes = await fetch(
      `https://graph.facebook.com/v24.0/oauth/access_token?client_id=${config.appId}&client_secret=${config.appSecret}&grant_type=client_credentials`
    );
    const tokenData: any = await tokenRes.json();

    if (tokenData.access_token) {
      results.appCredentials = { valid: true };

      try {
        const appRes = await fetch(
          `https://graph.facebook.com/v24.0/${config.appId}?fields=name&access_token=${tokenData.access_token}`
        );
        const appData: any = await appRes.json();
        if (appData.name) {
          results.appCredentials.appName = appData.name;
        }
      } catch {}

      if (config.configId) {
        try {
          const configRes = await fetch(
            `https://graph.facebook.com/v24.0/${config.configId}?access_token=${tokenData.access_token}`
          );
          const configData: any = await configRes.json();
          if (configData.error) {
            results.configId = { valid: false, error: configData.error.message || "Config ID not found or inaccessible" };
          } else {
            results.configId = { valid: true };
          }
        } catch (e: any) {
          results.configId = { valid: false, error: e.message || "Failed to verify Config ID" };
        }
      } else {
        results.configId = { valid: false, error: "Config ID is not set" };
      }
    } else {
      results.appCredentials = {
        valid: false,
        error: tokenData.error?.message || "Invalid App ID or App Secret",
      };
      results.configId = { valid: false, error: "Cannot verify — App credentials are invalid" };
    }
  } catch (e: any) {
    results.appCredentials = { valid: false, error: e.message || "Failed to connect to Meta API" };
    results.configId = { valid: false, error: "Cannot verify — App credentials test failed" };
  }

  res.json({ success: true, ...results });
});

export const getSignupLogs = asyncHandler(async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const status = req.query.status as string;
  const offset = (page - 1) * limit;

  const statusCondition = status && status !== 'all'
    ? eq(channelSignupLogs.status, status)
    : undefined;

  const [logsData, totalResult] = await Promise.all([
    db
      .select({
        id: channelSignupLogs.id,
        userId: channelSignupLogs.userId,
        status: channelSignupLogs.status,
        step: channelSignupLogs.step,
        errorMessage: channelSignupLogs.errorMessage,
        errorDetails: channelSignupLogs.errorDetails,
        phoneNumber: channelSignupLogs.phoneNumber,
        wabaId: channelSignupLogs.wabaId,
        channelId: channelSignupLogs.channelId,
        createdAt: channelSignupLogs.createdAt,
        username: users.username,
        email: users.email,
      })
      .from(channelSignupLogs)
      .leftJoin(users, eq(channelSignupLogs.userId, users.id))
      .where(statusCondition)
      .orderBy(desc(channelSignupLogs.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: count() })
      .from(channelSignupLogs)
      .where(statusCondition),
  ]);

  const total = totalResult[0]?.total || 0;

  res.json({
    success: true,
    data: logsData,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});
