import { Router } from "express";
import { protect, restrictTo } from "../middlewares/authMiddleware.js";
import { adminProtect } from "../middlewares/adminMiddleware.js";
import { validate } from "../validators/middleware.js";
import { schemas } from "../validators/schemas.js";
import {
  createBooking,
  getBookingPreview,
  getMyBookings,
  getBooking,
  getCancelPreview,
  cancelBooking,
  expireBooking,
  confirmBooking,
  rejectBooking,
  completeBooking,
  verifyBookingOtp,
} from "../controllers/bookingController.js";

const router = Router();

// ── All booking routes require authentication ──
router.use(protect as any);

// ── Booking preview (calculate pricing before creating) ──
router.post("/preview", validate(schemas.booking.preview), getBookingPreview as any);

// ── Create a booking ──
router.post("/", validate(schemas.booking.create), createBooking as any);

// ── Get current user's bookings (as guest or host via ?role=host) ──
router.get("/", getMyBookings as any);

// ── Get a single booking ──
router.get("/:id", getBooking as any);

// ── Get cancellation preview (refund amount, policy, penalty) ──
router.get("/:id/cancel-preview", getCancelPreview as any);

// ── Cancel a booking (guest or host) ──
router.post("/:id/cancel", validate(schemas.booking.cancel), cancelBooking as any);

// ── Expire a pending booking (release dates on payment failure/abandonment) ──
router.post("/:id/expire", expireBooking as any);

// ── Confirm a booking (host only) ──
router.post("/:id/confirm", restrictTo("Vendor", "Dual Mode") as any, confirmBooking as any);

// ── Reject a booking (host only) ──
router.post("/:id/reject", restrictTo("Vendor", "Dual Mode") as any, validate(schemas.booking.reject), rejectBooking as any);

// ── Verify Check-In OTP (host only) ──
router.post("/:id/verify-otp", restrictTo("Vendor", "Dual Mode") as any, verifyBookingOtp as any);

// ── Complete a booking (admin only) ──
router.post("/:id/complete", adminProtect as any, completeBooking as any);

export default router;
