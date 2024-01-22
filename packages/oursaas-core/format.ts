export function cleanPhoneNumber(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function formatPhoneNumber(phone: string): string {
  const cleaned = cleanPhoneNumber(phone);
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  return phone;
}

export function normalizePhoneNumber(phone: string): string {
  const cleaned = cleanPhoneNumber(phone);
  if (cleaned.startsWith("0")) {
    return cleaned.substring(1);
  }
  return cleaned;
}

export function truncateText(text: string, maxLength: number, suffix = "..."): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - suffix.length) + suffix;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + " " + sizes[i];
}

export function extractTemplateVariables(template: string): string[] {
  const matches = template.match(/\{\{(\d+)\}\}/g) || [];
  const variables: string[] = [];
  matches.forEach((match) => {
    const num = parseInt(match.replace("{{", "").replace("}}", ""), 10);
    variables[num - 1] = `Variable ${num}`;
  });
  return variables;
}
