import { describe, expect, it } from "vitest";
import { itemCount, lineTotal, orderTotal, subtotal, taxAmount } from "../pricing";

const items = [
  { price: 10, quantity: 2 },
  { price: 5.5, quantity: 3 },
];

describe("pricing.lineTotal", () => {
  it("multiplies price by quantity", () => {
    expect(lineTotal({ price: 10, quantity: 2 })).toBe(20);
    expect(lineTotal()).toBe(0);
  });
});

describe("pricing.subtotal", () => {
  it("sums line totals", () => {
    expect(subtotal(items)).toBe(36.5);
    expect(subtotal()).toBe(0);
  });
});

describe("pricing.itemCount", () => {
  it("counts quantities", () => {
    expect(itemCount(items)).toBe(5);
    expect(itemCount()).toBe(0);
  });
});

describe("pricing.taxAmount", () => {
  it("computes tax from a rate", () => {
    expect(taxAmount(100, 15)).toBe(15);
  });
});

describe("pricing.orderTotal", () => {
  it("computes a full order breakdown", () => {
    expect(orderTotal({ items, taxRate: 10, shipping: 5, discount: 6.5 })).toEqual({
      subtotal: 36.5,
      discount: 6.5,
      tax: 3,
      shipping: 5,
      total: 38,
    });
  });

  it("never lets discount push the total negative", () => {
    const result = orderTotal({ items: [{ price: 10, quantity: 1 }], discount: 50 });
    expect(result.subtotal).toBe(10);
    expect(result.total).toBe(0);
  });

  it("uses sensible defaults", () => {
    expect(orderTotal()).toEqual({
      subtotal: 0,
      discount: 0,
      tax: 0,
      shipping: 0,
      total: 0,
    });
  });
});
