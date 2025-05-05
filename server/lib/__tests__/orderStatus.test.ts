import { describe, expect, it } from "vitest";
import {
  ORDER_STATUSES,
  canTransition,
  isClosed,
  isValidStatus,
  nextStatuses,
  statusColor,
} from "../orderStatus";

describe("orderStatus.isValidStatus", () => {
  it("recognizes known statuses", () => {
    ORDER_STATUSES.forEach((status) => expect(isValidStatus(status)).toBe(true));
    expect(isValidStatus("Unknown")).toBe(false);
  });
});

describe("orderStatus.canTransition", () => {
  it("allows valid transitions", () => {
    expect(canTransition("Pending", "Processing")).toBe(true);
    expect(canTransition("Processing", "Delivered")).toBe(true);
  });

  it("blocks invalid transitions", () => {
    expect(canTransition("Delivered", "Pending")).toBe(false);
    expect(canTransition("Pending", "Delivered")).toBe(false);
    expect(canTransition("Bogus", "Pending")).toBe(false);
    expect(canTransition("Pending", "Bogus")).toBe(false);
  });
});

describe("orderStatus.nextStatuses", () => {
  it("lists reachable statuses", () => {
    expect(nextStatuses("Pending")).toEqual(["Processing", "Cancel"]);
    expect(nextStatuses("Delivered")).toEqual([]);
    expect(nextStatuses("Bogus")).toEqual([]);
  });
});

describe("orderStatus.statusColor", () => {
  it("maps statuses to colors", () => {
    expect(statusColor("Delivered")).toBe("green");
    expect(statusColor("Bogus")).toBe("gray");
  });
});

describe("orderStatus.isClosed", () => {
  it("detects terminal states", () => {
    expect(isClosed("Delivered")).toBe(true);
    expect(isClosed("Cancel")).toBe(true);
    expect(isClosed("Pending")).toBe(false);
  });
});
