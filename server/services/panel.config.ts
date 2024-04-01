import { NewPanelConfig, panelConfig } from "@shared/schema";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import { db } from "../db";
import { eq, desc } from "drizzle-orm";
import { cacheGet, cacheInvalidate, CACHE_KEYS, CACHE_TTL } from './cache';

export const createPanelConfig = async (data: NewPanelConfig) => {
  const result = await db.insert(panelConfig).values({
    ...data,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).returning();
  await cacheInvalidate(CACHE_KEYS.panelConfig());
  return result[0];
};

export const getPanelConfigs = async () => {
  return cacheGet(CACHE_KEYS.panelConfig(), CACHE_TTL.panelConfig, async () => {
    return db.select().from(panelConfig).orderBy(desc(panelConfig.createdAt));
  });
};

export const getPanelConfigById = async (id: string) => {
  const result = await db.select().from(panelConfig).where(eq(panelConfig.id, id));
  return result[0] || null;
};

export const updatePanelConfig = async (id: string, data: Partial<NewPanelConfig>) => {
  const updateData = {
    ...data,
    updatedAt: new Date()
  };

  
  Object.keys(updateData).forEach(key => {
    if (updateData[key as keyof typeof updateData] === undefined) {
      delete updateData[key as keyof typeof updateData];
    }
  });

  const result = await db.update(panelConfig)
    .set(updateData)
    .where(eq(panelConfig.id, id))
    .returning();
  await cacheInvalidate(CACHE_KEYS.panelConfig());
  return result[0] || null;
};

export const deletePanelConfig = async (id: string) => {
  await db.delete(panelConfig).where(eq(panelConfig.id, id));
  await cacheInvalidate(CACHE_KEYS.panelConfig());
  return true;
};

export const getFirstPanelConfig = async () => {
  const result = await db.select().from(panelConfig).orderBy(desc(panelConfig.createdAt)).limit(1);
  return result[0] || null;
};

export const updateFirstPanelConfig = async (data: Partial<NewPanelConfig>) => {
  
  const existingConfig = await getFirstPanelConfig();
  
  if (existingConfig) {
    
    return updatePanelConfig(existingConfig.id, data);
  } else {
    
    const newConfigData: NewPanelConfig = {
      name: data.name || "Your App Name",
      tagline: data.tagline || "",
      description: data.description || "",
      companyName: data.companyName || "",
      companyWebsite: data.companyWebsite || "",
      supportEmail: data.supportEmail || "",
      defaultLanguage: data.defaultLanguage || "en",
      supportedLanguages: data.supportedLanguages || ["en"],
      logo: data.logo,
      favicon: data.favicon,
    };
    return createPanelConfig(newConfigData);
  }
};
