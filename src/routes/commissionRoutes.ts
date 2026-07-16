import { Router } from "express";
import { protect, restrictTo } from "../middlewares/authMiddleware.js";
import { adminProtect } from "../middlewares/adminMiddleware.js";
import { validate } from "../validators/middleware.js";
import { schemas } from "../validators/schemas.js";
import {
  getHostPendingPayouts,
  processPayout,
  getHostPayouts,
  getAllPayouts,
  getCommissionSummary,
  getHostLedger,
  getHostLedgerByAdmin,
} from "../controllers/commissionController.js";

const router = Router();

// ── Host routes (Vendor / Dual Mode) ──
router.get("/pending", protect as any, restrictTo("Vendor", "Dual Mode") as any, getHostPendingPayouts as any);
router.get("/payouts", protect as any, restrictTo("Vendor", "Dual Mode") as any, getHostPayouts as any);
router.get("/ledger", protect as any, restrictTo("Vendor", "Dual Mode") as any, getHostLedger as any);

// ── Admin-only routes ──
router.post("/payouts", adminProtect as any, validate(schemas.commission.processPayout), processPayout as any);
router.get("/payouts/all", adminProtect as any, getAllPayouts as any);
router.get("/summary", adminProtect as any, getCommissionSummary as any);
router.get("/ledger/:hostId", adminProtect as any, getHostLedgerByAdmin as any);

export default router;
