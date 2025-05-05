import { describe, expect, it } from "vitest";
import {
  isBlank,
  isEmail,
  isPositiveNumber,
  isValidPhone,
  requiredFields,
  validatePassword,
} from "../validation";

describe("validation.isEmail", () => {
  it("validates email addresses", () => {
    expect(isEmail("owner@oursaas.example")).toBe(true);
    expect(isEmail(" user@test.com ")).toBe(true);
    expect(isEmail("bad-email")).toBe(false);
    expect(isEmail(123)).toBe(false);
  });
});

describe("validation.isBlank", () => {
  it("detects empty values", () => {
    expect(isBlank(null)).toBe(true);
    expect(isBlank(undefined)).toBe(true);
    expect(isBlank("   ")).toBe(true);
    expect(isBlank([])).toBe(true);
    expect(isBlank("ok")).toBe(false);
    expect(isBlank([1])).toBe(false);
    expect(isBlank(0)).toBe(false);
  });
});

describe("validation.requiredFields", () => {
  it("returns missing field names and applies defaults", () => {
    expect(requiredFields({ name: "Widget", price: "" }, ["name", "price", "sku"])).toEqual([
      "price",
      "sku",
    ]);
    expect(requiredFields({ name: "Widget" }, ["name"])).toEqual([]);
    expect(requiredFields()).toEqual([]);
  });
});

describe("validation.validatePassword", () => {
  it("enforces a minimum length", () => {
    expect(validatePassword("secret")).toBe(true);
    expect(validatePassword("123")).toBe(false);
    expect(validatePassword(null)).toBe(false);
    expect(validatePassword("longpass", 10)).toBe(false);
  });
});

describe("validation.isPositiveNumber", () => {
  it("accepts positive finite numbers only", () => {
    expect(isPositiveNumber(5)).toBe(true);
    expect(isPositiveNumber("3.5")).toBe(true);
    expect(isPositiveNumber(0)).toBe(false);
    expect(isPositiveNumber(-1)).toBe(false);
    expect(isPositiveNumber("abc")).toBe(false);
  });
});

describe("validation.isValidPhone", () => {
  it("validates phone digit counts", () => {
    expect(isValidPhone("+1 (555) 771-8879")).toBe(true);
    expect(isValidPhone("12345")).toBe(false);
    expect(isValidPhone(5551234)).toBe(false);
  });
});
