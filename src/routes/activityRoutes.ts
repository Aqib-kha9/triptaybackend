import { Router } from "express";
import multer from "multer";
import type { Request, Response, NextFunction } from "express";
import { protect, restrictTo } from "../middlewares/authMiddleware.js";
import {
  createActivity,
  getMyActivities,
  getActivity,
  updateActivity,
  deleteActivity,
  uploadActivityMedia,
  deleteActivityMedia,
  browseActivities,
} from "../controllers/activityController.js";

const router = Router();

// ── All activity routes require authentication ──
router.use(protect as any);

// ── Vendor / Dual Mode: CRUD ──
router.post("/", restrictTo("Vendor", "Dual Mode") as any, createActivity as any);
router.get("/", getMyActivities as any);
router.get("/:id", getActivity as any);
router.put("/:id", updateActivity as any);
router.delete("/:id", deleteActivity as any);

// ── Activity Media (Multer with memoryStorage) ──
const activityUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB per file
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Only JPEG, PNG, and WebP are allowed.`));
    }
  },
});

router.post(
  "/:id/media",
  (req: Request, res: Response, next: NextFunction) => {
    activityUpload.array("files", 5)(req, res, (err: any) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          return res.status(400).json({ status: "fail", message: `Upload error: ${err.message}` });
        }
        return res.status(400).json({ status: "fail", message: err.message || "File upload failed." });
      }
      next();
    });
  },
  uploadActivityMedia as any
);

router.delete("/:id/media/:mediaId", deleteActivityMedia as any);

export default router;