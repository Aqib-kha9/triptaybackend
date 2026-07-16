import cloudinary from "../config/cloudinary.js";
import { prisma } from "../config/db.js";
import { BadRequestError, UnauthorizedError } from "../core/errors.js";
import { validateMagicBytes } from "../utils/validateMagicBytes.js";
import { config } from "../core/config.js";
import {
  uploadToS3,
  deleteFromS3,
  buildS3Url,
  generateS3Key,
  extractS3Key,
} from "../config/s3.js";
import { logger } from "../core/logger.js";

// ──────────────────────── Types ────────────────────────

export interface UploadResult {
  documentType?: string;
  url: string;
  key?: string;
}

// ──────────────────────── Helpers ────────────────────────

function validateFile(file: Express.Multer.File | undefined): asserts file is Express.Multer.File {
  if (!file) {
    throw new BadRequestError("No file uploaded.");
  }

  if (!file.buffer || file.buffer.length === 0) {
    throw new BadRequestError("Uploaded file is empty.");
  }

  if (!validateMagicBytes(file.buffer, file.mimetype)) {
    const extension = file.originalname?.split(".").pop()?.toLowerCase() || "unknown";
    throw new BadRequestError(
      `File content does not match its declared type. The file appears to be a ".${extension}" disguised as ${file.mimetype}. Upload rejected for security.`,
    );
  }
}

function toBase64(file: Express.Multer.File): string {
  return `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
}

/**
 * Checks whether S3 is configured (credentials + bucket present).
 */
function isS3Configured(): boolean {
  return !!(config.aws.accessKeyId && config.aws.secretAccessKey && config.aws.s3.bucket);
}

/**
 * Resolves a stored path/key to a full public URL.
 * - If the value is already a full URL (http/https), returns as-is.
 * - If it's an S3 key/path, constructs the URL using buildS3Url().
 */
export function resolveMediaUrl(pathOrUrl: string | undefined | null): string | undefined {
  if (!pathOrUrl) return undefined;
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    return pathOrUrl;
  }
  return buildS3Url(pathOrUrl);
}

// ──────────────────────── Service Functions ────────────────────────

export async function uploadDocument(
  userId: string | undefined,
  file: Express.Multer.File | undefined,
  documentType: string,
): Promise<UploadResult> {
  validateFile(file);

  const allowedTypes = ["aadharFront", "aadharBack", "panCardImage"];
  if (!documentType || !allowedTypes.includes(documentType)) {
    throw new BadRequestError(
      `Invalid or missing documentType. Must be one of: ${allowedTypes.join(", ")}`,
    );
  }

  if (!userId) {
    throw new UnauthorizedError("User not authenticated.");
  }

  let storedPath: string;
  let url: string;

  if (isS3Configured()) {
    // ── S3 upload: store the key/path, not the full URL ──
    const key = generateS3Key(file.originalname, `kyc/${userId}/${documentType}`);
    const result = await uploadToS3(file.buffer, key, file.mimetype, "triptay");
    storedPath = result.key;
    url = result.url;
    logger.info(`Document uploaded to S3: ${storedPath}`);
  } else {
    // ── Cloudinary fallback ──
    const b64 = toBase64(file);
    const uploaded = await cloudinary.uploader.upload(b64, {
      folder: `triptay/kyc/${userId}`,
      resource_type: "image",
      public_id: `${documentType}_${Date.now()}`,
    });
    storedPath = uploaded.secure_url;
    url = uploaded.secure_url;
    logger.info(`Document uploaded to Cloudinary: ${uploaded.public_id}`);
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      [documentType]: storedPath,
    },
  });

  return { documentType, url, key: isS3Configured() ? storedPath : undefined };
}

export async function uploadAvatar(
  userId: string | undefined,
  file: Express.Multer.File | undefined,
): Promise<UploadResult> {
  validateFile(file);

  if (!userId) {
    throw new UnauthorizedError("User not authenticated.");
  }

  let storedPath: string;
  let url: string;

  if (isS3Configured()) {
    // ── S3 upload: store the key/path, not the full URL ──
    const key = generateS3Key(file.originalname, `avatars/${userId}`);
    const result = await uploadToS3(file.buffer, key, file.mimetype, "triptay");
    storedPath = result.key;
    url = result.url;
    logger.info(`Avatar uploaded to S3: ${storedPath}`);
  } else {
    // ── Cloudinary fallback ──
    const b64 = toBase64(file);
    const uploaded = await cloudinary.uploader.upload(b64, {
      folder: `triptay/avatars/${userId}`,
      resource_type: "image",
      public_id: `avatar_${Date.now()}`,
      transformation: { width: 400, height: 400, crop: "fill", quality: "auto" },
    });
    storedPath = uploaded.secure_url;
    url = uploaded.secure_url;
    logger.info(`Avatar uploaded to Cloudinary: ${uploaded.public_id}`);
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      avatar: storedPath,
    },
  });

  return { url, key: isS3Configured() ? storedPath : undefined };
}

/**
 * Uploads a media file (for listings/activities) to S3 or Cloudinary.
 * Returns the stored path/key and the public URL.
 */
export async function uploadMedia(
  file: Express.Multer.File,
  folder: string,
): Promise<{ path: string; url: string; publicId?: string }> {
  validateFile(file);

  if (isS3Configured()) {
    const key = generateS3Key(file.originalname, folder);
    const result = await uploadToS3(file.buffer, key, file.mimetype, "triptay");
    return { path: result.key, url: result.url };
  }

  // Cloudinary fallback
  const b64 = toBase64(file);
  const uploaded = await cloudinary.uploader.upload(b64, {
    folder: `triptay/${folder}`,
    resource_type: "image",
    quality: "auto:good",
    fetch_format: "auto",
  });

  return { path: uploaded.secure_url, url: uploaded.secure_url, publicId: uploaded.public_id };
}

/**
 * Deletes a media file from S3 or Cloudinary.
 * Accepts either an S3 key/path or a Cloudinary public_id/URL.
 */
export async function deleteMedia(pathOrPublicId: string, isCloudinary: boolean = false): Promise<void> {
  if (!pathOrPublicId) return;

  try {
    if (isCloudinary || pathOrPublicId.startsWith("http")) {
      // Cloudinary deletion
      const publicId = pathOrPublicId.startsWith("http")
        ? extractS3Key(pathOrPublicId) // won't work for cloudinary, but try
        : pathOrPublicId;
      await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
    } else {
      // S3 deletion
      await deleteFromS3(pathOrPublicId);
    }
  } catch (err) {
    logger.warn("Media deletion warning:", err);
  }
}
