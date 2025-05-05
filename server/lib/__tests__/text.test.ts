import { describe, expect, it } from "vitest";
import { capitalize, showingTranslateValue, slugify, titleCase, truncate } from "../text";

describe("text.capitalize", () => {
  it("uppercases the first character", () => {
    expect(capitalize("hello")).toBe("Hello");
    expect(capitalize("")).toBe("");
    expect(capitalize(42)).toBe("");
  });
});

describe("text.truncate", () => {
  it("shortens long strings with a suffix", () => {
    expect(truncate("hello world", 5)).toBe("hello...");
    expect(truncate("short", 10)).toBe("short");
    expect(truncate(null)).toBe("");
  });
});

describe("text.slugify", () => {
  it("creates URL-friendly slugs", () => {
    expect(slugify("  Fresh Campaign & Offers!  ")).toBe("fresh-campaign-offers");
    expect(slugify("Multi   Space_Name")).toBe("multi-space-name");
    expect(slugify(123)).toBe("");
  });
});

describe("text.titleCase", () => {
  it("capitalizes each word", () => {
    expect(titleCase("whatsapp marketing suite")).toBe("Whatsapp Marketing Suite");
    expect(titleCase("")).toBe("");
    expect(titleCase(null)).toBe("");
  });
});

describe("text.showingTranslateValue", () => {
  it("resolves localized values with fallback", () => {
    expect(showingTranslateValue({ en: "Hello", de: "Hallo" }, "de")).toBe("Hallo");
    expect(showingTranslateValue({ en: "Hello" }, "fr")).toBe("Hello");
    expect(showingTranslateValue(null)).toBe("");
    expect(showingTranslateValue({})).toBe("");
  });
});
