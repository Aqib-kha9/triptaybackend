import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { protect, restrictTo } from "../middlewares/authMiddleware.js";
import {
  getVendorItems,
  getAvailability,
  blockDates,
  unblockDates,
  bulkBlock,
  clearBlockedDates,
} from "../controllers/availabilityController.js";
import { validate } from "../validators/middleware.js";
import { schemas } from "../validators/schemas.js";

const router = Router();

// ── All availability routes require authentication ──
router.use(protect as any);

// ── Vendor / Dual Mode: Availability Management ──

// GET all vendor's items (listings + activities) for dropdown
router.get("/items", getVendorItems as any);

// GET blocked dates for a specific item
router.get("/:itemType/:itemId", getAvailability as any);

// Block specific dates
router.post("/:itemType/:itemId/block", validate(schemas.availability.blockDates), blockDates as any);

// Unblock specific dates
router.post("/:itemType/:itemId/unblock", validate(schemas.availability.unblockDates), unblockDates as any);

// Bulk block (weekends, weekdays, full month, date range)
router.post("/:itemType/:itemId/bulk-block", validate(schemas.availability.bulkBlock), bulkBlock as any);

// Clear all blocked dates
router.delete("/:itemType/:itemId/clear", clearBlockedDates as any);

export default router;