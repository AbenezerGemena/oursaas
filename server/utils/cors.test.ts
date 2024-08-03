import { describe, expect, it, vi } from "vitest";
import { createCorsOriginChecker, parseAllowedOrigins } from "./cors";

describe("cors helpers", () => {
  it("parses comma separated origins and trims them", () => {
    const origins = parseAllowedOrigins("https://a.example.com, https://b.example.com", undefined, "https://c.example.com");

    expect(Array.from(origins)).toEqual([
      "https://a.example.com",
      "https://b.example.com",
      "https://c.example.com",
    ]);
  });

  it("allows requests without an origin", () => {
    const checker = createCorsOriginChecker(new Set(["https://app.example.com"]));
    const callback = vi.fn();

    checker(undefined, callback);

    expect(callback).toHaveBeenCalledWith(null, true);
  });

  it("rejects disallowed origins", () => {
    const checker = createCorsOriginChecker(new Set(["https://app.example.com"]));
    const callback = vi.fn();

    checker("https://evil.example.com", callback);

    expect(callback.mock.calls[0][0]).toBeInstanceOf(Error);
  });
});
