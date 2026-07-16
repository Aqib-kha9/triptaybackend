import { prisma } from "../config/db.js";
import { config } from "../core/config.js";
import { logger } from "../core/logger.js";
import { getWhatsAppSettings } from "./configuration.service.js";
import { createAuditLog } from "./audit.service.js";

// ─── WhatsApp Message Types ───
interface WhatsAppTextMessage {
  to: string;
  body: string;
}

interface WhatsAppTemplateMessage {
  to: string;
  templateName: string;
  languageCode: string;
  components?: Array<{
    type: string;
    parameters: Array<{ type: string; text?: string }>;
  }>;
}

// ─── Send a text message via WhatsApp Business API ───
export async function sendWhatsAppText(message: WhatsAppTextMessage): Promise<boolean> {
  const settings = await getWhatsAppSettings();
  if (!settings.enabled || !settings.phoneNumberId || !settings.accessToken) {
    logger.warn("WhatsApp API not configured. Skipping message.");
    return false;
  }

  try {
    const url = `${settings.apiUrl}/${settings.phoneNumberId}/messages`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: message.to,
        type: "text",
        text: { body: message.body },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      logger.error("WhatsApp API error:", data);
      return false;
    }

    logger.info(`WhatsApp message sent to ${message.to}`);
    return true;
  } catch (err: any) {
    logger.error("Failed to send WhatsApp message:", err.message);
    return false;
  }
}

// ─── Send a template message via WhatsApp Business API ───
export async function sendWhatsAppTemplate(message: WhatsAppTemplateMessage): Promise<boolean> {
  const settings = await getWhatsAppSettings();
  if (!settings.enabled || !settings.phoneNumberId || !settings.accessToken) {
    logger.warn("WhatsApp API not configured. Skipping message.");
    return false;
  }

  try {
    const url = `${settings.apiUrl}/${settings.phoneNumberId}/messages`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: message.to,
        type: "template",
        template: {
          name: message.templateName,
          language: { code: message.languageCode },
          components: message.components,
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      logger.error("WhatsApp template API error:", data);
      return false;
    }

    logger.info(`WhatsApp template "${message.templateName}" sent to ${message.to}`);
    return true;
  } catch (err: any) {
    logger.error("Failed to send WhatsApp template:", err.message);
    return false;
  }
}

// ─── Event-to-template mapping ───
const eventTemplateMap: Record<string, { templateName: string; languageCode: string }> = {
  booking_confirmation: { templateName: "booking_confirmation", languageCode: "en_US" },
  booking_cancellation: { templateName: "booking_cancellation", languageCode: "en_US" },
  otp_verification: { templateName: "otp_verification", languageCode: "en_US" },
  payment_success: { templateName: "payment_success", languageCode: "en_US" },
  payout_processed: { templateName: "payout_processed", languageCode: "en_US" },
  check_in_reminder: { templateName: "check_in_reminder", languageCode: "en_US" },
};

// ─── Send event-based WhatsApp notification ───
export async function sendWhatsAppEvent(
  phone: string,
  event: string,
  params: string[] = [],
): Promise<boolean> {
  const template = eventTemplateMap[event];
  if (!template) {
    logger.warn(`No WhatsApp template mapped for event: ${event}`);
    return false;
  }

  return sendWhatsAppTemplate({
    to: phone,
    templateName: template.templateName,
    languageCode: template.languageCode,
    components: params.length > 0
      ? [{
          type: "body",
          parameters: params.map((p) => ({ type: "text", text: p })),
        }]
      : undefined,
  });
}

// ─── Verify WhatsApp webhook signature ───
export async function verifyWhatsAppWebhook(token: string): Promise<boolean> {
  const settings = await getWhatsAppSettings();
  return token === settings.verifyToken;
}

// ─── Handle incoming WhatsApp webhook ───
export async function handleWhatsAppWebhook(payload: any): Promise<void> {
  try {
    if (payload.object) {
      const entries = payload.entry || [];
      for (const entry of entries) {
        const changes = entry.changes || [];
        for (const change of changes) {
          const value = change.value;
          if (value?.messages) {
            for (const message of value.messages) {
              const from = message.from;
              const text = message.text?.body;
              logger.info(`WhatsApp message from ${from}: ${text}`);

              await createAuditLog({
                action: "WHATSAPP_MESSAGE_RECEIVED",
                category: "webhook",
                details: { from, text },
              });

              // Handle opt-out
              if (text && text.toLowerCase().includes("stop")) {
                await handleOptOut(from);
              }
            }
          }
          // Handle delivery status
          if (value?.statuses) {
            for (const status of value.statuses) {
              logger.info(`WhatsApp message ${status.id} status: ${status.status}`);

              await createAuditLog({
                action: "WHATSAPP_STATUS_UPDATE",
                category: "webhook",
                details: { messageId: status.id, recipientPhone: status.recipient_id, status: status.status },
              });

              // Emit real-time status sync via socket
              const { emitToUser } = await import("../socket/emitter.js");
              emitToUser("admin", "whatsapp:status_update", {
                messageId: status.id,
                recipientPhone: status.recipient_id,
                status: status.status,
                timestamp: status.timestamp,
              });
            }
          }
        }
      }
    }
  } catch (err: any) {
    logger.error("WhatsApp webhook handling error:", err.message);
  }
}

// ─── Handle opt-out from marketing ───
async function handleOptOut(phone: string): Promise<void> {
  try {
    await prisma.marketingContact.updateMany({
      where: { phone },
      data: { optedIn: false, optedOutAt: new Date() },
    });
    logger.info(`Marketing contact opted out: ${phone}`);
  } catch (err) {
    logger.error("Failed to process opt-out:", err);
  }
}

// ─── Add/update marketing contact ───
export async function upsertMarketingContact(
  email: string,
  name?: string,
  phone?: string,
  source: string = "organic",
): Promise<void> {
  try {
    await prisma.marketingContact.upsert({
      where: { email },
      create: { email, name, phone, source, optedIn: true },
      update: { name: name || undefined, phone: phone || undefined },
    });
  } catch (err) {
    logger.error("Failed to upsert marketing contact:", err);
  }
}

export default {
  sendWhatsAppText,
  sendWhatsAppTemplate,
  sendWhatsAppEvent,
  verifyWhatsAppWebhook,
  handleWhatsAppWebhook,
  upsertMarketingContact,
};
