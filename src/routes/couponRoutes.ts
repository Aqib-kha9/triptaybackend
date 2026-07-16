import { Router } from "express";
import { protect } from "../middlewares/authMiddleware.js";
import { adminProtect } from "../middlewares/adminMiddleware.js";
import { validate } from "../validators/middleware.js";
import { schemas } from "../validators/schemas.js";
import {
  createCoupon,
  updateCoupon,
  deleteCoupon,
  listCoupons,
  getCouponStats,
  validateCoupon,
} from "../controllers/couponController.js";

const router = Router();

// ── Validate a coupon (authenticated users) ──
router.post("/validate", protect as any, validate(schemas.coupon.validate), validateCoupon as any);

// ── Admin-only routes ──
router.use(adminProtect as any);

// ── Create a coupon ──
router.post("/", validate(schemas.coupon.create), createCoupon as any);

// ── List all coupons ──
router.get("/", listCoupons as any);

// ── Get coupon usage stats ──
router.get("/:id/stats", getCouponStats as any);

// ── Update a coupon ──
router.put("/:id", validate(schemas.coupon.update), updateCoupon as any);

// ── Delete a coupon ──
router.delete("/:id", deleteCoupon as any);

export default router;
