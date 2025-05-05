import { round, toNumber } from "./numbers";

export function groupThousands(value: string): string {
  const [intPart, decimalPart] = String(value).split(".");
  const sign = intPart.startsWith("-") ? "-" : "";
  const digits = sign ? intPart.slice(1) : intPart;
  const withSeparators = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decimalPart !== undefined
    ? `${sign}${withSeparators}.${decimalPart}`
    : `${sign}${withSeparators}`;
}

export function formatCurrency(
  amount: unknown,
  { symbol = "$", decimals = 2, position = "before" }: { symbol?: string; decimals?: number; position?: "before" | "after" } = {},
): string {
  const value = round(toNumber(amount), decimals).toFixed(decimals);
  const grouped = groupThousands(value);
  return position === "after" ? `${grouped}${symbol}` : `${symbol}${grouped}`;
}

export function convert(amount: unknown, rate: unknown): number {
  return round(toNumber(amount) * toNumber(rate, 1), 2);
}

export function parseAmount(input: unknown): number {
  if (typeof input !== "string") return round(toNumber(input), 2);
  const cleaned = input.replace(/[^0-9.-]/g, "");
  return round(toNumber(cleaned), 2);
}
