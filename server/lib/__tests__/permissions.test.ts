import { describe, expect, it } from "vitest";
import { ROLES, canAccess, isPrivileged, isValidRole, listPermissions } from "../permissions";

describe("permissions.isValidRole", () => {
  it("recognizes known roles", () => {
    Object.values(ROLES).forEach((role) => expect(isValidRole(role)).toBe(true));
    expect(isValidRole("guest")).toBe(false);
  });
});

describe("permissions.canAccess", () => {
  it("grants owner wildcard access", () => {
    expect(canAccess(ROLES.OWNER, "billing")).toBe(true);
    expect(canAccess(ROLES.OWNER, "anything")).toBe(true);
  });

  it("checks role-specific permissions", () => {
    expect(canAccess(ROLES.ADMIN, "team")).toBe(true);
    expect(canAccess(ROLES.AGENT, "billing")).toBe(false);
    expect(canAccess(ROLES.VIEWER, "reports")).toBe(true);
    expect(canAccess("guest", "reports")).toBe(false);
  });
});

describe("permissions.listPermissions", () => {
  it("lists grants for a role", () => {
    expect(listPermissions(ROLES.VIEWER)).toEqual(["reports"]);
    expect(listPermissions("guest")).toEqual([]);
  });
});

describe("permissions.isPrivileged", () => {
  it("detects elevated roles", () => {
    expect(isPrivileged(ROLES.OWNER)).toBe(true);
    expect(isPrivileged(ROLES.ADMIN)).toBe(true);
    expect(isPrivileged(ROLES.AGENT)).toBe(false);
  });
});
