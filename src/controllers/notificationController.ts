import type { Request, Response, NextFunction } from "express";
import { sendTemplatedEmail, sendBulkEmails, handleEmailWebhook } from "../services/email.service.js";
import {
  sendWhatsAppText,
  sendWhatsAppEvent,
  verifyWhatsAppWebhook,
  handleWhatsAppWebhook,
  upsertMarketingContact,
} from "../services/whatsapp.service.js";
import {
  registerFcmToken,
  removeUserTokens,
  sendPushToUser,
} from "../services/push.service.js";
import {
  getMyNotifications as fetchMyNotifications,
  getUnreadCount as fetchUnreadCount,
  markAsRead as markNotificationRead,
  markAllAsRead as markAllNotificationsRead,
  deleteNotification as removeNotification,
  deleteAllNotifications as removeAllNotifications,
} from "../services/notification.service.js";
import { logger } from "../core/logger.js";
import { BadRequestError } from "../core/errors.js";

// ──────────────────────── Email Controllers ────────────────────────

// @desc    Send a templated email (admin only)
// @route   POST /api/notifications/email/templated
// @access  Private/Admin
export const sendTemplatedEmailHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { to, template, data } = req.body;

    if (!to || !template) {
      throw new BadRequestError("Please supply 'to' email and 'template' name.");
    }

    const messageId = await sendTemplatedEmail(to, template, data || {});

    res.status(200).json({
      status: "success",
      message: "Email sent successfully.",
      data: { messageId },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Send bulk emails (admin only - for marketing campaigns)
// @route   POST /api/notifications/email/bulk
// @access  Private/Admin
export const sendBulkEmailHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { recipients, subject, html, text } = req.body;

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      throw new BadRequestError("Please supply a non-empty 'recipients' array.");
    }
    if (!subject || !html) {
      throw new BadRequestError("Please supply 'subject' and 'html' content.");
    }

    const result = await sendBulkEmails(recipients, subject, html, text);

    res.status(200).json({
      status: "success",
      message: `Bulk email complete: ${result.sent} sent, ${result.failed} failed.`,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── WhatsApp Controllers ────────────────────────

// @desc    Send a WhatsApp text message (admin only)
// @route   POST /api/notifications/whatsapp/text
// @access  Private/Admin
export const sendWhatsAppTextHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { to, body } = req.body;

    if (!to || !body) {
      throw new BadRequestError("Please supply 'to' phone number and 'body' message.");
    }

    const sent = await sendWhatsAppText({ to, body });

    res.status(200).json({
      status: "success",
      message: sent ? "WhatsApp message sent." : "WhatsApp message failed to send.",
      data: { sent },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Send a WhatsApp event-based notification (admin only)
// @route   POST /api/notifications/whatsapp/event
// @access  Private/Admin
export const sendWhatsAppEventHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { to, event, params } = req.body;

    if (!to || !event) {
      throw new BadRequestError("Please supply 'to' phone number and 'event' name.");
    }

    const sent = await sendWhatsAppEvent(to, event, params || []);

    res.status(200).json({
      status: "success",
      message: sent ? "WhatsApp event notification sent." : "WhatsApp event notification failed.",
      data: { sent },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    WhatsApp webhook verification (GET)
// @route   GET /api/notifications/whatsapp/webhook
// @access  Public
export const verifyWhatsAppWebhookHandler = async (req: Request, res: Response): Promise<void> => {
  const mode = req.query["hub.mode"] as string;
  const token = req.query["hub.verify_token"] as string;
  const challenge = req.query["hub.challenge"] as string;

  if (mode && token) {
    const isValid = await verifyWhatsAppWebhook(token);
    if (mode === "subscribe" && isValid) {
      logger.info("WhatsApp webhook verified.");
      res.status(200).send(challenge);
      return;
    }
    res.status(403).json({ status: "fail", message: "Webhook verification failed." });
    return;
  }

  res.status(400).json({ status: "fail", message: "Missing verification parameters." });
};

// @desc    WhatsApp webhook receiver (POST)
// @route   POST /api/notifications/whatsapp/webhook
// @access  Public
export const receiveWhatsAppWebhookHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await handleWhatsAppWebhook(req.body);
    res.status(200).json({ status: "success", message: "Webhook received." });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── Push Notification Controllers ────────────────────────

// @desc    Register FCM token for push notifications
// @route   POST /api/notifications/push/register
// @access  Private
export const registerFcmTokenHandler = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ status: "fail", message: "User session not active." });
      return;
    }

    const { token, deviceType, deviceId } = req.body;
    if (!token) {
      throw new BadRequestError("Please supply an FCM 'token'.");
    }

    await registerFcmToken(req.user.id, token, deviceType, deviceId);

    res.status(200).json({
      status: "success",
      message: "FCM token registered successfully.",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Remove FCM tokens (on logout)
// @route   POST /api/notifications/push/unregister
// @access  Private
export const unregisterFcmTokenHandler = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ status: "fail", message: "User session not active." });
      return;
    }

    await removeUserTokens(req.user.id);

    res.status(200).json({
      status: "success",
      message: "FCM tokens removed successfully.",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Send push notification to a user (admin only)
// @route   POST /api/notifications/push/send
// @access  Private/Admin
export const sendPushHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { userId, title, body, data } = req.body;

    if (!userId || !title || !body) {
      throw new BadRequestError("Please supply 'userId', 'title', and 'body'.");
    }

    const sent = await sendPushToUser(userId, { title, body, data });

    res.status(200).json({
      status: "success",
      message: sent ? "Push notification sent." : "Push notification failed (no active tokens).",
      data: { sent },
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── Marketing Contact Controllers ────────────────────────

// @desc    Add/update a marketing contact
// @route   POST /api/notifications/marketing/contact
// @access  Private/Admin
export const upsertMarketingContactHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, name, phone, source } = req.body;

    if (!email) {
      throw new BadRequestError("Please supply an 'email'.");
    }

    await upsertMarketingContact(email, name, phone, source || "manual");

    res.status(200).json({
      status: "success",
      message: "Marketing contact saved successfully.",
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── In-App Notification Controllers ────────────────────────

// @desc    Get my notifications (paginated, filterable by type)
// @route   GET /api/notifications
// @access  Private
export const getMyNotifications = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user.id;
    const { page, limit, type } = req.query;

    const result = await fetchMyNotifications(
      userId,
      page as string | undefined,
      limit as string | undefined,
      type as string | undefined,
    );

    res.status(200).json({
      status: "success",
      results: result.notifications.length,
      data: { notifications: result.notifications },
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get unread notification count
// @route   GET /api/notifications/unread
// @access  Private
export const getUnreadCount = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user.id;
    const count = await fetchUnreadCount(userId);

    res.status(200).json({
      status: "success",
      data: { count },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Mark a single notification as read
// @route   PATCH /api/notifications/:notificationId/read
// @access  Private
export const markAsRead = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user.id;
    const { notificationId } = req.params;

    const notification = await markNotificationRead(userId, notificationId);

    res.status(200).json({
      status: "success",
      message: "Notification marked as read.",
      data: { notification },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Mark all notifications as read
// @route   PATCH /api/notifications/read-all
// @access  Private
export const markAllAsRead = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user.id;
    await markAllNotificationsRead(userId);

    res.status(200).json({
      status: "success",
      message: "All notifications marked as read.",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete a single notification
// @route   DELETE /api/notifications/:notificationId
// @access  Private
export const deleteNotification = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user.id;
    const { notificationId } = req.params;

    await removeNotification(userId, notificationId);

    res.status(200).json({
      status: "success",
      message: "Notification deleted.",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete all notifications
// @route   DELETE /api/notifications
// @access  Private
export const deleteAllNotifications = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user.id;
    await removeAllNotifications(userId);

    res.status(200).json({
      status: "success",
      message: "All notifications deleted.",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Email webhook receiver (AWS SES / SendGrid)
// @route   POST /api/notifications/email/webhook
// @access  Public
export const receiveEmailWebhookHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const isSns = req.headers["x-amz-sns-message-type"];

    // AWS SNS subscription confirmation
    if (isSns === "SubscriptionConfirmation") {
      const subscribeUrl = req.body.SubscribeURL;
      if (subscribeUrl) {
        logger.info(`AWS SNS subscription URL: ${subscribeUrl}`);
        // Fetch/GET the URL to confirm subscription
        await fetch(subscribeUrl);
        res.status(200).send("Subscription confirmed");
        return;
      }
    }

    let payload = req.body;
    // AWS SNS Notification JSON parsing
    if (isSns === "Notification" && typeof req.body.Message === "string") {
      try {
        payload = JSON.parse(req.body.Message);
      } catch (err) {
        logger.warn("Failed to parse AWS SNS Message JSON:", err);
      }
    }

    const campaignId = req.query.campaignId as string;
    if (Array.isArray(payload)) {
      for (const event of payload) {
        await handleEmailWebhook(event, campaignId);
      }
    } else {
      await handleEmailWebhook(payload, campaignId);
    }

    res.status(200).json({ status: "success", message: "Webhook processed" });
  } catch (error) {
    next(error);
  }
};
