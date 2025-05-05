export function toNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = typeof value === "string" ? Number(value.trim()) : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function round(value: unknown, decimals = 2): number {
  const num = toNumber(value);
  const factor = 10 ** decimals;
  return Math.round((num + Number.EPSILON) * factor) / factor;
}

export function clamp(value: unknown, min: number, max: number): number {
  const num = toNumber(value);
  if (num < min) return min;
  if (num > max) return max;
  return num;
}

export function sum(values: unknown[] = []): number {
  return values.reduce<number>((total, item) => total + toNumber(item), 0);
}

export function percentage(part: unknown, whole: unknown): number {
  const wholeNum = toNumber(whole);
  if (wholeNum === 0) return 0;
  return round((toNumber(part) / wholeNum) * 100, 2);
}
