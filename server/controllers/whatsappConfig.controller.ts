import { Request, Response } from "express";
import { OurSaasError, asyncHandler as _dHandler, oursaasLogger, HTTP_STATUS } from "@oursaas/core";
import { asyncHandler } from "../middlewares/error.middleware";
import { db } from "../db";
import {
  whatsappBusinessAccountsConfig,
} from "@shared/schema";
import { eq, ne } from "drizzle-orm";

export const saveWhatsappConfig =
  asyncHandler(async (req: Request, res: Response) => {
    const { appId, appSecret, configId } =
      req.body;

    if (!appId || !appSecret || !configId) {
      return res.status(400).json({
        message:
          "appId, appSecret, configId required",
      });
    }

    const userId =
      (req.session as any).user.id;

    let existing = await db.query
      .whatsappBusinessAccountsConfig
      .findFirst({
        where: ne(
          whatsappBusinessAccountsConfig.appId,
          ""
        ),
      });
    if (!existing) {
      existing = await db.query
        .whatsappBusinessAccountsConfig
        .findFirst();
    }

    
    if (existing) {
      const updated = await db
        .update(
          whatsappBusinessAccountsConfig
        )
        .set({
          appId,
          appSecret,
          configId,
          createdBy: userId,
          updatedAt: new Date(),
        })
        .where(
          eq(
            whatsappBusinessAccountsConfig.id,
            existing.id
          )
        )
        .returning();

      return res.json({
        message:
          "Config updated successfully",
        data: updated[0],
      });
    }

    
    const created = await db
      .insert(
        whatsappBusinessAccountsConfig
      )
      .values({
        appId,
        appSecret,
        configId,
        createdBy: userId,
      })
      .returning();

    res.json({
      message:
        "Config created successfully",
      data: created[0],
    });
  });

export const getMyWhatsappConfig =
  asyncHandler(async (req: Request, res: Response) => {
    let config;

    config = await db.query
      .whatsappBusinessAccountsConfig
      .findFirst({
        where: ne(
          whatsappBusinessAccountsConfig.appId,
          ""
        ),
      });
    if (!config) {
      config = await db.query
        .whatsappBusinessAccountsConfig
        .findFirst();
    }

    if (!config) {
      return res.status(404).json({
        message: "Config not found",
      });
    }

    res.json(config);
  });

export const updateWhatsappConfig =
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const existing = await db.query
      .whatsappBusinessAccountsConfig
      .findFirst({
        where: eq(
          whatsappBusinessAccountsConfig.id,
          id
        ),
      });

    if (!existing) {
      return res.status(404).json({
        message: "Config not found",
      });
    }

    const updated = await db
      .update(
        whatsappBusinessAccountsConfig
      )
      .set({
        ...req.body,
        updatedAt: new Date(),
      })
      .where(
        eq(
          whatsappBusinessAccountsConfig.id,
          id
        )
      )
      .returning();

    res.json({
      message: "Config updated",
      data: updated[0],
    });
  });

export const deleteWhatsappConfig =
  asyncHandler(async (req: Request, res: Response) => {
    let existing = await db.query
      .whatsappBusinessAccountsConfig
      .findFirst({
        where: ne(
          whatsappBusinessAccountsConfig.appId,
          ""
        ),
      });
    if (!existing) {
      existing = await db.query
        .whatsappBusinessAccountsConfig
        .findFirst();
    }

    if (!existing) {
      return res.status(404).json({
        message: "Config not found",
      });
    }

    await db
      .delete(
        whatsappBusinessAccountsConfig
      )
      .where(
        eq(
          whatsappBusinessAccountsConfig.id,
          existing.id
        )
      );

    res.json({
      success: true,
      message: "Config deleted",
    });
  });
