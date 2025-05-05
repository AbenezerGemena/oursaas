const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(value: unknown): boolean {
  return typeof value === "string" && EMAIL_PATTERN.test(value.trim());
}

export function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export function requiredFields(payload: Record<string, unknown> = {}, fields: string[] = []): string[] {
  return fields.filter((field) => isBlank(payload[field]));
}

export function validatePassword(password: unknown, minLength = 6): boolean {
  const value = typeof password === "string" ? password : "";
  return value.length >= minLength;
}

export function isPositiveNumber(value: unknown): boolean {
  const num = Number(value);
  return Number.isFinite(num) && num > 0;
}

export function isValidPhone(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const digits = value.replace(/[^0-9]/g, "");
  return digits.length >= 7 && digits.length <= 15;
}
