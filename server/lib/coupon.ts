import { round, toNumber } from "./numbers";

export const DISCOUNT_TYPES = Object.freeze({
  PERCENTAGE: "percentage",
  FIXED: "fixed",
});

export function calculateDiscount(
  subtotal: unknown,
  { type, value, maxDiscount }: { type?: string; value?: unknown; maxDiscount?: unknown } = {},
): number {
  const base = toNumber(subtotal);
  const amount = toNumber(value);
  if (base <= 0 || amount <= 0) return 0;

  let discount = type === DISCOUNT_TYPES.FIXED ? amount : (base * amount) / 100;
  if (maxDiscount !== undefined && maxDiscount !== null) {
    discount = Math.min(discount, toNumber(maxDiscount));
  }
  discount = Math.min(discount, base);
  return round(discount, 2);
}

export function isCouponActive(
  coupon: { startTime?: string | Date | null; endTime?: string | Date | null } | null | undefined,
  now: Date | string = new Date(),
): boolean {
  if (!coupon) return false;
  const start = coupon.startTime ? new Date(coupon.startTime) : null;
  const end = coupon.endTime ? new Date(coupon.endTime) : null;
  const reference = now instanceof Date ? now : new Date(now);
  if (start && reference < start) return false;
  if (end && reference > end) return false;
  return true;
}

export function meetsMinimum(subtotal: unknown, minimumAmount: unknown): boolean {
  return toNumber(subtotal) >= toNumber(minimumAmount);
}

export function applyCoupon(
  subtotal: unknown,
  coupon: {
    startTime?: string | Date | null;
    endTime?: string | Date | null;
    minimumAmount?: unknown;
    discountType?: string;
    discountPercentage?: unknown;
    discountValue?: unknown;
    maxDiscount?: unknown;
  } | null | undefined,
  now: Date | string = new Date(),
): { discount: number; total: number; applied: boolean } {
  const base = round(toNumber(subtotal), 2);
  if (!isCouponActive(coupon, now) || !meetsMinimum(base, coupon?.minimumAmount)) {
    return { discount: 0, total: base, applied: false };
  }
  const discount = calculateDiscount(base, {
    type: coupon?.discountType || DISCOUNT_TYPES.PERCENTAGE,
    value: coupon?.discountPercentage != null ? coupon.discountPercentage : coupon?.discountValue,
    maxDiscount: coupon?.maxDiscount,
  });
  return { discount, total: round(base - discount, 2), applied: discount > 0 };
}
