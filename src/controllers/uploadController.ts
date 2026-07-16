import type { Response, NextFunction } from "express";
import * as uploadService from "../services/upload.service.js";

// ──────────────────────── Controllers ────────────────────────

// @desc    Upload a document (KYC, etc.)
// @route   POST /api/upload/document
// @access  Private
export const uploadDocument = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await uploadService.uploadDocument(
      req.user.id,
      req.file as Express.Multer.File,
      req.body.documentType,
    );

    res.status(200).json({
      status: "success",
      message: "Document uploaded successfully.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Upload an avatar image
// @route   POST /api/upload/avatar
// @access  Private
export const uploadAvatar = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await uploadService.uploadAvatar(
      req.user.id,
      req.file as Express.Multer.File,
    );

    res.status(200).json({
      status: "success",
      message: "Avatar uploaded successfully.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};