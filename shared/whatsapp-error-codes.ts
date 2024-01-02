export interface WhatsAppErrorInfo {
  code: number;
  title: string;
  description: string;
  suggestion: string;
  category: string;
}

const ERROR_MAP: Record<number, WhatsAppErrorInfo> = {
  0: {
    code: 0,
    title: "Auth Exception",
    description: "Could not authenticate the app user.",
    suggestion: "Verify your access token is valid and has not expired. Regenerate the token if needed.",
    category: "authentication",
  },
  1: {
    code: 1,
    title: "API Unknown Error",
    description: "An unknown error occurred while processing the request.",
    suggestion: "Wait a moment and try again. If this persists during signup, the user should try in an incognito browser window or ensure they are logged into the correct Facebook account.",
    category: "general",
  },
  2: {
    code: 2,
    title: "API Service Unavailable",
    description: "The API service is temporarily unavailable.",
    suggestion: "Wait a few minutes and retry the request. This is usually a temporary Meta service issue.",
    category: "general",
  },
  3: {
    code: 3,
    title: "API Method Not Found",
    description: "The requested API method or endpoint does not exist.",
    suggestion: "Check that the API version and endpoint path are correct.",
    category: "general",
  },
  4: {
    code: 4,
    title: "API Too Many Calls",
    description: "The app has exceeded the API rate limit.",
    suggestion: "Reduce the frequency of API calls. Implement exponential backoff and retry after a delay.",
    category: "rate_limiting",
  },
  10: {
    code: 10,
    title: "Permission Denied",
    description: "The app does not have the required permissions for this action.",
    suggestion: "Ensure the app has all required permissions (whatsapp_business_management, whatsapp_business_messaging). The user may need to re-authorize the app.",
    category: "authentication",
  },
  100: {
    code: 100,
    title: "Invalid Parameter",
    description: "One or more parameters in the request are invalid.",
    suggestion: "Check the request parameters and ensure all required fields are provided with valid values.",
    category: "general",
  },
  190: {
    code: 190,
    title: "Access Token Invalid or Expired",
    description: "The access token has expired or is invalid.",
    suggestion: "Generate a new access token from the Meta Developer Dashboard and update it in Channel Settings.",
    category: "authentication",
  },
  200: {
    code: 200,
    title: "Permission Error",
    description: "The app lacks the necessary permissions.",
    suggestion: "The user needs to grant all required permissions during the signup flow. Ask them to try connecting their WhatsApp again.",
    category: "authentication",
  },
  368: {
    code: 368,
    title: "Temporarily Blocked for Policies",
    description: "The action is temporarily blocked due to policy violations.",
    suggestion: "Review Meta's commerce and messaging policies. Wait for the block to be lifted or appeal through Meta Business Support.",
    category: "general",
  },

  80007: {
    code: 80007,
    title: "Rate Limit Exceeded",
    description: "Too many messages sent. Rate limit reached.",
    suggestion: "Slow down message sending. Wait before sending more messages. Consider spreading campaigns over a longer period.",
    category: "rate_limiting",
  },

  130429: {
    code: 130429,
    title: "Rate Limit Hit",
    description: "Cloud API rate limit has been reached.",
    suggestion: "Reduce the number of API requests. Implement exponential backoff. Consider upgrading your throughput tier.",
    category: "rate_limiting",
  },
  130472: {
    code: 130472,
    title: "User In Experiment",
    description: "The recipient's phone number is part of a Meta experiment and cannot receive this message type.",
    suggestion: "This is a Meta-side restriction. The recipient may not be reachable with this message type at this time. Try a different message type or wait.",
    category: "messaging",
  },
  131000: {
    code: 131000,
    title: "Something Went Wrong",
    description: "An unknown error occurred on Meta's side.",
    suggestion: "Retry the message after a short delay. If the error persists, check the Meta Platform Status page for outages.",
    category: "messaging",
  },
  131005: {
    code: 131005,
    title: "Permission Denied",
    description: "Access denied to send messages from this phone number.",
    suggestion: "Ensure the phone number is properly registered and the access token has messaging permissions.",
    category: "messaging",
  },
  131008: {
    code: 131008,
    title: "Required Parameter Missing",
    description: "A required parameter is missing from the request.",
    suggestion: "Check that all required fields (to, type, template/text) are included in the message request.",
    category: "messaging",
  },
  131009: {
    code: 131009,
    title: "Invalid Parameter Value",
    description: "A parameter value in the request is not valid.",
    suggestion: "Verify the phone number format, template parameters, and media URLs are correct.",
    category: "messaging",
  },
  131016: {
    code: 131016,
    title: "Service Temporarily Unavailable",
    description: "WhatsApp service is temporarily unavailable.",
    suggestion: "Wait a few minutes and retry. This is usually a temporary issue on Meta's side.",
    category: "messaging",
  },
  131021: {
    code: 131021,
    title: "Recipient Not on WhatsApp",
    description: "The recipient's phone number is not registered on WhatsApp.",
    suggestion: "Verify the phone number is correct and that the recipient has an active WhatsApp account.",
    category: "messaging",
  },
  131026: {
    code: 131026,
    title: "Message Undeliverable",
    description: "The message could not be delivered to the recipient.",
    suggestion: "The recipient may have connectivity issues. Try sending again later.",
    category: "messaging",
  },
  131031: {
    code: 131031,
    title: "Account in Maintenance / Request Too Large",
    description: "The business account is in maintenance mode or the request payload is too large.",
    suggestion: "If maintenance, wait for it to complete. If payload issue, reduce the message size or media file size.",
    category: "messaging",
  },
  131042: {
    code: 131042,
    title: "Business Account Restricted",
    description: "The business account has been restricted due to policy violations or has reached its limits.",
    suggestion: "Check Meta Business Manager for restriction details. Review and fix any policy violations, then request a review.",
    category: "messaging",
  },
  131045: {
    code: 131045,
    title: "Business Not Authorized",
    description: "The business is not authorized to send messages.",
    suggestion: "Complete business verification in Meta Business Manager. Ensure the phone number is properly registered.",
    category: "messaging",
  },
  131047: {
    code: 131047,
    title: "Re-engagement Message Outside Window",
    description: "Cannot send this message because the 24-hour customer service window has closed.",
    suggestion: "Use an approved message template to re-initiate the conversation. Only free-form messages can be sent within 24 hours of the customer's last message.",
    category: "messaging",
  },
  131048: {
    code: 131048,
    title: "Spam Rate Limit Hit",
    description: "Too many messages sent from this phone number. Possible spam detection.",
    suggestion: "Reduce message volume. Ensure you are sending to opted-in contacts only. Improve message quality to reduce spam reports.",
    category: "rate_limiting",
  },
  131049: {
    code: 131049,
    title: "Message Type Not Supported",
    description: "This message type is not supported for the recipient.",
    suggestion: "Check if the message type (e.g., interactive, template) is supported in the recipient's region.",
    category: "messaging",
  },
  131051: {
    code: 131051,
    title: "Unsupported Message Type",
    description: "The message type is not supported.",
    suggestion: "Use a supported message type (text, image, video, document, template, interactive).",
    category: "messaging",
  },
  131052: {
    code: 131052,
    title: "Media Download Error",
    description: "The media file could not be downloaded from the provided URL.",
    suggestion: "Ensure the media URL is publicly accessible, returns the correct content type, and the file is not too large (max 16MB for most types).",
    category: "media",
  },
  131053: {
    code: 131053,
    title: "Media Upload Error",
    description: "The media file could not be uploaded to WhatsApp servers.",
    suggestion: "Check that the file format is supported and the file size is within limits. Try re-uploading.",
    category: "media",
  },
  131056: {
    code: 131056,
    title: "Pair Rate Limit Exceeded",
    description: "Too many messages sent to this specific recipient in a short time.",
    suggestion: "Wait before sending more messages to this contact. Space out messages to individual recipients.",
    category: "rate_limiting",
  },
  131057: {
    code: 131057,
    title: "Account in Maintenance Mode",
    description: "The business account is undergoing maintenance.",
    suggestion: "Wait for maintenance to complete, usually resolves within a few hours.",
    category: "messaging",
  },

  132000: {
    code: 132000,
    title: "Template Parameter Count Mismatch",
    description: "The number of template parameters provided does not match the template definition.",
    suggestion: "Check the template and ensure you are providing the exact number of variable parameters ({{1}}, {{2}}, etc.) that the template expects.",
    category: "template",
  },
  132001: {
    code: 132001,
    title: "Template Not Found",
    description: "The specified template does not exist or has not been approved.",
    suggestion: "Verify the template name and language code. Sync templates to get the latest status from Meta.",
    category: "template",
  },
  132005: {
    code: 132005,
    title: "Template Paused",
    description: "The template has been paused due to quality issues.",
    suggestion: "Review the template quality in Meta Business Manager. Edit and resubmit the template for approval, or use a different template.",
    category: "template",
  },
  132007: {
    code: 132007,
    title: "Template Disabled",
    description: "The template has been permanently disabled.",
    suggestion: "This template cannot be used. Create a new template with similar content and submit it for approval.",
    category: "template",
  },
  132012: {
    code: 132012,
    title: "Template Parameter Format Mismatch",
    description: "A template parameter does not match the expected format (e.g., wrong media type).",
    suggestion: "Ensure header media matches the template's expected format (IMAGE, VIDEO, DOCUMENT) and body parameters are text strings.",
    category: "template",
  },
  132015: {
    code: 132015,
    title: "Template Pending Approval",
    description: "The template is still pending review and cannot be used yet.",
    suggestion: "Wait for Meta to approve the template. Review usually takes a few minutes to 24 hours.",
    category: "template",
  },
  132016: {
    code: 132016,
    title: "Template Rejected",
    description: "The template was rejected during review.",
    suggestion: "Review Meta's template guidelines, fix any policy violations, and create a new template.",
    category: "template",
  },
  132068: {
    code: 132068,
    title: "Template Flow Blocked",
    description: "The flow referenced by the template is in a blocked state.",
    suggestion: "Check the flow associated with this template in Meta Business Manager and ensure it is published and active.",
    category: "template",
  },
  132069: {
    code: 132069,
    title: "Template Flow Throttled",
    description: "The flow associated with the template is being throttled.",
    suggestion: "Wait and retry. The flow may be receiving too many requests.",
    category: "template",
  },

  133000: {
    code: 133000,
    title: "Phone Number Not Registered",
    description: "The business phone number is not registered with the Cloud API.",
    suggestion: "Register the phone number in the Channel Settings or through the Embedded Signup flow.",
    category: "registration",
  },
  133004: {
    code: 133004,
    title: "Phone Number Not Verified",
    description: "The business phone number has not been verified.",
    suggestion: "Complete phone number verification through the Meta Business Manager.",
    category: "registration",
  },
  133005: {
    code: 133005,
    title: "Phone Number Country Not Supported",
    description: "The phone number's country is not supported for WhatsApp Business.",
    suggestion: "Use a phone number from a supported country. Check Meta's list of supported countries.",
    category: "registration",
  },
  133006: {
    code: 133006,
    title: "Credit Line Not Available",
    description: "No credit line is set up for the WhatsApp Business Account.",
    suggestion: "Set up a payment method in Meta Business Manager under Billing settings.",
    category: "billing",
  },
  133008: {
    code: 133008,
    title: "Phone Number Country Blocked",
    description: "Messages to this country are blocked.",
    suggestion: "Check if the destination country is supported and not restricted in your account settings.",
    category: "registration",
  },
  133009: {
    code: 133009,
    title: "Parameter Value Empty",
    description: "A required parameter was provided but is empty.",
    suggestion: "Ensure all required fields have non-empty values.",
    category: "general",
  },
  133010: {
    code: 133010,
    title: "Phone Number Blocked",
    description: "The business phone number has been blocked.",
    suggestion: "Contact Meta Support to resolve the block on this phone number.",
    category: "registration",
  },
  133015: {
    code: 133015,
    title: "Business Account Not Found",
    description: "The WhatsApp Business Account could not be found.",
    suggestion: "Verify the WABA ID is correct and the account has not been deleted.",
    category: "registration",
  },
  133016: {
    code: 133016,
    title: "Insufficient Account Balance",
    description: "The WhatsApp Business Account does not have sufficient balance to send messages.",
    suggestion: "Add funds to your WhatsApp Business Account in Meta Business Manager under Billing > Payment Methods.",
    category: "billing",
  },

  136025: {
    code: 136025,
    title: "Generic User Error",
    description: "A user-level error occurred.",
    suggestion: "Review the error details and try again. Ensure the request is well-formed.",
    category: "general",
  },
};

const OAUTH_TYPE_DESCRIPTIONS: Record<string, string> = {
  OAuthException: "Authentication or authorization failed during the OAuth flow.",
  GraphMethodException: "The API method or endpoint is not available.",
  IGApiException: "An Instagram/Meta Graph API exception occurred.",
};

export function getWhatsAppError(code: number | string | undefined | null): WhatsAppErrorInfo {
  const numCode = typeof code === "string" ? parseInt(code, 10) : code;
  if (numCode != null && !isNaN(numCode) && ERROR_MAP[numCode]) {
    return ERROR_MAP[numCode];
  }
  return {
    code: numCode || 0,
    title: "Unknown Error",
    description: "An unrecognized error occurred.",
    suggestion: "Check the error details and refer to Meta's WhatsApp Cloud API documentation for more information.",
    category: "unknown",
  };
}

export function getOAuthError(
  code: number | string | undefined | null,
  type?: string,
  message?: string
): WhatsAppErrorInfo {
  const base = getWhatsAppError(code);
  const typeDesc = type ? OAUTH_TYPE_DESCRIPTIONS[type] || "" : "";

  if (base.title === "Unknown Error" && type) {
    return {
      code: base.code,
      title: type,
      description: message || typeDesc || base.description,
      suggestion: getSuggestionForOAuth(base.code, type, message),
      category: "authentication",
    };
  }

  if (typeDesc && !base.description.includes(typeDesc)) {
    return {
      ...base,
      description: `${base.description} ${typeDesc}`.trim(),
      suggestion: getSuggestionForOAuth(base.code, type, message) || base.suggestion,
    };
  }

  return base;
}

function getSuggestionForOAuth(code: number, type?: string, message?: string): string {
  const msg = (message || "").toLowerCase();

  if (msg.includes("client secret") || msg.includes("validating client")) {
    return "The Meta App Secret may be incorrect or the user's Facebook session is invalid. Ask the user to: 1) Try in an incognito/private browser window, 2) Ensure they are logged into the correct Facebook account, 3) Grant all permissions during the signup popup. If the issue persists for all users, verify the App Secret in Settings > WA Onboarding.";
  }
  if (msg.includes("access token") || msg.includes("expired")) {
    return "The access token has expired or is invalid. Generate a new token from the Meta Developer Dashboard.";
  }
  if (msg.includes("code has been used") || msg.includes("code was already")) {
    return "The authorization code was already used. The user should try the signup flow again from the beginning.";
  }
  if (msg.includes("redirect_uri") || msg.includes("redirect uri")) {
    return "The redirect URI does not match the one configured in the Meta App settings. Verify the redirect URI in the Meta Developer Dashboard.";
  }
  if (type === "OAuthException" && code === 1) {
    return "This is usually a user-specific issue, not a platform configuration problem. Ask the user to: 1) Clear browser cookies and try in incognito mode, 2) Check they are using the correct Facebook account, 3) Ensure their Facebook Business account is in good standing.";
  }

  return "Verify your Meta App credentials (App ID and App Secret) are correct in Settings > WA Onboarding. If only specific users are affected, ask them to try in an incognito browser window.";
}

export function formatErrorForDisplay(errorDetails: any): {
  code: number | null;
  title: string;
  description: string;
  suggestion: string;
  rawMessage: string;
} {
  if (!errorDetails) {
    return {
      code: null,
      title: "Unknown Error",
      description: "Message delivery failed with no error details.",
      suggestion: "Try resending the message. If the issue persists, check your channel health in Settings.",
      rawMessage: "",
    };
  }

  let err = errorDetails;
  while (typeof err === "string") {
    try {
      err = JSON.parse(err);
    } catch {
      return {
        code: null,
        title: "Error",
        description: err,
        suggestion: "Check the error details and try again.",
        rawMessage: err,
      };
    }
  }

  const errCode = err.code;
  const lookup = getWhatsAppError(errCode);
  const rawTitle = err.title || err.error_user_title || "";
  const rawMessage = err.message || err.error_user_msg || err.errorData?.details || "";
  const serverDescription = err.description;
  const serverSuggestion = err.suggestion;

  if (serverDescription && serverSuggestion) {
    return {
      code: errCode || null,
      title: rawTitle || lookup.title,
      description: serverDescription,
      suggestion: serverSuggestion,
      rawMessage,
    };
  }

  if (lookup.title !== "Unknown Error") {
    return {
      code: lookup.code,
      title: lookup.title,
      description: rawMessage || lookup.description,
      suggestion: lookup.suggestion,
      rawMessage,
    };
  }

  return {
    code: errCode || null,
    title: rawTitle || "Error",
    description: rawMessage || "An error occurred.",
    suggestion: lookup.suggestion,
    rawMessage,
  };
}
