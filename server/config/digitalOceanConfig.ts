import { S3Client } from "@aws-sdk/client-s3";
import { storageSettings } from "@shared/schema";
import { eq } from "drizzle-orm";
import { db } from "server/db";

export const createDOClient = async () => {
  try {
    console.log("🔍 Fetching storage settings from database...");
    
    const settings = await db
      .select()
      .from(storageSettings)
      .where(eq(storageSettings.isActive, true))
      .limit(1);

    if (!settings || settings.length === 0) {
      console.log("⚠️ No active storage settings found in database");
      return null;
    }

    const config = settings[0];
    
    
    let cleanEndpoint = config.endpoint.trim();
    
    
    cleanEndpoint = cleanEndpoint.replace(/\/$/, '');
    
    
    
    const urlParts = new URL(cleanEndpoint);
    const hostParts = urlParts.host.split('.');
    
    
    if (hostParts.length > 3) {
      
      hostParts.shift();
      urlParts.host = hostParts.join('.');
      cleanEndpoint = urlParts.toString();
    }

    console.log("✅ Active storage settings found:");
    console.log(`   Provider: ${config.provider}`);
    console.log(`   Space Name: ${config.spaceName}`);
    console.log(`   Region: ${config.region}`);
    console.log(`   Original Endpoint: ${config.endpoint}`);
    console.log(`   Cleaned Endpoint: ${cleanEndpoint}`);
    console.log(`   Is Active: ${config.isActive}`);

    const s3Client = new S3Client({
      endpoint: cleanEndpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      forcePathStyle: false, 
    });

    console.log("✅ S3 Client created successfully");

    return {
      s3: s3Client,
      bucket: config.spaceName,
      endpoint: cleanEndpoint,
    };
  } catch (error) {
    console.error("❌ Error creating DO client:", error);
    return null;
  }
};
