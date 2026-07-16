import { Router } from "express";
import multer from "multer";
import type { Request, Response, NextFunction } from "express";
import { protect, restrictTo } from "../middlewares/authMiddleware.js";
import {
  createListing,
  getMyListings,
  getListing,
  updateListing,
  deleteListing,
  uploadListingMedia,
  deleteListingMedia,
  browseListings,
} from "../controllers/listingController.js";
import { validate } from "../validators/middleware.js";
import { schemas } from "../validators/schemas.js";

const router = Router();

// ── All listing routes require authentication ──
router.use(protect as any);

// ── Vendor / Dual Mode: CRUD ──
router.post("/", restrictTo("Vendor", "Dual Mode") as any, validate(schemas.listing.create), createListing as any);
router.get("/", getMyListings as any);
router.get("/:id", getListing as any);
router.put("/:id", validate(schemas.listing.update), updateListing as any);
router.delete("/:id", deleteListing as any);

// ── Listing Media (Multer with memoryStorage) ──
const listingUpload = multer({
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
    listingUpload.array("files", 5)(req, res, (err: any) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          return res.status(400).json({ status: "fail", message: `Upload error: ${err.message}` });
        }
        return res.status(400).json({ status: "fail", message: err.message || "File upload failed." });
      }
      next();
    });
  },
  uploadListingMedia as any
);

router.delete("/:id/media/:mediaId", deleteListingMedia as any);

export default router;