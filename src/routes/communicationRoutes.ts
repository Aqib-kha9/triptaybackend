import { Router } from "express";
import { protect } from "../middlewares/authMiddleware.js";
import { adminProtect } from "../middlewares/adminMiddleware.js";
import {
  // Email
  sendTemplatedEmailHandler,
  sendBulkEmailHandler,
  receiveEmailWebhookHandler,
  // WhatsApp
  sendWhatsAppTextHandler,
  sendWhatsAppEventHandler,
  verifyWhatsAppWebhookHandler,
  receiveWhatsAppWebhookHandler,
  // Push
  registerFcmTokenHandler,
  unregisterFcmTokenHandler,
  sendPushHandler,
  // Marketing
  upsertMarketingContactHandler,
} from "../controllers/notificationController.js";

const router = Router();

// ── Webhook Endpoints (Public — no auth) ──
router.post("/email/webhook", receiveEmailWebhookHandler as any);

// ── WhatsApp Webhook (Public — no auth, verified by token) ──
router.get("/whatsapp/webhook", verifyWhatsAppWebhookHandler);
router.post("/whatsapp/webhook", receiveWhatsAppWebhookHandler);

// ── Push notification token management (authenticated users) ──
router.post("/push/register", protect as any, registerFcmTokenHandler as any);
router.post("/push/unregister", protect as any, unregisterFcmTokenHandler as any);

// ── Admin-only communication routes ──
router.use(adminProtect as any);

// Email
router.post("/email/templated", sendTemplatedEmailHandler as any);
router.post("/email/bulk", sendBulkEmailHandler as any);

// WhatsApp
router.post("/whatsapp/text", sendWhatsAppTextHandler as any);
router.post("/whatsapp/event", sendWhatsAppEventHandler as any);

// Push
router.post("/push/send", sendPushHandler as any);

// Marketing
router.post("/marketing/contact", upsertMarketingContactHandler as any);

export default router;
