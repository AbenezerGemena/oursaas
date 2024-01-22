import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

function readVersionFile(): string {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      resolve(__dirname, "..", "..", "VERSION"),
      resolve(process.cwd(), "VERSION"),
    ];
    for (const p of candidates) {
      if (existsSync(p)) {
        return readFileSync(p, "utf-8").trim();
      }
    }
    return "3.0.0";
  } catch {
    return "3.0.0";
  }
}

export const OURSAAS_PRODUCT_NAME = "OurSaas";
export const OURSAAS_VERSION = readVersionFile();
export const OURSAAS_AUTHOR = "OurSaas Private Limited";
export const OURSAAS_WEBSITE = "https://oursaas.in";
export const OURSAAS_SUPPORT_EMAIL = "cs@oursaas.in";
export const OURSAAS_SUPPORT_URL = "https://oursaas.ticksy.com";
export const OURSAAS_LICENSE = "Marketplace / Marketplace License";

export const OURSAAS_POWERED_BY = `${OURSAAS_PRODUCT_NAME} v${OURSAAS_VERSION}`;
export const OURSAAS_HEADER_KEY = "X-Powered-By";
export const OURSAAS_HEADER_VALUE = OURSAAS_POWERED_BY;

export const OURSAAS_BRAND = {
  name: OURSAAS_PRODUCT_NAME,
  version: OURSAAS_VERSION,
  author: OURSAAS_AUTHOR,
  website: OURSAAS_WEBSITE,
  support: OURSAAS_SUPPORT_EMAIL,
  license: OURSAAS_LICENSE,
} as const;

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;
