import { describe, expect, it } from "vitest";
import { clamp, percentage, round, sum, toNumber } from "../numbers";

describe("numbers.toNumber", () => {
  it("parses numeric and string values", () => {
    expect(toNumber(12.5)).toBe(12.5);
    expect(toNumber(" 8 ")).toBe(8);
    expect(toNumber(0)).toBe(0);
  });

  it("returns fallback for empty or invalid values", () => {
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber("")).toBe(0);
    expect(toNumber("abc")).toBe(0);
    expect(toNumber("abc", 5)).toBe(5);
    expect(toNumber(Infinity)).toBe(0);
  });
});

describe("numbers.round", () => {
  it("rounds to precision and defaults to two decimals", () => {
    expect(round(1.005, 2)).toBe(1.01);
    expect(round(2.5, 0)).toBe(3);
    expect(round("3.14159", 3)).toBe(3.142);
    expect(round(1.005)).toBe(1.01);
  });
});

describe("numbers.clamp", () => {
  it("bounds values within range", () => {
    expect(clamp(5, 1, 10)).toBe(5);
    expect(clamp(-2, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});

describe("numbers.sum", () => {
  it("adds numeric collections", () => {
    expect(sum([1, 2, 3])).toBe(6);
    expect(sum(["2", 3, null])).toBe(5);
    expect(sum()).toBe(0);
  });
});

describe("numbers.percentage", () => {
  it("computes percentage of a whole", () => {
    expect(percentage(25, 200)).toBe(12.5);
    expect(percentage(1, 0)).toBe(0);
  });
});
