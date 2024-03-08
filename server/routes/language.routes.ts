import { Router, type Express } from "express";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";
import { db } from "../db";
import { platformLanguages } from "@shared/schema";
import { eq, asc } from "drizzle-orm";

const router = Router();

router.get("/", requireAuth, requireRole("superadmin"), async (req, res) => {
  try {
    const langs = await db
      .select()
      .from(platformLanguages)
      .orderBy(asc(platformLanguages.sortOrder));
    res.json(langs);
  } catch (error) {
    console.error("Error fetching languages:", error);
    res.status(500).json({ error: "Failed to fetch languages" });
  }
});

router.get("/enabled", async (req, res) => {
  try {
    const langs = await db
      .select({
        id: platformLanguages.id,
        code: platformLanguages.code,
        name: platformLanguages.name,
        nativeName: platformLanguages.nativeName,
        icon: platformLanguages.icon,
        direction: platformLanguages.direction,
        isDefault: platformLanguages.isDefault,
      })
      .from(platformLanguages)
      .where(eq(platformLanguages.isEnabled, true))
      .orderBy(asc(platformLanguages.sortOrder));
    res.json(langs);
  } catch (error) {
    console.error("Error fetching enabled languages:", error);
    res.status(500).json({ error: "Failed to fetch languages" });
  }
});

router.get("/translations/:code", async (req, res) => {
  try {
    const [lang] = await db
      .select({ translations: platformLanguages.translations })
      .from(platformLanguages)
      .where(eq(platformLanguages.code, req.params.code));

    if (!lang) return res.status(404).json({ error: "Language not found" });
    res.json(lang.translations || {});
  } catch (error) {
    console.error("Error fetching translations:", error);
    res.status(500).json({ error: "Failed to fetch translations" });
  }
});

router.get("/:id", requireAuth, requireRole("superadmin"), async (req, res) => {
  try {
    const [lang] = await db
      .select()
      .from(platformLanguages)
      .where(eq(platformLanguages.id, req.params.id));

    if (!lang) return res.status(404).json({ error: "Language not found" });
    res.json(lang);
  } catch (error) {
    console.error("Error fetching language:", error);
    res.status(500).json({ error: "Failed to fetch language" });
  }
});

router.post("/", requireAuth, requireRole("superadmin"), async (req, res) => {
  try {
    const { code, name, nativeName, icon, direction, isEnabled, translations, copyFromCode } = req.body;

    if (!code || !name || !nativeName) {
      return res.status(400).json({ error: "Code, name, and native name are required" });
    }

    const existing = await db
      .select()
      .from(platformLanguages)
      .where(eq(platformLanguages.code, code));

    if (existing.length > 0) {
      return res.status(409).json({ error: "Language with this code already exists" });
    }

    let initialTranslations = translations || {};

    if (copyFromCode) {
      const [source] = await db
        .select()
        .from(platformLanguages)
        .where(eq(platformLanguages.code, copyFromCode));

      if (source?.translations) {
        initialTranslations = source.translations;
      }
    }

    const allLangs = await db.select().from(platformLanguages);
    const sortOrder = allLangs.length;

    const [lang] = await db
      .insert(platformLanguages)
      .values({
        code,
        name,
        nativeName,
        icon: icon || "",
        direction: direction || "ltr",
        isEnabled: isEnabled !== false,
        translations: initialTranslations,
        sortOrder,
      })
      .returning();

    res.status(201).json(lang);
  } catch (error) {
    console.error("Error creating language:", error);
    res.status(500).json({ error: "Failed to create language" });
  }
});

router.put("/:id", requireAuth, requireRole("superadmin"), async (req, res) => {
  try {
    const { name, nativeName, icon, direction, isEnabled, isDefault, translations, sortOrder } = req.body;

    const updateData: any = { updatedAt: new Date() };
    if (name !== undefined) updateData.name = name;
    if (nativeName !== undefined) updateData.nativeName = nativeName;
    if (icon !== undefined) updateData.icon = icon;
    if (direction !== undefined) updateData.direction = direction;
    if (isEnabled !== undefined) updateData.isEnabled = isEnabled;
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;
    if (translations !== undefined) updateData.translations = translations;

    if (isDefault === true) {
      await db
        .update(platformLanguages)
        .set({ isDefault: false, updatedAt: new Date() });

      updateData.isDefault = true;
      updateData.isEnabled = true;
    }

    const [lang] = await db
      .update(platformLanguages)
      .set(updateData)
      .where(eq(platformLanguages.id, req.params.id))
      .returning();

    if (!lang) return res.status(404).json({ error: "Language not found" });
    res.json(lang);
  } catch (error) {
    console.error("Error updating language:", error);
    res.status(500).json({ error: "Failed to update language" });
  }
});

router.put("/:id/translations", requireAuth, requireRole("superadmin"), async (req, res) => {
  try {
    const { translations } = req.body;

    const [lang] = await db
      .update(platformLanguages)
      .set({ translations, updatedAt: new Date() })
      .where(eq(platformLanguages.id, req.params.id))
      .returning();

    if (!lang) return res.status(404).json({ error: "Language not found" });
    res.json(lang);
  } catch (error) {
    console.error("Error updating translations:", error);
    res.status(500).json({ error: "Failed to update translations" });
  }
});

router.delete("/:id", requireAuth, requireRole("superadmin"), async (req, res) => {
  try {
    const [lang] = await db
      .select()
      .from(platformLanguages)
      .where(eq(platformLanguages.id, req.params.id));

    if (!lang) return res.status(404).json({ error: "Language not found" });
    if (lang.isDefault) return res.status(400).json({ error: "Cannot delete the default language" });

    await db.delete(platformLanguages).where(eq(platformLanguages.id, req.params.id));
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting language:", error);
    res.status(500).json({ error: "Failed to delete language" });
  }
});

router.post("/:id/copy-keys", requireAuth, requireRole("superadmin"), async (req, res) => {
  try {
    const { sourceCode } = req.body;

    const [source] = await db
      .select()
      .from(platformLanguages)
      .where(eq(platformLanguages.code, sourceCode));

    if (!source) return res.status(404).json({ error: "Source language not found" });

    const [target] = await db
      .select()
      .from(platformLanguages)
      .where(eq(platformLanguages.id, req.params.id));

    if (!target) return res.status(404).json({ error: "Target language not found" });

    const existingTranslations = (target.translations || {}) as Record<string, any>;
    const sourceTranslations = (source.translations || {}) as Record<string, any>;

    function mergeDeep(existing: any, source: any): any {
      const result = { ...source };
      for (const key in existing) {
        if (existing[key] !== undefined && existing[key] !== null && existing[key] !== "") {
          if (typeof existing[key] === "object" && !Array.isArray(existing[key]) && typeof source[key] === "object" && !Array.isArray(source[key])) {
            result[key] = mergeDeep(existing[key], source[key]);
          } else {
            result[key] = existing[key];
          }
        }
      }
      return result;
    }

    const merged = mergeDeep(existingTranslations, sourceTranslations);

    const [updated] = await db
      .update(platformLanguages)
      .set({ translations: merged, updatedAt: new Date() })
      .where(eq(platformLanguages.id, req.params.id))
      .returning();

    res.json(updated);
  } catch (error) {
    console.error("Error copying keys:", error);
    res.status(500).json({ error: "Failed to copy keys" });
  }
});

export function registerLanguageRoutes(app: Express) {
  app.use("/api/languages", router);
}
