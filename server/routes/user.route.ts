import { requireAuth } from "server/middlewares/auth.middleware";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  updateUserStatus,
  bulkUpdateUserStatus,
  verifyEmailOTP,
  createUserSuperadmin,
  exportAllUsers
} from "../controllers/user.controller";
import type { Express } from "express";

export function userRoutes(app: Express) {
app.get("/api/admin/users/export", requireAuth, exportAllUsers);
app.get("/api/admin/users", requireAuth, getAllUsers);
app.get("/api/admin/users/:id", requireAuth, getUserById);
app.post("/api/users/create", createUser);
app.post("/api/admin/users/create", createUserSuperadmin);
app.post("/api/users/verifyEmail", verifyEmailOTP)
app.put("/api/admin/users/bulk-status", requireAuth, bulkUpdateUserStatus);
app.put("/api/users/:id", requireAuth, updateUser);
app.put("/api/user/status/:id", requireAuth, updateUserStatus);
app.delete("/api/admin/users/:id", requireAuth, deleteUser);
}
