import { describe, expect, it } from "vitest";
import {
  DISCOUNT_TYPES,
  applyCoupon,
  calculateDiscount,
  isCouponActive,
  meetsMinimum,
} from "../coupon";

describe("coupon.calculateDiscount", () => {
  it("computes percentage discounts", () => {
    expect(calculateDiscount(200, { type: DISCOUNT_TYPES.PERCENTAGE, value: 10 })).toBe(20);
  });

  it("computes fixed discounts", () => {
    expect(calculateDiscount(200, { type: DISCOUNT_TYPES.FIXED, value: 50 })).toBe(50);
  });

  it("caps at maxDiscount and subtotal", () => {
    expect(
      calculateDiscount(200, { type: DISCOUNT_TYPES.PERCENTAGE, value: 50, maxDiscount: 30 }),
    ).toBe(30);
    expect(calculateDiscount(40, { type: DISCOUNT_TYPES.FIXED, value: 100 })).toBe(40);
  });

  it("returns zero for non-positive inputs", () => {
    expect(calculateDiscount(0, { type: DISCOUNT_TYPES.FIXED, value: 10 })).toBe(0);
    expect(calculateDiscount(100, { type: DISCOUNT_TYPES.FIXED, value: 0 })).toBe(0);
  });

  it("defaults to percentage and empty options", () => {
    expect(calculateDiscount(100, { value: 25 })).toBe(25);
    expect(calculateDiscount(100)).toBe(0);
  });
});

describe("coupon.isCouponActive", () => {
  const now = new Date("2024-06-15T00:00:00Z");

  it("returns false for missing coupon", () => {
    expect(isCouponActive(null, now)).toBe(false);
  });

  it("respects start and end windows", () => {
    expect(isCouponActive({ startTime: "2024-06-01", endTime: "2024-06-30" }, now)).toBe(true);
    expect(isCouponActive({ startTime: "2024-07-01" }, now)).toBe(false);
    expect(isCouponActive({ endTime: "2024-06-01" }, now)).toBe(false);
  });

  it("treats missing windows as active and accepts string now", () => {
    expect(isCouponActive({})).toBe(true);
    expect(isCouponActive({ endTime: "2024-06-30" }, "2024-06-15T00:00:00Z")).toBe(true);
  });
});

describe("coupon.meetsMinimum", () => {
  it("checks the subtotal threshold", () => {
    expect(meetsMinimum(500, 500)).toBe(true);
    expect(meetsMinimum(499, 500)).toBe(false);
  });
});

describe("coupon.applyCoupon", () => {
  const now = new Date("2024-06-15T00:00:00Z");

  it("applies a valid percentage coupon", () => {
    const result = applyCoupon(
      1000,
      { discountPercentage: 20, minimumAmount: 500, endTime: "2024-06-30" },
      now,
    );
    expect(result).toEqual({ discount: 200, total: 800, applied: true });
  });

  it("skips inactive or below-minimum coupons", () => {
    expect(applyCoupon(1000, { discountPercentage: 20, endTime: "2024-01-01" }, now)).toEqual({
      discount: 0,
      total: 1000,
      applied: false,
    });
    expect(applyCoupon(100, { discountPercentage: 20, minimumAmount: 500 }, now)).toEqual({
      discount: 0,
      total: 100,
      applied: false,
    });
  });

  it("uses fixed discount type and discountValue field", () => {
    const result = applyCoupon(
      300,
      { discountType: DISCOUNT_TYPES.FIXED, discountValue: 45, minimumAmount: 100 },
      now,
    );
    expect(result).toEqual({ discount: 45, total: 255, applied: true });
  });

  it("defaults the reference time to now", () => {
    const result = applyCoupon(1000, { discountPercentage: 20, minimumAmount: 500 });
    expect(result).toEqual({ discount: 200, total: 800, applied: true });
  });
});
