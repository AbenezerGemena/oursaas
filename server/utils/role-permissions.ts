import { PERMISSIONS, PermissionMap } from "@shared/schema";

export function resolveUserPermissions(
  role: string,
  dbPermissions?: string[]
): PermissionMap {
  if (role === "admin") {
    
    const all: PermissionMap = {};
    Object.values(PERMISSIONS).forEach((perm) => {
      all[perm] = true;
    });
    return all;
  }

  
  if (!dbPermissions || dbPermissions.length === 0) {
    return {};
  }

  return dbPermissions.reduce((acc, perm) => {
    acc[perm] = true;
    return acc;
  }, {} as PermissionMap);
}
