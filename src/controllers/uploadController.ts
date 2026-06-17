import type { Request, Response, NextFunction } from "express";
import cloudinary from "../config/cloudinary.js";
import { prisma } from "../config/db.js";
import { validateMagicBytes } from "../utils/validateMagicBytes.js";

// @desc    Upload a KYC document (Aadhar Front, Aadhar Back, PAN Card) to Cloudinary
// @route   POST /api/upload/document
// @access  Private
export const uploadDocument = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ status: "fail", message: "No file uploaded." });
      return;
    }

    // ── Deep magic-byte validation (MIME spoofing defence) ──
    if (!req.file.buffer || req.file.buffer.length === 0) {
      res.status(400).json({ status: "fail", message: "Uploaded file is empty." });
      return;
    }

    if (!validateMagicBytes(req.file.buffer, req.file.mimetype)) {
      const extension = req.file.originalname?.split(".").pop()?.toLowerCase() || "unknown";
      res.status(400).json({
        status: "fail",
        message: `File content does not match its declared type. The file appears to be a ".${extension}" disguised as ${req.file.mimetype}. Upload rejected for security.`,
      });
      return;
    }

    const { documentType } = req.body;
    const allowedTypes = ["aadharFront", "aadharBack", "panCardImage"];

    if (!documentType || !allowedTypes.includes(documentType)) {
      res.status(400).json({
        status: "fail",
        message: `Invalid or missing documentType. Must be one of: ${allowedTypes.join(", ")}`,
      });
      return;
    }

    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ status: "fail", message: "User not authenticated." });
      return;
    }

    // Upload the file buffer to Cloudinary
    const b64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

    const uploaded = await cloudinary.uploader.upload(b64, {
      folder: `triptay/kyc/${userId}`,
      resource_type: "image",
      public_id: `${documentType}_${Date.now()}`,
    });

    // Persist the document URL to the user record
    await prisma.user.update({
      where: { id: userId },
      data: {
        [documentType]: uploaded.secure_url,
      },
    });

    res.status(200).json({
      status: "success",
      message: `${documentType} uploaded successfully.`,
      data: {
        documentType,
        url: uploaded.secure_url,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Upload avatar/profile picture to Cloudinary
// @route   POST /api/upload/avatar
// @access  Private
export const uploadAvatar = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ status: "fail", message: "No file uploaded." });
      return;
    }

    if (!req.file.buffer || req.file.buffer.length === 0) {
      res.status(400).json({ status: "fail", message: "Uploaded file is empty." });
      return;
    }

    if (!validateMagicBytes(req.file.buffer, req.file.mimetype)) {
      res.status(400).json({
        status: "fail",
        message: "File content does not match its declared type. Upload rejected.",
      });
      return;
    }

    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ status: "fail", message: "User not authenticated." });
      return;
    }

    const b64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

    const uploaded = await cloudinary.uploader.upload(b64, {
      folder: `triptay/avatars/${userId}`,
      resource_type: "image",
      public_id: `avatar_${Date.now()}`,
      transformation: { width: 400, height: 400, crop: "fill", quality: "auto" },
    });

    // Persist avatar URL to the user record
    await prisma.user.update({
      where: { id: userId },
      data: {
        avatar: uploaded.secure_url,
      },
    });

    res.status(200).json({
      status: "success",
      message: "Avatar uploaded successfully.",
      data: {
        url: uploaded.secure_url,
      },
    });
  } catch (error) {
    next(error);
  }
};