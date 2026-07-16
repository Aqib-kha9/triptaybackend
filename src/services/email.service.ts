import { SESClient, SendEmailCommand, type SendEmailCommandInput } from "@aws-sdk/client-ses";
import { prisma } from "../config/db.js";
import { config } from "../core/config.js";
import { logger } from "../core/logger.js";
import { getEmailSettings } from "./configuration.service.js";
import { createAuditLog } from "./audit.service.js";

// ─── SES Client (lazy singleton) ───
let sesClient: SESClient | null = null;
let currentRegion = "";

export async function getSesClient(): Promise<SESClient> {
  const settings = await getEmailSettings();
  if (!sesClient || currentRegion !== settings.region) {
    currentRegion = settings.region;
    sesClient = new SESClient({
      region: settings.region,
      credentials: {
        accessKeyId: config.aws.accessKeyId,
        secretAccessKey: config.aws.secretAccessKey,
      },
    });
  }
  return sesClient;
}

// ─── Email Template Interface ───
export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

// ─── Email Templates ───
export const emailTemplates: Record<string, (data: Record<string, unknown>) => EmailTemplate> = {
  otp: (data) => ({
    subject: "Your Triptay Verification Code",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2563eb;">Triptay Verification</h2>
        <p>Hello,</p>
        <p>Your verification code is:</p>
        <h1 style="font-size: 36px; letter-spacing: 8px; color: #2563eb; text-align: center; padding: 20px; background: #f0f4ff; border-radius: 8px;">${data.code}</h1>
        <p>This code will expire in <strong>5 minutes</strong>.</p>
        <p>If you didn't request this code, please ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
        <p style="color: #6b7280; font-size: 12px;">© Triptay. All rights reserved.</p>
      </div>
    `,
    text: `Your Triptay verification code is: ${data.code}. This code expires in 5 minutes.`,
  }),

  passwordReset: (data) => ({
    subject: "Reset Your Triptay Password",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2563eb;">Password Reset Request</h2>
        <p>Hello ${data.name || "User"},</p>
        <p>We received a request to reset your password. Click the button below to set a new password:</p>
        <p style="text-align: center; margin: 30px 0;">
          <a href="${data.resetUrl}" style="background: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold;">Reset Password</a>
        </p>
        <p>Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #2563eb;">${data.resetUrl}</p>
        <p>This link will expire in <strong>24 hours</strong>.</p>
        <p>If you didn't request a password reset, please ignore this email or contact support if you have concerns.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
        <p style="color: #6b7280; font-size: 12px;">© Triptay. All rights reserved.</p>
      </div>
    `,
    text: `Reset your Triptay password by visiting: ${data.resetUrl}. This link expires in 24 hours.`,
  }),

  bookingConfirmation: (data) => ({
    subject: `Booking Confirmed - ${data.itemName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #16a34a;">✅ Booking Confirmed!</h2>
        <p>Hello ${data.guestName || "Guest"},</p>
        <p>Your booking for <strong>${data.itemName}</strong> has been confirmed.</p>
        <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Booking Ref:</strong> ${data.bookingRef}</p>
          <p><strong>Check-in:</strong> ${data.checkIn || "N/A"}</p>
          <p><strong>Check-out:</strong> ${data.checkOut || "N/A"}</p>
          <p><strong>Guests:</strong> ${data.guests}</p>
          <p><strong>Total Amount:</strong> ₹${data.totalAmount}</p>
        </div>
        <p>Thank you for choosing Triptay!</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
        <p style="color: #6b7280; font-size: 12px;">© Triptay. All rights reserved.</p>
      </div>
    `,
    text: `Booking confirmed for ${data.itemName}. Ref: ${data.bookingRef}. Total: ₹${data.totalAmount}`,
  }),

  bookingCancellation: (data) => ({
    subject: `Booking Cancelled - ${data.itemName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #dc2626;">❌ Booking Cancelled</h2>
        <p>Hello ${data.guestName || "Guest"},</p>
        <p>Your booking for <strong>${data.itemName}</strong> (Ref: ${data.bookingRef}) has been cancelled.</p>
        ${data.refundAmount ? `<p>Refund amount: <strong>₹${data.refundAmount}</strong> will be processed within 5-7 business days.</p>` : ""}
        <p>If you have any questions, please contact our support team.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
        <p style="color: #6b7280; font-size: 12px;">© Triptay. All rights reserved.</p>
      </div>
    `,
    text: `Booking cancelled for ${data.itemName}. Ref: ${data.bookingRef}.`,
  }),

  hostBookingNotification: (data) => ({
    subject: `New Booking Received - ${data.itemName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2563eb;">🎉 New Booking!</h2>
        <p>Hello ${data.hostName || "Host"},</p>
        <p>You have received a new booking for <strong>${data.itemName}</strong>.</p>
        <div style="background: #eff6ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Booking Ref:</strong> ${data.bookingRef}</p>
          <p><strong>Guest:</strong> ${data.guestName}</p>
          <p><strong>Check-in:</strong> ${data.checkIn || "N/A"}</p>
          <p><strong>Check-out:</strong> ${data.checkOut || "N/A"}</p>
          <p><strong>Guests:</strong> ${data.guests}</p>
          <p><strong>Your Payout:</strong> ₹${data.hostPayout}</p>
        </div>
        <p>Please log in to your dashboard to view full details.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
        <p style="color: #6b7280; font-size: 12px;">© Triptay. All rights reserved.</p>
      </div>
    `,
    text: `New booking for ${data.itemName}. Ref: ${data.bookingRef}. Payout: ₹${data.hostPayout}`,
  }),

  payoutProcessed: (data) => ({
    subject: `Payout Processed - ₹${data.amount}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #16a34a;">💰 Payout Processed</h2>
        <p>Hello ${data.hostName || "Host"},</p>
        <p>Your payout of <strong>₹${data.amount}</strong> has been processed.</p>
        <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Payout Ref:</strong> ${data.payoutRef}</p>
          <p><strong>Amount:</strong> ₹${data.amount}</p>
          <p><strong>Commission Deducted:</strong> ₹${data.commission}</p>
          <p><strong>Net Amount:</strong> ₹${data.netAmount}</p>
          <p><strong>Processed Date:</strong> ${data.processedDate}</p>
        </div>
        <p>The amount will be credited to your bank account within 3-5 business days.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
        <p style="color: #6b7280; font-size: 12px;">© Triptay. All rights reserved.</p>
      </div>
    `,
    text: `Payout of ₹${data.amount} processed. Ref: ${data.payoutRef}.`,
  }),

  welcome: (data) => ({
    subject: "Welcome to Triptay!",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2563eb;">Welcome to Triptay, ${data.name}! 🎉</h2>
        <p>We're excited to have you on board. Triptay is your gateway to amazing stays and activities across India.</p>
        <p>Here's what you can do:</p>
        <ul>
          <li>Browse and book unique stays and activities</li>
          <li>Save your favorite places to your wishlist</li>
          <li>Chat directly with hosts</li>
          <li>Manage all your bookings in one place</li>
        </ul>
        <p style="text-align: center; margin: 30px 0;">
          <a href="${config.app.frontendUrl}" style="background: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold;">Start Exploring</a>
        </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
        <p style="color: #6b7280; font-size: 12px;">© Triptay. All rights reserved.</p>
      </div>
    `,
    text: `Welcome to Triptay, ${data.name}! Start exploring at ${config.app.frontendUrl}`,
  }),

  kycStatus: (data) => ({
    subject: `KYC ${data.status} - Triptay`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: ${data.status === "Approved" ? "#16a34a" : "#dc2626"};">KYC ${data.status}</h2>
        <p>Hello ${data.name || "User"},</p>
        <p>Your KYC verification has been <strong>${data.status}</strong>.</p>
        ${data.status === "Approved" ? "<p>You can now list your properties and activities on Triptay!</p>" : `<p>Reason: ${data.reason || "Please check your documents and resubmit."}</p>`}
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
        <p style="color: #6b7280; font-size: 12px;">© Triptay. All rights reserved.</p>
      </div>
    `,
    text: `Your KYC has been ${data.status}.`,
  }),
};

// ─── Send Email via SES ───
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text?: string,
  metadata?: Record<string, unknown>,
): Promise<string | null> {
  try {
    const settings = await getEmailSettings();
    const client = await getSesClient();

    const params: SendEmailCommandInput = {
      Source: `${settings.fromName} <${settings.fromEmail}>`,
      Destination: { ToAddresses: [to] },
      Message: {
        Subject: { Data: subject, Charset: "UTF-8" },
        Body: {
          Html: { Data: html, Charset: "UTF-8" },
          Text: { Data: text || subject, Charset: "UTF-8" },
        },
      },
    };

    if (settings.configurationSet) {
      params.ConfigurationSetName = settings.configurationSet;
    }

    const command = new SendEmailCommand(params);
    const result = await client.send(command);

    // Log the email
    await prisma.emailLog.create({
      data: {
        to,
        from: settings.fromEmail,
        subject,
        body: html,
        status: "sent",
        messageId: result.MessageId || null,
        metadata: (metadata ?? undefined) as any,
      },
    });

    logger.info(`Email sent to ${to}: ${subject} (ID: ${result.MessageId})`);
    return result.MessageId || null;
  } catch (err: any) {
    logger.error(`Failed to send email to ${to}:`, err.message);

    // Log the failure
    try {
      const settings = await getEmailSettings();
      await prisma.emailLog.create({
        data: {
          to,
          from: settings.fromEmail,
          subject,
          body: html,
          status: "failed",
          error: err.message,
          metadata: (metadata ?? undefined) as any,
        },
      });
    } catch (logErr) {
      logger.error("Failed to log email error:", logErr);
    }

    return null;
  }
}

// ─── Send templated email ───
export async function sendTemplatedEmail(
  to: string,
  templateName: string,
  data: Record<string, unknown>,
): Promise<string | null> {
  const templateFn = emailTemplates[templateName];
  if (!templateFn) {
    logger.error(`Email template "${templateName}" not found.`);
    return null;
  }

  const template = templateFn(data);
  return sendEmail(to, template.subject, template.html, template.text, { template: templateName, ...data });
}

// ─── Send bulk emails (for marketing campaigns) ───
export async function sendBulkEmails(
  recipients: string[],
  subject: string,
  html: string,
  text?: string,
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;

  // Process in batches of 10 to avoid rate limits
  const batchSize = 10;
  for (let i = 0; i < recipients.length; i += batchSize) {
    const batch = recipients.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map((email) => sendEmail(email, subject, html, text)),
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        sent++;
      } else {
        failed++;
      }
    }
  }

  logger.info(`Bulk email complete: ${sent} sent, ${failed} failed.`);
  return { sent, failed };
}

// ─── Handle Email Webhook (AWS SES / SendGrid) ───
export async function handleEmailWebhook(payload: any, queryCampaignId?: string): Promise<void> {
  const campaignId = queryCampaignId || payload.campaignId || payload.custom_args?.campaignId || payload.mail?.tags?.campaignId?.[0];
  if (!campaignId) {
    logger.warn("Email webhook received but no campaignId found.");
    return;
  }

  // Determine event type: delivered, open, bounce/failed
  let eventType: "delivered" | "open" | "click" | "failed" | null = null;
  const sesType = payload.eventType || payload.notificationType;
  const sgEvent = payload.event; // SendGrid standard

  if (sesType === "Delivery" || sgEvent === "delivered") {
    eventType = "delivered";
  } else if (sesType === "Open" || sgEvent === "open") {
    eventType = "open";
  } else if (sesType === "Click" || sgEvent === "click") {
    eventType = "click";
  } else if (sesType === "Bounce" || sesType === "Complaint" || sgEvent === "bounce" || sgEvent === "dropped" || sgEvent === "spamreport") {
    eventType = "failed";
  }

  if (!eventType) {
    logger.info(`Email webhook ignored event: ${sesType || sgEvent}`);
    return;
  }

  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) {
    logger.warn(`Campaign ${campaignId} not found for email webhook.`);
    return;
  }

  // Update campaign count
  const updateData: any = {};
  if (eventType === "delivered") {
    updateData.totalDelivered = { increment: 1 };
  } else if (eventType === "open") {
    updateData.totalOpened = { increment: 1 };
  } else if (eventType === "click") {
    updateData.totalClicked = { increment: 1 };
  } else if (eventType === "failed") {
    updateData.totalFailed = { increment: 1 };
  }

  const updatedCampaign = await prisma.campaign.update({
    where: { id: campaignId },
    data: updateData,
  });

  await createAuditLog({
    action: "EMAIL_WEBHOOK",
    category: "webhook",
    resource: "Campaign",
    resourceId: campaignId,
    details: { event: eventType, campaignName: campaign.name, totalDelivered: updatedCampaign.totalDelivered, totalFailed: updatedCampaign.totalFailed },
  });

  logger.info(`Campaign ${campaignId} stats updated: ${eventType}`);

  // Emit to socket (to sync marketing stats on dashboard in real-time)
  const { emitToAdmins } = await import("../socket/emitter.js");
  emitToAdmins("campaign:stats_update", {
    campaignId,
    status: updatedCampaign.status,
    totalSent: updatedCampaign.totalSent,
    totalDelivered: updatedCampaign.totalDelivered,
    totalOpened: updatedCampaign.totalOpened,
    totalClicked: updatedCampaign.totalClicked,
    totalFailed: updatedCampaign.totalFailed,
  });
}

export default {
  getSesClient,
  sendEmail,
  sendTemplatedEmail,
  sendBulkEmails,
  emailTemplates,
  handleEmailWebhook,
};
