import { Router } from "express";
import multer from "multer";
import type { Request, Response, NextFunction } from "express";
import { protect } from "../middlewares/authMiddleware.js";
import { uploadDocument, uploadAvatar } from "../controllers/uploadController.js";
import { validate } from "../validators/middleware.js";
import { schemas } from "../validators/schemas.js";

const router = Router();

// ──────────────────────── Magic Byte Validation ────────────────────────
// Verifies actual file content, not just the spoofable MIME header.

// ──────────────────────── Multer Config ────────────────────────

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (_req, file, cb) => {
    // 1. Quick MIME check (first line of defence)
    const allowedMimes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!allowedMimes.includes(file.mimetype)) {
      cb(new Error("Invalid file type. Only JPEG, PNG, WEBP, and PDF are allowed."));
      return;
    }

    // 2. Magic byte validation (defence against MIME spoofing)
    //    Multer memoryStorage gives us file.buffer after the file is fully read.
    //    Since multer doesn't expose buffer in fileFilter, we accept here and
    //    perform deep validation in the controller instead.
    cb(null, true);
  },
});

// POST /api/upload/document — protected, single file upload with documentType in body
// Multer errors (file too large, invalid type) are caught and forwarded to the global error handler.
router.post("/document", protect, (req: Request, res: Response, next: NextFunction) => {
  upload.single("file")(req, res, (err: any) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        // Multer-specific errors (e.g., file too large)
        return res.status(400).json({
          status: "fail",
          message: `Upload error: ${err.message}`,
        });
      }
      // Other errors (e.g., invalid file type from fileFilter)
      return res.status(400).json({
        status: "fail",
        message: err.message || "File upload failed.",
      });
    }
    next();
  });
}, validate(schemas.upload.document), uploadDocument);

// POST /api/upload/avatar — protected, single file upload for profile picture
router.post("/avatar", protect, (req: Request, res: Response, next: NextFunction) => {
  upload.single("file")(req, res, (err: any) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({
          status: "fail",
          message: `Upload error: ${err.message}`,
        });
      }
      return res.status(400).json({
        status: "fail",
        message: err.message || "File upload failed.",
      });
    }
    next();
  });
}, uploadAvatar);

export default router;