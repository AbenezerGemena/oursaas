import { round, toNumber } from "./numbers";

export function lineTotal(item: { price?: unknown; quantity?: unknown } = {}): number {
  return round(toNumber(item.price) * toNumber(item.quantity), 2);
}

export function subtotal(items: Array<{ price?: unknown; quantity?: unknown }> = []): number {
  return round(
    items.reduce((total, item) => total + lineTotal(item), 0),
    2,
  );
}

export function itemCount(items: Array<{ quantity?: unknown }> = []): number {
  return items.reduce((count, item) => count + toNumber(item.quantity), 0);
}

export function taxAmount(amount: unknown, taxRate: unknown): number {
  return round((toNumber(amount) * toNumber(taxRate)) / 100, 2);
}

export function orderTotal({
  items = [],
  taxRate = 0,
  shipping = 0,
  discount = 0,
}: {
  items?: Array<{ price?: unknown; quantity?: unknown }>;
  taxRate?: unknown;
  shipping?: unknown;
  discount?: unknown;
} = {}): {
  subtotal: number;
  discount: number;
  tax: number;
  shipping: number;
  total: number;
} {
  const sub = subtotal(items);
  const discounted = Math.max(sub - toNumber(discount), 0);
  const tax = taxAmount(discounted, taxRate);
  const ship = toNumber(shipping);
  return {
    subtotal: sub,
    discount: round(toNumber(discount), 2),
    tax,
    shipping: round(ship, 2),
    total: round(discounted + tax + ship, 2),
  };
}
