import { prisma } from "../config/db.js";
import { config } from "../core/config.js";
import { logger } from "../core/logger.js";

// ─── Firebase Admin SDK (lazy initialization) ───
let firebaseApp: any = null;
let messaging: any = null;

export function initFirebase(): any {
  if (firebaseApp) return firebaseApp;

  if (!config.firebase.projectId || !config.firebase.clientEmail || !config.firebase.privateKey) {
    logger.warn("Firebase credentials not configured. Push notifications disabled.");
    return null;
  }

  try {
    const admin = require("firebase-admin");
    const serviceAccount = {
      type: "service_account",
      project_id: config.firebase.projectId,
      private_key: config.firebase.privateKey,
      client_email: config.firebase.clientEmail,
      token_uri: "https://oauth2.googleapis.com/token",
    };

    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: config.firebase.databaseUrl || undefined,
    });

    messaging = admin.messaging();
    logger.info("Firebase Admin SDK initialized.");
    return firebaseApp;
  } catch (err: any) {
    logger.error("Failed to initialize Firebase:", err.message);
    return null;
  }
}

// ─── Get messaging instance ───
function getMessaging(): any {
  if (!messaging) {
    initFirebase();
  }
  return messaging;
}

// ─── Send push notification to a single device ───
export async function sendPushNotification(
  token: string,
  notification: {
    title: string;
    body: string;
    data?: Record<string, string>;
  },
): Promise<boolean> {
  const msg = getMessaging();
  if (!msg) {
    logger.warn("Firebase messaging not available. Skipping push notification.");
    return false;
  }

  try {
    const message = {
      token,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: notification.data || {},
      android: {
        notification: {
          channelId: "triptay_notifications",
          priority: "high" as const,
        },
      },
      apns: {
        payload: {
          aps: {
            badge: 1,
            sound: "default",
          },
        },
      },
    };

    const response = await msg.send(message);
    logger.info(`Push notification sent: ${response}`);
    return true;
  } catch (err: any) {
    logger.error("Failed to send push notification:", err.message);

    // If token is invalid, deactivate it
    if (err.code === "messaging/invalid-registration-token" || err.code === "messaging/registration-token-not-registered") {
      await deactivateToken(token);
    }
    return false;
  }
}

// ─── Send push notification to multiple devices (multicast) ───
export async function sendMulticastPush(
  tokens: string[],
  notification: {
    title: string;
    body: string;
    data?: Record<string, string>;
  },
): Promise<{ sent: number; failed: number }> {
  const msg = getMessaging();
  if (!msg || tokens.length === 0) {
    return { sent: 0, failed: 0 };
  }

  try {
    const message = {
      tokens,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: notification.data || {},
      android: {
        notification: {
          channelId: "triptay_notifications",
          priority: "high" as const,
        },
      },
      apns: {
        payload: {
          aps: {
            badge: 1,
            sound: "default",
          },
        },
      },
    };

    const response = await msg.sendEachForMulticast(message);
    const sent = response.responses.filter((r: any) => r.success).length;
    const failed = response.responses.filter((r: any) => !r.success).length;

    // Deactivate invalid tokens
    response.responses.forEach((resp: any, idx: number) => {
      if (!resp.success) {
        const errorCode = resp.error?.code;
        if (errorCode === "messaging/invalid-registration-token" || errorCode === "messaging/registration-token-not-registered") {
          const token = tokens[idx];
          if (token) deactivateToken(token);
        }
      }
    });

    logger.info(`Multicast push: ${sent} sent, ${failed} failed.`);
    return { sent, failed };
  } catch (err: any) {
    logger.error("Failed to send multicast push:", err.message);
    return { sent: 0, failed: tokens.length };
  }
}

// ─── Send push notification to a user (all their devices) ───
export async function sendPushToUser(
  userId: string,
  notification: {
    title: string;
    body: string;
    data?: Record<string, string>;
  },
): Promise<boolean> {
  try {
    const tokens = await prisma.fcmToken.findMany({
      where: { userId, isActive: true },
      select: { token: true },
    });

    if (tokens.length === 0) {
      logger.info(`No active FCM tokens for user ${userId}. Skipping push.`);
      return false;
    }

    const tokenList = tokens.map((t) => t.token);
    if (tokenList.length === 1) {
      return sendPushNotification(tokenList[0]!, notification);
    }

    const result = await sendMulticastPush(tokenList, notification);
    return result.sent > 0;
  } catch (err: any) {
    logger.error("Failed to send push to user:", err.message);
    return false;
  }
}

// ─── Register/update FCM token for a user ───
export async function registerFcmToken(
  userId: string,
  token: string,
  deviceType?: string,
  deviceId?: string,
): Promise<void> {
  try {
    await prisma.fcmToken.upsert({
      where: { userId_token: { userId, token } },
      create: { userId, token, deviceType, deviceId, isActive: true },
      update: { deviceType, deviceId, isActive: true },
    });
    logger.info(`FCM token registered for user ${userId}.`);
  } catch (err: any) {
    logger.error("Failed to register FCM token:", err.message);
  }
}

// ─── Deactivate an FCM token ───
export async function deactivateToken(token: string): Promise<void> {
  try {
    await prisma.fcmToken.updateMany({
      where: { token },
      data: { isActive: false },
    });
  } catch (err) {
    logger.error("Failed to deactivate FCM token:", err);
  }
}

// ─── Remove all FCM tokens for a user (on logout) ───
export async function removeUserTokens(userId: string): Promise<void> {
  try {
    await prisma.fcmToken.deleteMany({ where: { userId } });
  } catch (err) {
    logger.error("Failed to remove user FCM tokens:", err);
  }
}

export default {
  initFirebase,
  sendPushNotification,
  sendMulticastPush,
  sendPushToUser,
  registerFcmToken,
  deactivateToken,
  removeUserTokens,
};
