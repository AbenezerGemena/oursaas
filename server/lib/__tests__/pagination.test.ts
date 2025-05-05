import { describe, expect, it } from "vitest";
import { normalizePage, pageRange, paginate, totalPages } from "../pagination";

const items = Array.from({ length: 23 }, (_, i) => i + 1);

describe("pagination.totalPages", () => {
  it("computes the page count", () => {
    expect(totalPages(23, 10)).toBe(3);
    expect(totalPages(20, 10)).toBe(2);
    expect(totalPages(5, 0)).toBe(0);
  });
});

describe("pagination.normalizePage", () => {
  it("clamps to valid bounds", () => {
    expect(normalizePage(0, 23, 10)).toBe(1);
    expect(normalizePage(99, 23, 10)).toBe(3);
    expect(normalizePage(2, 23, 10)).toBe(2);
  });

  it("returns 1 when there are no pages", () => {
    expect(normalizePage(3, 0, 10)).toBe(1);
  });

  it("falls back to page 1 for invalid input", () => {
    expect(normalizePage("abc", 23, 10)).toBe(1);
  });
});

describe("pagination.paginate", () => {
  it("slices the current page and applies defaults", () => {
    expect(paginate(items, 1, 10)).toHaveLength(10);
    expect(paginate(items, 3, 10)).toEqual([21, 22, 23]);
    expect(paginate()).toEqual([]);
    expect(paginate(items)).toEqual(items.slice(0, 10));
  });

  it("returns empty for non-positive page size", () => {
    expect(paginate(items, 1, 0)).toEqual([]);
  });
});

describe("pagination.pageRange", () => {
  it("produces a sliding window of pages", () => {
    expect(pageRange(1, 100, 10)).toEqual([1, 2, 3, 4, 5]);
    expect(pageRange(8, 100, 10)).toEqual([6, 7, 8, 9, 10]);
    expect(pageRange(10, 100, 10)).toEqual([6, 7, 8, 9, 10]);
  });

  it("returns empty when there are no pages", () => {
    expect(pageRange(1, 0, 10)).toEqual([]);
  });
});
