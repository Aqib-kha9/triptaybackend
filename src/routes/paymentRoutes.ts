import { Router } from "express";
import { protect } from "../middlewares/authMiddleware.js";
import { adminProtect } from "../middlewares/adminMiddleware.js";
import { validate } from "../validators/middleware.js";
import { schemas } from "../validators/schemas.js";
import {
  createRazorpayOrder,
  verifyRazorpayPayment,
  createPayuOrder,
  verifyPayuPayment,
  getPayment,
  processRefund,
  razorpayWebhook,
  payuWebhook,
} from "../controllers/paymentController.js";

const router = Router();

// ── Webhook endpoints (public, verified by signature/hash) ──
// These must be registered BEFORE express.json() body parsing for raw body verification
// Note: For production, configure raw body parsing for webhook routes
router.post("/webhooks/razorpay", razorpayWebhook as any);
router.post("/webhooks/payu", payuWebhook as any);

// ── All other payment routes require authentication ──
router.use(protect as any);

// ── Razorpay ──
router.post("/razorpay/order", validate(schemas.payment.createRazorpayOrder), createRazorpayOrder as any);
router.post("/razorpay/verify", validate(schemas.payment.verifyRazorpayPayment), verifyRazorpayPayment as any);

// ── PayU ──
router.post("/payu/order", validate(schemas.payment.createPayuOrder), createPayuOrder as any);
router.post("/payu/verify", validate(schemas.payment.verifyPayuPayment), verifyPayuPayment as any);

// ── Get payment details for a booking ──
router.get("/:bookingId", getPayment as any);

// ── Process refund (admin only) ──
router.post("/refund", adminProtect as any, validate(schemas.payment.processRefund), processRefund as any);

export default router;
