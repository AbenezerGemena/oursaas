import { describe, expect, it } from "vitest";
import { convert, formatCurrency, groupThousands, parseAmount } from "../currency";

describe("currency.formatCurrency", () => {
  it("formats with default symbol before amount", () => {
    expect(formatCurrency(1234.5)).toBe("$1,234.50");
  });

  it("supports symbol after the amount", () => {
    expect(formatCurrency(1000, { symbol: " Br", position: "after" })).toBe("1,000.00 Br");
  });

  it("supports custom decimal precision", () => {
    expect(formatCurrency(9.999, { decimals: 0 })).toBe("$10");
  });
});

describe("currency.groupThousands", () => {
  it("adds separators for positive and negative values", () => {
    expect(groupThousands("1000000.25")).toBe("1,000,000.25");
    expect(groupThousands("-4500")).toBe("-4,500");
    expect(groupThousands("12")).toBe("12");
  });
});

describe("currency.convert", () => {
  it("applies exchange rates and defaults to 1", () => {
    expect(convert(100, 1.5)).toBe(150);
    expect(convert(100, undefined)).toBe(100);
  });
});

describe("currency.parseAmount", () => {
  it("parses formatted currency strings", () => {
    expect(parseAmount("$1,299.99")).toBe(1299.99);
    expect(parseAmount("-45.5 Br")).toBe(-45.5);
  });

  it("handles numeric input directly", () => {
    expect(parseAmount(42)).toBe(42);
  });
});
