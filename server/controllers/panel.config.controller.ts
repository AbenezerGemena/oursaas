import { Request, Response } from "express";
import { OurSaasError, asyncHandler as _dHandler, oursaasLogger, HTTP_STATUS } from "@oursaas/core";
import {
  createPanelConfig,
  getPanelConfigs,
  getPanelConfigById,
  updatePanelConfig,
  deletePanelConfig,
  getFirstPanelConfig,
  updateFirstPanelConfig,
} from "../services/panel.config";
import { z } from "zod";
import path from "path";
import fs from "fs";

export const panelConfigSchema = z.object({
  name: z.string().min(1, "Name is required"),
  tagline: z.string().optional(),
  description: z.string().optional(),
  companyName: z.string().optional(),
  companyWebsite: z.string().url().optional().or(z.literal("")),
  supportEmail: z.string().email().optional().or(z.literal("")),
  defaultLanguage: z.string().length(2).default("en"),
  supportedLanguages: z.array(z.string()).default(["en"]),
  currency: z.string().min(1).default("INR"), 
  country: z.string().length(2).default("IN"), 

});

export const brandSettingsSchema = z.object({
  title: z.string().min(1, "Title is required"),
  tagline: z.string().optional(),
  logo: z.string().optional(),
  logo2: z.string().optional(),
  favicon: z.string().optional(),
  supportEmail: z.string().email().optional().or(z.literal("")),
  currency: z.string().min(1).default("INR"), 
  country: z.string().length(2).default("IN"), 
});

interface ParsedPanelConfig
  extends Partial<{
    name: string;
    description: string;
    tagline: string;
    defaultLanguage: string;
    supportedLanguages: string[];
    companyName: string;
    companyWebsite: string;
    supportEmail: string;
    logo: string;
    favicon: string;
    supportEmail: string;
    currency: string;
    country: string;
  }> {}

const processBase64Image = async (
  base64Data: string,
  type: "logo" | "favicon"
): Promise<string | null> => {
  if (!base64Data || !base64Data.includes("base64,")) {
    return base64Data; 
  }

  try {
    const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return null;
    }

    const mimeType = matches[1];
    const data = matches[2];

    
    let extension = "png";
    if (mimeType.includes("jpeg") || mimeType.includes("jpg")) {
      extension = "jpg";
    } else if (mimeType.includes("svg")) {
      extension = "svg";
    } else if (mimeType.includes("icon") || type === "favicon") {
      extension = "ico";
    }

    
    const filename = `${type}-${Date.now()}.${extension}`;
    const uploadPath = path.join(process.cwd(), "uploads", filename);

    
    const uploadsDir = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    
    fs.writeFileSync(uploadPath, data, "base64");

    return `/uploads/${filename}`;
  } catch (error) {
    console.error("Error processing base64 image:", error);
    return null;
  }
};

export const create = async (req: Request, res: Response) => {
  try {
    const parsed = panelConfigSchema.parse(req.body);

    const files = req.files as
      | Record<string, (Express.Multer.File & { cloudUrl?: string })[]>
      | undefined;

    
    const logoFile = files?.logo?.[0];
    const faviconFile = files?.favicon?.[0];

    const logoPath = logoFile
      ? logoFile.cloudUrl ||
        `/uploads/${path.basename(path.dirname(logoFile.path))}/${
          logoFile.filename
        }`
      : undefined;

    const faviconPath = faviconFile
      ? faviconFile.cloudUrl ||
        `/uploads/${path.basename(path.dirname(faviconFile.path))}/${
          faviconFile.filename
        }`
      : undefined;

    
    if (logoFile)
      console.log(
        `🖼️ Logo: ${logoFile.cloudUrl ? "Cloud" : "Local"} → ${logoPath}`
      );
    if (faviconFile)
      console.log(
        `🌐 Favicon: ${
          faviconFile.cloudUrl ? "Cloud" : "Local"
        } → ${faviconPath}`
      );

    const data = {
      ...parsed,
      logo: logoPath,
      favicon: faviconPath,
    };

    const config = await createPanelConfig(data);
    res.status(201).json(config);
  } catch (err: any) {
    console.error("❌ Create Panel Config Error:", err);
    res.status(400).json({ error: err.errors || err.message });
  }
};

export const getAll = async (_req: Request, res: Response) => {
  try {
    const configs = await getPanelConfigs();
    res.json(configs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const getOne = async (req: Request, res: Response) => {
  try {
    const config = await getPanelConfigById(req.params.id);
    if (!config) return res.status(404).json({ message: "Not found" });
    res.json(config);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const update = async (req: Request, res: Response) => {
  try {
    const parsed: ParsedPanelConfig = panelConfigSchema
      .partial()
      .parse(req.body);
    const files = req.files as
      | Record<string, (Express.Multer.File & { cloudUrl?: string })[]>
      | undefined;

    
    const logoFile = files?.logo?.[0];
    const faviconFile = files?.favicon?.[0];

    const logoPath = logoFile
      ? logoFile.cloudUrl ||
        `/uploads/${path.basename(path.dirname(logoFile.path))}/${
          logoFile.filename
        }`
      : parsed.logo;

    const faviconPath = faviconFile
      ? faviconFile.cloudUrl ||
        `/uploads/${path.basename(path.dirname(faviconFile.path))}/${
          faviconFile.filename
        }`
      : parsed.favicon;

    if (logoFile)
      console.log(
        `🖼️ Updating logo: ${
          logoFile.cloudUrl ? "Cloud" : "Local"
        } → ${logoPath}`
      );
    if (faviconFile)
      console.log(
        `🌐 Updating favicon: ${
          faviconFile.cloudUrl ? "Cloud" : "Local"
        } → ${faviconPath}`
      );

    const data: ParsedPanelConfig = {
      ...parsed,
      logo: logoPath,
      favicon: faviconPath,
    };

    const config = await updatePanelConfig(req.params.id, data);
    if (!config) return res.status(404).json({ message: "Not found" });

    res.json(config);
  } catch (err: any) {
    console.error("❌ Update Panel Config Error:", err);
    res.status(400).json({ error: err.errors || err.message });
  }
};

export const remove = async (req: Request, res: Response) => {
  try {
    await deletePanelConfig(req.params.id);
    res.json({ message: "Deleted successfully" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const getBrandSettings = async (_req: Request, res: Response) => {
  try {
    const config = await getFirstPanelConfig();

    if (!config) {
      
      return res.json({
        title: "Your App Name",
        tagline: "Building amazing experiences",
        logo: "",
        logo2:"",
        favicon: "",
        supportEmail: "",
        updatedAt: new Date().toISOString(),
      });
    }

    
    const brandSettings = {
      title: config.name || "Your App Name",
      tagline: config.tagline || "",
      currency: config.currency || "",
      country: config.country || "",
      supportEmail: config.supportEmail || "",
      logo: config.logo?.startsWith("https")
        ? config.logo
        : `/uploads/${config.logo}`,
      logo2: config.logo2?.startsWith("https")
        ? config.logo2
        : `/uploads/${config.logo2}`,  
      favicon: config.favicon?.startsWith("https")
        ? config.favicon
        : `/uploads/${config.favicon}`,
      updatedAt: config.updatedAt?.toISOString() || new Date().toISOString(),
    };

    res.json(brandSettings);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const createBrandSettings = async (req: Request, res: Response) => {
  try {
    
    const parsed = brandSettingsSchema.parse(req.body);

    const files = req.files as
      | Record<string, (Express.Multer.File & { cloudUrl?: string })[]>
      | undefined;

    let logoPath: string | undefined;
    let logo2Path: string | undefined;
    let faviconPath: string | undefined;

    
    if (files?.logo?.[0]) {
      const logoFile = files.logo[0];
      const isCloudFile = !!logoFile.cloudUrl;
      logoPath =
        logoFile.cloudUrl ||
        `/uploads/${path.basename(path.dirname(logoFile.path))}/${
          logoFile.filename
        }`;
      console.log(`🖼️ Logo (${isCloudFile ? "Cloud" : "Local"}): ${logoPath}`);
    } else if (parsed.logo && parsed.logo.includes("base64,")) {
      
      logoPath = (await processBase64Image(parsed.logo, "logo")) ?? undefined;
      console.log(`🖼️ Logo (Base64 processed): ${logoPath}`);
    }

    
    if (files?.logo2?.[0]) {
      const file = files.logo2[0];
      logo2Path =
        file.cloudUrl ||
        `/uploads/${path.basename(path.dirname(file.path))}/${file.filename}`;
    } else if (parsed.logo2?.includes("base64,")) {
      logo2Path = await processBase64Image(parsed.logo2, "logo2");
    }

    
    if (files?.favicon?.[0]) {
      const faviconFile = files.favicon[0];
      const isCloudFile = !!faviconFile.cloudUrl;
      faviconPath =
        faviconFile.cloudUrl ||
        `/uploads/${path.basename(path.dirname(faviconFile.path))}/${
          faviconFile.filename
        }`;
      console.log(
        `🌐 Favicon (${isCloudFile ? "Cloud" : "Local"}): ${faviconPath}`
      );
    } else if (parsed.favicon && parsed.favicon.includes("base64,")) {
      faviconPath =
        (await processBase64Image(parsed.favicon, "favicon")) ?? undefined;
      console.log(`🌐 Favicon (Base64 processed): ${faviconPath}`);
    }

    
    const panelData = {
      name: parsed.title,
      tagline: parsed.tagline || "",
      description: "",
      companyName: "",
      companyWebsite: "",
      supportEmail: "",
      defaultLanguage: "en",
      supportedLanguages: ["en"],
      logo: logoPath,
      logo2: logo2Path,
      favicon: faviconPath,
      country: "IN",
      currency: "INR",
    };

    const config = await createPanelConfig(panelData);

    
    const brandSettings = {
      title: config.name || parsed.title,
      tagline: config.tagline || "",
      logo: config.logo || "",
      logo2: config.logo2,
      favicon: config.favicon || "",
      country: config.country || "",
      currency: config.currency || "",
      supportEmail: config.supportEmail || "",
      updatedAt: config.updatedAt?.toISOString() || new Date().toISOString(),
    };

    res.status(201).json(brandSettings);
  } catch (err: any) {
    console.error("❌ Create Brand Settings Error:", err);
    res.status(400).json({ error: err.errors || err.message });
  }
};

export const updateBrandSettingsOld = async (req: Request, res: Response) => {
  try {
    
    

    const parsed = brandSettingsSchema.parse(req.body);
    const files = req.files as
      | Record<string, (Express.Multer.File & { cloudUrl?: string })[]>
      | undefined;

    let logoPath: string | undefined;
    let faviconPath: string | undefined;

    
    if (files?.logo?.[0]) {
      const logoFile = files.logo[0];
      logoPath = logoFile.cloudUrl || `/uploads/${logoFile.filename}`;
      console.log(`🖼️ Updated Logo: ${logoPath}`);
    } else if (parsed.logo && parsed.logo.includes("base64,")) {
      logoPath = await processBase64Image(parsed.logo, "logo");
    }

    
    if (files?.favicon?.[0]) {
      const faviconFile = files.favicon[0];
      faviconPath = faviconFile.cloudUrl || `/uploads/${faviconFile.filename}`;
      console.log(`🌐 Updated Favicon: ${faviconPath}`);
    } else if (parsed.favicon && parsed.favicon.includes("base64,")) {
      faviconPath = await processBase64Image(parsed.favicon, "favicon");
    }

    
    const panelData = {
      name: parsed.title,
      tagline: parsed.tagline || "",
      logo: logoPath,
      favicon: faviconPath,
      country: parsed.country || "",
      supportEmail: parsed.supportEmail || "",
      currency: parsed.currency || "",
    };

    const config = await updateFirstPanelConfig(panelData);

    
    const brandSettings = {
      title: config.name || parsed.title,
      tagline: config.tagline || "",
      country: config.country || "",
      currency: config.currency || "",
      supportEmail: config.supportEmail || "",
      logo: config.logo?.startsWith("https")
        ? config.logo
        : `/uploads/${config.logo}`,
      favicon: config.favicon?.startsWith("https")
        ? config.favicon
        : `/uploads/${config.favicon}`,
      updatedAt: config.updatedAt?.toISOString() || new Date().toISOString(),
    };

    res.json(brandSettings);
  } catch (err: any) {
    console.error("❌ Update Brand Settings Error:", err);
    res.status(400).json({ error: err.errors || err.message });
  }
};

export const updateBrandSettings = async (req: Request, res: Response) => {
  try {
    const parsed = brandSettingsSchema.parse(req.body);

    const files = req.files as
      | Record<string, (Express.Multer.File & { cloudUrl?: string })[]>
      | undefined;

    let logoPath: string | undefined;
    let logo2Path: string | undefined; 
    let faviconPath: string | undefined;

    
    
    
    if (files?.logo?.[0]) {
      const logoFile = files.logo[0];
      logoPath = logoFile.cloudUrl || `/uploads/${logoFile.filename}`;
      console.log(`🖼️ Updated Logo: ${logoPath}`);
    } else if (parsed.logo && parsed.logo.includes("base64,")) {
      logoPath = await processBase64Image(parsed.logo, "logo");
    }

    
    
    
    if (files?.logo2?.[0]) {
      const logo2File = files.logo2[0];
      logo2Path = logo2File.cloudUrl || `/uploads/${logo2File.filename}`;
      console.log(`🖼️ Updated Secondary Logo: ${logo2Path}`);
    } else if (parsed.logo2 && parsed.logo2.includes("base64,")) {
      logo2Path = await processBase64Image(parsed.logo2, "logo2");
    }

    
    
    
    if (files?.favicon?.[0]) {
      const faviconFile = files.favicon[0];
      faviconPath = faviconFile.cloudUrl || `/uploads/${faviconFile.filename}`;
      console.log(`🌐 Updated Favicon: ${faviconPath}`);
    } else if (parsed.favicon && parsed.favicon.includes("base64,")) {
      faviconPath = await processBase64Image(parsed.favicon, "favicon");
    }

    
    
    
    const panelData = {
      name: parsed.title,
      tagline: parsed.tagline || "",
      logo: logoPath,
      logo2: logo2Path, 
      favicon: faviconPath,
      country: parsed.country || "",
      supportEmail: parsed.supportEmail || "",
      currency: parsed.currency || "",
    };

    const config = await updateFirstPanelConfig(panelData);

    
    
    
    const brandSettings = {
      title: config.name || parsed.title,
      tagline: config.tagline || "",
      country: config.country || "",
      currency: config.currency || "",
      supportEmail: config.supportEmail || "",
      logo: config.logo?.startsWith("https")
        ? config.logo
        : `/uploads/${config.logo}`,
      logo2: config.logo2?.startsWith("https")
        ? config.logo2
        : `/uploads/${config.logo2}`, 
      favicon: config.favicon?.startsWith("https")
        ? config.favicon
        : `/uploads/${config.favicon}`,
      updatedAt: config.updatedAt?.toISOString() || new Date().toISOString(),
    };

    res.json(brandSettings);
  } catch (err: any) {
    console.error("❌ Update Brand Settings Error:", err);
    res.status(400).json({ error: err.errors || err.message });
  }
};
