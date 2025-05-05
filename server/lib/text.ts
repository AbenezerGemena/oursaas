export function capitalize(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function truncate(value: unknown, length = 30, suffix = "..."): string {
  if (typeof value !== "string") return "";
  if (value.length <= length) return value;
  return value.slice(0, length).trimEnd() + suffix;
}

export function slugify(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s_-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function titleCase(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map(capitalize)
    .join(" ");
}

export function showingTranslateValue(
  dataObject: Record<string, string> | null | undefined,
  lang = "en",
): string {
  if (!dataObject) return "";
  return dataObject[lang] || dataObject.en || "";
}
