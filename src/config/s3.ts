import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { config } from "../core/config.js";
import { logger } from "../core/logger.js";

// ─── S3 Client ───
let s3Client: S3Client | null = null;

export function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: config.aws.region,
      credentials: {
        accessKeyId: config.aws.accessKeyId,
        secretAccessKey: config.aws.secretAccessKey,
      },
    });
  }
  return s3Client;
}

// ─── Build public URL from S3 key ───
export function buildS3Url(key: string): string {
  // If a CDN/CloudFront public URL is configured, use it
  if (config.aws.s3.publicUrl) {
    return `${config.aws.s3.publicUrl.replace(/\/$/, "")}/${key}`;
  }
  // Otherwise construct the standard S3 URL
  return `https://${config.aws.s3.bucket}.s3.${config.aws.region}.amazonaws.com/${key}`;
}

// ─── Extract S3 key from a full URL or path ───
export function extractS3Key(urlOrKey: string): string {
  if (!urlOrKey) return urlOrKey;
  // If it's already a key (no http), return as-is
  if (!urlOrKey.startsWith("http")) return urlOrKey;
  try {
    const url = new URL(urlOrKey);
    return url.pathname.replace(/^\//, "");
  } catch {
    return urlOrKey;
  }
}

// ─── Upload a file buffer to S3 ───
export async function uploadToS3(
  buffer: Buffer,
  key: string,
  contentType: string,
  folder: string = "uploads",
): Promise<{ key: string; url: string }> {
  const client = getS3Client();
  const fullKey = `${folder}/${key}`;

  const command = new PutObjectCommand({
    Bucket: config.aws.s3.bucket,
    Key: fullKey,
    Body: buffer,
    ContentType: contentType,
    // Make publicly readable
    ACL: "public-read",
  });

  await client.send(command);
  const url = buildS3Url(fullKey);
  logger.info(`S3 upload success: ${fullKey}`);
  return { key: fullKey, url };
}

// ─── Delete a file from S3 ───
export async function deleteFromS3(key: string): Promise<void> {
  const client = getS3Client();
  const cleanKey = extractS3Key(key);

  const command = new DeleteObjectCommand({
    Bucket: config.aws.s3.bucket,
    Key: cleanKey,
  });

  await client.send(command);
  logger.info(`S3 delete success: ${cleanKey}`);
}

// ─── Check if S3 bucket is accessible ───
export async function checkS3Connection(): Promise<boolean> {
  try {
    const client = getS3Client();
    await client.send(new HeadBucketCommand({ Bucket: config.aws.s3.bucket }));
    return true;
  } catch (err) {
    logger.warn("S3 connection check failed:", err);
    return false;
  }
}

// ─── Generate a unique S3 key for a file ───
export function generateS3Key(originalName: string, prefix: string = ""): string {
  const ext = originalName.split(".").pop() || "jpg";
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  const baseName = originalName.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9-_]/g, "-").substring(0, 40);
  const key = `${prefix ? prefix + "/" : ""}${baseName}-${timestamp}-${random}.${ext}`;
  return key;
}

export default {
  getS3Client,
  buildS3Url,
  extractS3Key,
  uploadToS3,
  deleteFromS3,
  checkS3Connection,
  generateS3Key,
};
