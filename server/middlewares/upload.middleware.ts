import multer, { FileFilterCallback } from "multer";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import path from "path";
import fs from "fs";
import { Request, Response, NextFunction } from "express";
import { createDOClient } from "../config/digitalOceanConfig";
import { PutObjectCommand } from "@aws-sdk/client-s3";

const allowedTypes = [
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/jpg","image/avif",
  "image/x-icon", "image/vnd.microsoft.icon",
  "video/mp4", "video/webm", "video/ogg", "video/avi", "video/mov",
  "audio/mp3", "audio/wav", "audio/ogg", "audio/mpeg", "audio/m4a",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
];

declare global {
  namespace Express {
    interface Multer {
      File: {
        cloudUrl?: string;
      };
    }
  }
}

const ensureDirectoryExists = (dirPath: string): void => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const localStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const userId = (req as any).user?.id || (req.body?.userId) || "guest";
    const uploadPath = path.join("uploads", userId.toString());
    
    ensureDirectoryExists(uploadPath);
    console.log(`📁 Saving file to local directory: ${uploadPath}`);
    
    cb(null, uploadPath);
  },
  filename: (_req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    console.log(`📝 Generated filename: ${uniqueName}`);
    cb(null, uniqueName);
  },
});

const fileFilter = (
  req: Request & { fileFilterError?: string },
  file: Express.Multer.File,
  cb: FileFilterCallback
) => {
  if (allowedTypes.includes(file.mimetype)) {
    console.log(`✅ File type accepted: ${file.mimetype}`);
    cb(null, true);
  } else {
    console.log(`❌ File type rejected: ${file.mimetype}`);
    req.fileFilterError = `Unsupported file type: ${file.mimetype}`;
    cb(null, false);
  }
};

export const upload = multer({
  storage: localStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, 
  fileFilter,
});

export const handleDigitalOceanUpload = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    console.log("\n🔍 Checking DigitalOcean Spaces configuration...");
    
    
    const doClient = await createDOClient();

    
    
    console.log("📊 DO Client Status:", doClient ? "✅ Active" : "❌ Inactive");
    
    
    let files: Express.Multer.File[] = [];
    
    if (req.file) {
      
      files = [req.file];
      console.log("📦 Processing 1 file (single upload)");
    } else if (req.files) {
      
      if (Array.isArray(req.files)) {
        files = req.files;
        console.log(`📦 Processing ${files.length} file(s) (array upload)`);
      } else {
        
        files = Object.values(req.files).flat();
        console.log(`📦 Processing ${files.length} file(s) (fields upload)`);
      }
    }

    if (files.length === 0) {
      console.log("⚠️ No files to process");
      return next();
    }

    
    if (!doClient) {
      console.log("💾 DigitalOcean not configured/active, files saved locally");
    console.log(files);
      files.forEach(file => {
        console.log(`   📍 Local path: ${file.path}`);
        console.log(`   🌐 Access URL: /uploads/${path.basename(path.dirname(file.path))}/${file.filename}`);
        file.cloudUrl = `${path.basename(path.dirname(file.path))}/${file.filename}`;
      });
      return next();
    }

    const { s3, bucket, endpoint } = doClient;
    console.log(`☁️ Uploading to DigitalOcean Spaces: ${bucket}`);

    
    for (const file of files) {
      try {
        console.log(`\n📤 Uploading: ${file.originalname}`);
        console.log(`   Local path: ${file.path}`);
        
        
        if (!fs.existsSync(file.path)) {
          console.error(`   ❌ File not found: ${file.path}`);
          continue;
        }
        
        
        const fileBuffer = fs.readFileSync(file.path);
        const { conversationId } = req.params;
        console.log(`   File read successfully: ${file.path} , conversationId: ${conversationId}`);
        const userId = (req as any).user?.id || (req.body?.userId) || conversationId || "guest";
        const fileKey = `uploads/${userId}/${Date.now()}-${path.basename(file.originalname)}`;

        console.log(`   Cloud key: ${fileKey}`);
        console.log(`   File size: ${fileBuffer.length} bytes`);

        
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket!,
            Key: fileKey,
            Body: fileBuffer,
            ACL: "public-read",
            ContentType: file.mimetype,
          })
        );

        
        const endpointUrl = new URL(endpoint || "");
        
        file.cloudUrl = `https://${bucket}.${endpointUrl.host}/${fileKey}`;

        console.log(`   ✅ Upload successful!`);
        console.log(`   🌐 Cloud URL: ${file.cloudUrl}`);

        
        fs.unlinkSync(file.path);
        console.log(`   🗑️ Local file deleted`);
        
      } catch (uploadError) {
        console.error(`   ❌ Upload failed for ${file.originalname}:`, uploadError);
        console.log(`   💾 Keeping local file: ${file.path}`);
        
      }
    }

    next();
  } catch (error) {
    console.error("❌ DigitalOcean Upload Middleware Error:", error);
    console.log("💾 Falling back to local storage");
    
    next();
  }
};

export const initializeUploadsDirectory = (): void => {
  ensureDirectoryExists("uploads");
  console.log("✅ Uploads directory initialized");
};
