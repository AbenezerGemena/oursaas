export const ROLES = Object.freeze({
  OWNER: "owner",
  ADMIN: "admin",
  AGENT: "agent",
  VIEWER: "viewer",
} as const);

export type Role = (typeof ROLES)[keyof typeof ROLES];

const PERMISSIONS: Record<Role, string[]> = {
  owner: ["*"],
  admin: ["campaigns", "templates", "contacts", "billing", "team", "reports"],
  agent: ["campaigns", "templates", "contacts", "reports"],
  viewer: ["reports"],
};

export function isValidRole(role: string): role is Role {
  return Object.values(ROLES).includes(role as Role);
}

export function canAccess(role: string, permission: string): boolean {
  if (!isValidRole(role)) return false;
  const grants = PERMISSIONS[role];
  return grants.includes("*") || grants.includes(permission);
}

export function listPermissions(role: string): string[] {
  return isValidRole(role) ? [...PERMISSIONS[role]] : [];
}

export function isPrivileged(role: string): boolean {
  return role === ROLES.OWNER || role === ROLES.ADMIN;
}
