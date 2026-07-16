import Razorpay from "razorpay";
import crypto from "crypto";
import { prisma } from "../config/db.js";
import { config } from "../core/config.js";
import {
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
} from "../core/errors.js";
import { logger } from "../core/logger.js";
import { createAuditLog } from "./audit.service.js";
import { sendTemplatedEmail } from "./email.service.js";
import { sendPushToUser } from "./push.service.js";
import { getGatewaySettings } from "./configuration.service.js";
import { emitToUser } from "../socket/emitter.js";

// ─── Initialize payment gateways (DB-backed with env fallback) ───
// Instances are cached but keyed by credentials so that admin changes take effect
let razorpayInstance: Razorpay | null = null;
let razorpayKeyHash = "";

export async function getRazorpay(): Promise<Razorpay | null> {
  const settings = await getGatewaySettings();
  if (!settings.razorpay.enabled) {
    return null;
  }
  const keyId = settings.razorpay.liveMode ? settings.razorpay.keyId : (settings.razorpay.testKeyId || settings.razorpay.keyId);
  const keySecret = settings.razorpay.liveMode ? settings.razorpay.keySecret : (settings.razorpay.testKeySecret || settings.razorpay.keySecret);
  if (!keyId || !keySecret) {
    logger.warn("Razorpay credentials not configured.");
    return null;
  }
  // Re-initialize if credentials changed (admin updated keys)
  const credHash = crypto.createHash("md5").update(`${keyId}:${keySecret}`).digest("hex");
  if (!razorpayInstance || credHash !== razorpayKeyHash) {
    razorpayInstance = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });
    razorpayKeyHash = credHash;
  }
  return razorpayInstance;
}

// ─── Create a Razorpay order ───
export async function createRazorpayOrder(
  bookingId: string,
  amount: number,
  userId: string,
) {
  const settings = await getGatewaySettings();
  if (!settings.razorpay.enabled) {
    throw new BadRequestError("Razorpay payment gateway is disabled.");
  }
  const razorpay = await getRazorpay();
  if (!razorpay) {
    throw new BadRequestError("Payment gateway not configured.");
  }

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new NotFoundError("Booking not found.");
  if (booking.userId !== userId) {
    throw new UnauthorizedError("You can only pay for your own bookings.");
  }
  if (booking.paymentStatus === "paid") {
    throw new BadRequestError("This booking has already been paid.");
  }
  if (["cancelled", "expired", "rejected"].includes(booking.status)) {
    throw new BadRequestError(`Cannot pay for a booking that is ${booking.status}.`);
  }

  // Create Razorpay order (amount in paise)
  let order: any;
  try {
    order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: "INR",
      receipt: booking.bookingRef,
      notes: {
        bookingId,
        userId,
        itemName: booking.itemName,
      },
    });
  } catch (rzpErr: any) {
    // Razorpay SDK throws objects with { statusCode, error: { description, reason, ... } }
    const statusCode = rzpErr?.statusCode || rzpErr?.status || 502;
    const description =
      rzpErr?.error?.description ||
      rzpErr?.error?.reason ||
      rzpErr?.message ||
      "Unknown Razorpay error";
    logger.error(`Razorpay order creation failed [${statusCode}]: ${description}`, {
      bookingRef: booking.bookingRef,
      rawError: JSON.stringify(rzpErr?.error || rzpErr),
    });
    throw new BadRequestError(`Payment gateway error: ${description}`);
  }

  // Create payment record
  const payment = await prisma.payment.create({
    data: {
      bookingId,
      userId,
      amount,
      currency: "INR",
      gateway: "razorpay",
      gatewayOrderId: order.id,
      status: "created",
      description: `Payment for ${booking.itemName} (${booking.bookingRef})`,
    },
  });

  // Update booking with payment info
  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      paymentId: payment.id,
      paymentGateway: "razorpay",
      gatewayOrderId: order.id,
    },
  });

  logger.info(`Razorpay order created: ${order.id} for booking ${booking.bookingRef}`);

  // Return the active key ID (live or test) for frontend SDK
  const activeKeyId = settings.razorpay.liveMode
    ? settings.razorpay.keyId
    : (settings.razorpay.testKeyId || settings.razorpay.keyId);

  return {
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    keyId: activeKeyId,
    bookingId,
    paymentId: payment.id,
  };
}

// ─── Verify Razorpay payment ───
export async function verifyRazorpayPayment(
  bookingId: string,
  razorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string,
  userId: string,
) {
  const settings = await getGatewaySettings();
  const razorpay = await getRazorpay();
  if (!razorpay) {
    throw new BadRequestError("Payment gateway not configured.");
  }

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new NotFoundError("Booking not found.");
  if (booking.userId !== userId) {
    throw new UnauthorizedError("You can only verify payments for your own bookings.");
  }

  // Idempotency: If booking is already paid, return early to prevent duplicate processing
  if (booking.paymentStatus === "paid") {
    logger.info(`Booking ${booking.bookingRef} is already marked as paid. Skipping verifyRazorpayPayment.`);
    return booking;
  }

  // Use the active key secret (live or test) for signature verification
  const activeKeySecret = settings.razorpay.liveMode
    ? settings.razorpay.keySecret
    : (settings.razorpay.testKeySecret || settings.razorpay.keySecret);

  // Verify signature
  const expectedSignature = crypto
    .createHmac("sha256", activeKeySecret)
    .update(razorpayOrderId + "|" + razorpayPaymentId)
    .digest("hex");

  if (expectedSignature !== razorpaySignature) {
    // Update payment as failed
    await prisma.payment.updateMany({
      where: { bookingId, gatewayOrderId: razorpayOrderId },
      data: { status: "failed", failureReason: "Invalid signature" },
    });

    // Expire the pending booking so its dates are released for other guests
    // (production-level: failed payment = inventory hold released, like Airbnb/Amazon)
    if (booking.status === "pending") {
      await prisma.booking.update({
        where: { id: bookingId },
        data: {
          status: "expired",
          paymentStatus: "failed",
          cancellationReason: "Razorpay payment verification failed (invalid signature)",
          cancelledAt: new Date(),
        },
      }).catch(() => { /* best-effort */ });

      await prisma.commission.updateMany({
        where: { bookingId },
        data: { status: "reversed" },
      }).catch(() => { /* commission may not exist yet */ });

      logger.info(`Booking ${booking.bookingRef} expired due to Razorpay payment failure (invalid signature).`);
    }

    throw new BadRequestError("Payment verification failed. Invalid signature.");
  }

  // Fetch payment details from Razorpay
  const razorpayPayment = await razorpay.payments.fetch(razorpayPaymentId);

  // Update payment record
  const payment = await prisma.payment.updateMany({
    where: { bookingId, gatewayOrderId: razorpayOrderId },
    data: {
      status: "captured",
      gatewayPaymentId: razorpayPaymentId,
      gatewaySignature: razorpaySignature,
      method: razorpayPayment.method,
      paidAt: new Date(),
    },
  });

  // Update booking
  const updatedBooking = await prisma.booking.update({
    where: { id: bookingId },
    data: {
      paymentStatus: "paid",
      gatewayPaymentId: razorpayPaymentId,
      paidAt: new Date(),
      status: booking.bookingType === "instant" ? "confirmed" : booking.status,
      confirmedAt: booking.bookingType === "instant" ? new Date() : booking.confirmedAt,
    },
  });

  // Send confirmation notifications
  if (booking.guestEmail) {
    await sendTemplatedEmail(booking.guestEmail, "bookingConfirmation", {
      guestName: booking.guestName,
      itemName: booking.itemName,
      bookingRef: booking.bookingRef,
      checkIn: booking.checkIn?.toLocaleDateString(),
      checkOut: booking.checkOut?.toLocaleDateString(),
      guests: booking.guests,
      totalAmount: booking.totalAmount,
    });
  }

  // Notify host
  await sendPushToUser(booking.hostId, {
    title: "Payment Received!",
    body: `Payment of ₹${booking.totalAmount} received for ${booking.itemName}`,
    data: { bookingId, type: "payment" },
  });

  await createAuditLog({
    actorId: userId,
    action: "PAYMENT_VERIFIED",
    category: "payment",
    resource: "Booking",
    resourceId: bookingId,
    details: {
      bookingRef: booking.bookingRef,
      amount: booking.totalAmount,
      gateway: "razorpay",
      paymentId: razorpayPaymentId,
    },
  });

  logger.info(`Payment verified for booking ${booking.bookingRef}`);

  return updatedBooking;
}

// ─── Handle Razorpay webhook ───
export async function handleRazorpayWebhook(body: any, signature: string): Promise<void> {
  const settings = await getGatewaySettings();
  const webhookSecret = settings.razorpay.webhookSecret;
  if (!webhookSecret) {
    logger.warn("Razorpay webhook secret not configured.");
    return;
  }

  // Verify webhook signature
  const expectedSignature = crypto
    .createHmac("sha256", webhookSecret)
    .update(JSON.stringify(body))
    .digest("hex");

  if (expectedSignature !== signature) {
    logger.warn("Razorpay webhook signature verification failed.");
    return;
  }

  const event = body.event;
  logger.info(`Razorpay webhook received: ${event}`);

  const paymentEntity = body.payload?.payment?.entity;

  switch (event) {
    case "payment.captured": {
      const bookingId = paymentEntity?.notes?.bookingId;
      if (!bookingId) return;

      const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
      if (!booking) return;

      // Idempotency: If booking is already marked as paid, skip processing
      if (booking.paymentStatus === "paid") {
        logger.info(`Booking ${booking.bookingRef} is already marked as paid. Skipping webhook duplicate.`);
        return;
      }

      await prisma.payment.updateMany({
        where: { bookingId, gatewayPaymentId: paymentEntity.id },
        data: { status: "captured", paidAt: new Date() },
      });

      const finalStatus = booking.bookingType === "instant" ? "confirmed" : booking.status;
      await prisma.booking.update({
        where: { id: bookingId },
        data: {
          paymentStatus: "paid",
          paidAt: new Date(),
          status: finalStatus,
          confirmedAt: booking.bookingType === "instant" ? new Date() : booking.confirmedAt,
        },
      });

      await createAuditLog({
        action: "PAYMENT_CAPTURED",
        category: "webhook",
        resource: "Booking",
        resourceId: bookingId,
        details: { bookingRef: booking.bookingRef, gateway: "razorpay", status: "success", amount: paymentEntity.amount / 100 },
      });

      // Emit real-time status update to Guest and Host
      emitToUser(booking.userId, "booking:status_update", {
        bookingId,
        status: finalStatus,
        paymentStatus: "paid",
        message: "Payment captured successfully!"
      });
      emitToUser(booking.hostId, "booking:status_update", {
        bookingId,
        status: finalStatus,
        paymentStatus: "paid",
        message: `New paid booking: ${booking.bookingRef}`
      });

      break;
    }
    case "payment.failed": {
      const bookingId = paymentEntity?.notes?.bookingId;
      if (!bookingId) return;

      const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
      if (!booking) return;

      // Edge case: If payment succeeded earlier (or verified via redirect) and is already paid,
      // do not overwrite status with failure.
      if (booking.paymentStatus === "paid") {
        logger.info(`Ignoring late payment.failed webhook for already paid booking ${booking.bookingRef}`);
        return;
      }

      await prisma.payment.updateMany({
        where: { bookingId },
        data: { status: "failed", failureReason: paymentEntity?.error_description },
      });

      await createAuditLog({
        action: "PAYMENT_FAILED",
        category: "webhook",
        resource: "Booking",
        resourceId: bookingId,
        details: { gateway: "razorpay", status: "failed", error: paymentEntity?.error_description },
      });

      // Emit real-time failure notification to Guest
      emitToUser(booking.userId, "booking:status_update", {
        bookingId,
        status: booking.status,
        paymentStatus: "failed",
        message: `Payment failed: ${paymentEntity?.error_description || "Declined"}`
      });

      break;
    }
    case "refund.processed": {
      const bookingId = paymentEntity?.notes?.bookingId;
      if (!bookingId) return;

      const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
      if (!booking) return;

      // Check if already refunded to ensure idempotency
      const existingPayments = await prisma.payment.findMany({ where: { bookingId } });
      const isAlreadyRefunded = existingPayments.some(p => p.status === "refunded");
      if (isAlreadyRefunded) {
        logger.info(`Refund for booking ${booking.bookingRef} already processed. Skipping webhook duplicate.`);
        return;
      }

      await prisma.payment.updateMany({
        where: { bookingId },
        data: { status: "refunded", refundAmount: paymentEntity.amount / 100, refundedAt: new Date() },
      });

      await createAuditLog({
        action: "REFUND_PROCESSED",
        category: "webhook",
        resource: "Booking",
        resourceId: bookingId,
        details: { bookingRef: booking.bookingRef, status: "refunded", refundAmount: paymentEntity.amount / 100 },
      });

      // Emit real-time status update to Guest and Host
      emitToUser(booking.userId, "booking:status_update", {
        bookingId,
        status: booking.status,
        paymentStatus: "refunded",
        message: "Your refund has been processed."
      });
      emitToUser(booking.hostId, "booking:status_update", {
        bookingId,
        status: booking.status,
        paymentStatus: "refunded",
        message: "Refund processed successfully."
      });

      break;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// ─── PayU Payment Gateway ────────────────────────────────────
// ─────────────────────────────────────────────────────────────

/**
 * Generate the SHA-512 hash for PayU request.
 * Sequence: sha512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||SALT)
 */
function generatePayuHash(params: {
  key: string;
  txnid: string;
  amount: string;
  productinfo: string;
  firstname: string;
  email: string;
  salt: string;
  udf1?: string;
  udf2?: string;
  udf3?: string;
  udf4?: string;
  udf5?: string;
}): string {
  const { key, txnid, amount, productinfo, firstname, email, salt } = params;
  const udf1 = params.udf1 || "";
  const udf2 = params.udf2 || "";
  const udf3 = params.udf3 || "";
  const udf4 = params.udf4 || "";
  const udf5 = params.udf5 || "";

  const hashString = `${key}|${txnid}|${amount}|${productinfo}|${firstname}|${email}|${udf1}|${udf2}|${udf3}|${udf4}|${udf5}||||||${salt}`;
  return crypto.createHash("sha512").update(hashString).digest("hex");
}

/**
 * Generate the reverse hash for verifying PayU response.
 * Sequence: sha512(SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)
 */
function generatePayuReverseHash(params: {
  key: string;
  txnid: string;
  amount: string;
  productinfo: string;
  firstname: string;
  email: string;
  salt: string;
  status: string;
  udf1?: string;
  udf2?: string;
  udf3?: string;
  udf4?: string;
  udf5?: string;
}): string {
  const { key, txnid, amount, productinfo, firstname, email, salt, status } = params;
  const udf1 = params.udf1 || "";
  const udf2 = params.udf2 || "";
  const udf3 = params.udf3 || "";
  const udf4 = params.udf4 || "";
  const udf5 = params.udf5 || "";

  const hashString = `${salt}|${status}||||||${udf5}|${udf4}|${udf3}|${udf2}|${udf1}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
  return crypto.createHash("sha512").update(hashString).digest("hex");
}

/**
 * Generate hash for PayU refund API.
 * Sequence: sha512(key|command|var1|salt)
 */
function generatePayuRefundHash(key: string, salt: string, var1: string): string {
  const hashString = `${key}|cancel_refund_txn|${var1}|${salt}`;
  return crypto.createHash("sha512").update(hashString).digest("hex");
}

// ─── Create a PayU payment (initiate transaction) ───
export async function createPayuOrder(
  bookingId: string,
  amount: number,
  userId: string,
) {
  const settings = await getGatewaySettings();
  if (!settings.payu.enabled) {
    throw new BadRequestError("PayU payment gateway is disabled.");
  }

  // Use live or test credentials based on mode
  const payuKey = settings.payu.liveMode
    ? settings.payu.key
    : (settings.payu.testKey || settings.payu.key);
  const payuSalt = settings.payu.liveMode
    ? settings.payu.salt
    : (settings.payu.testSalt || settings.payu.salt);
  const payuBaseUrl = settings.payu.baseUrl;

  if (!payuKey || !payuSalt) {
    throw new BadRequestError("PayU payment gateway not configured.");
  }

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new NotFoundError("Booking not found.");
  if (booking.userId !== userId) {
    throw new UnauthorizedError("You can only pay for your own bookings.");
  }
  if (booking.paymentStatus === "paid") {
    throw new BadRequestError("This booking has already been paid.");
  }

  // Fetch user details for PayU
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError("User not found.");

  // Generate a unique transaction ID
  const txnid = `TRIPTAY_${booking.bookingRef}_${Date.now()}`;
  const amountStr = amount.toFixed(2);
  const productinfo = `Booking ${booking.bookingRef} - ${booking.itemName}`.substring(0, 50);
  const firstname = (user.name || "Guest").split(" ")[0]?.substring(0, 50) || "Guest";
  const email = (user.email || booking.guestEmail || "guest@triptay.com").substring(0, 50);
  const phone = (user.phone || booking.guestPhone || "").substring(0, 50);

  // Generate the hash
  const hash = generatePayuHash({
    key: payuKey,
    txnid,
    amount: amountStr,
    productinfo,
    firstname,
    email,
    salt: payuSalt,
  });

  // Create payment record
  const payment = await prisma.payment.create({
    data: {
      bookingId,
      userId,
      amount,
      currency: "INR",
      gateway: "payu",
      gatewayOrderId: txnid,
      status: "created",
      description: `Payment for ${booking.itemName} (${booking.bookingRef})`,
      metadata: {
        txnid,
        productinfo,
        firstname,
        email,
        phone,
        amount: amountStr,
      },
    },
  });

  // Update booking with payment info
  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      paymentId: payment.id,
      paymentGateway: "payu",
      gatewayOrderId: txnid,
    },
  });

  logger.info(`PayU payment initiated: ${txnid} for booking ${booking.bookingRef}`);

  // Build the PayU payment form data
  const payuData = {
    key: payuKey,
    txnid,
    amount: amountStr,
    productinfo,
    firstname,
    email,
    phone,
    surl: settings.payu.successUrl,
    furl: settings.payu.failureUrl,
    hash,
    // udf fields for extra metadata
    udf1: bookingId,
    udf2: booking.bookingRef,
    udf3: userId,
    udf4: booking.itemType,
    udf5: booking.itemName.substring(0, 50),
  };

  return {
    txnid,
    amount: amountStr,
    key: payuKey,
    hash,
    productinfo,
    firstname,
    email,
    phone,
    surl: settings.payu.successUrl,
    furl: settings.payu.failureUrl,
    actionUrl: `${payuBaseUrl}/_payment`,
    payuData,
    bookingId,
    paymentId: payment.id,
  };
}

// ─── Verify PayU payment (server-side) ───
export async function verifyPayuPayment(
  bookingId: string,
  payuResponse: Record<string, any>,
  userId: string,
) {
  const settings = await getGatewaySettings();
  if (!settings.payu.enabled) {
    throw new BadRequestError("PayU payment gateway is disabled.");
  }

  // Use live or test credentials based on mode
  const payuKey = settings.payu.liveMode
    ? settings.payu.key
    : (settings.payu.testKey || settings.payu.key);
  const payuSalt = settings.payu.liveMode
    ? settings.payu.salt
    : (settings.payu.testSalt || settings.payu.salt);

  if (!payuKey || !payuSalt) {
    throw new BadRequestError("PayU payment gateway not configured.");
  }

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new NotFoundError("Booking not found.");
  if (booking.userId !== userId) {
    throw new UnauthorizedError("You can only verify payments for your own bookings.");
  }

  const {
    txnid,
    mihpayid,
    hash,
    status,
    mode,
    amount,
    error,
    error_Message,
    bank_ref_num,
    bankcode,
    cardnum,
    udf1,
    udf2,
    udf3,
    udf4,
    udf5,
  } = payuResponse;

  // Verify the hash (reverse hash)
  const expectedHash = generatePayuReverseHash({
    key: payuKey,
    txnid,
    amount: amount || booking.totalAmount.toFixed(2),
    productinfo: `Booking ${booking.bookingRef} - ${booking.itemName}`.substring(0, 50),
    firstname: (payuResponse.firstname || "Guest").substring(0, 50),
    email: (payuResponse.email || "guest@triptay.com").substring(0, 50),
    salt: payuSalt,
    status,
    udf1,
    udf2,
    udf3,
    udf4,
    udf5,
  });

  if (expectedHash !== hash) {
    // Update payment as failed
    await prisma.payment.updateMany({
      where: { bookingId, gatewayOrderId: txnid },
      data: { status: "failed", failureReason: "Invalid hash signature" },
    });

    // Expire the pending booking so its dates are released for other guests
    if (booking.status === "pending") {
      await prisma.booking.update({
        where: { id: bookingId },
        data: {
          status: "expired",
          paymentStatus: "failed",
          cancellationReason: "PayU payment verification failed (invalid hash)",
          cancelledAt: new Date(),
        },
      }).catch(() => { /* best-effort */ });

      await prisma.commission.updateMany({
        where: { bookingId },
        data: { status: "reversed" },
      }).catch(() => { /* commission may not exist yet */ });

      logger.info(`Booking ${booking.bookingRef} expired due to PayU hash mismatch.`);
    }

    await createAuditLog({
      actorId: userId,
      action: "PAYMENT_VERIFICATION_FAILED",
      category: "payment",
      resource: "Booking",
      resourceId: bookingId,
      details: { gateway: "payu", txnid, reason: "hash_mismatch" },
    });

    throw new BadRequestError("Payment verification failed. Invalid hash signature.");
  }

  // Check payment status
  if (status !== "success") {
    await prisma.payment.updateMany({
      where: { bookingId, gatewayOrderId: txnid },
      data: {
        status: "failed",
        failureReason: error_Message || error || "Payment failed at gateway",
        gatewayPaymentId: mihpayid,
        method: mode,
        metadata: payuResponse,
      },
    });

    // Expire the pending booking so its dates are released for other guests
    if (booking.status === "pending") {
      await prisma.booking.update({
        where: { id: bookingId },
        data: {
          status: "expired",
          paymentStatus: "failed",
          cancellationReason: `PayU payment failed: ${error_Message || error || "gateway declined"}`,
          cancelledAt: new Date(),
        },
      }).catch(() => { /* best-effort */ });

      await prisma.commission.updateMany({
        where: { bookingId },
        data: { status: "reversed" },
      }).catch(() => { /* commission may not exist yet */ });

      logger.info(`Booking ${booking.bookingRef} expired due to PayU payment failure (status: ${status}).`);
    }

    await createAuditLog({
      actorId: userId,
      action: "PAYMENT_FAILED",
      category: "payment",
      resource: "Booking",
      resourceId: bookingId,
      details: {
        gateway: "payu",
        txnid,
        mihpayid,
        error: error_Message || error,
      },
    });

    throw new BadRequestError(error_Message || error || "Payment failed at PayU gateway.");
  }

  // Verify amount matches
  const expectedAmount = booking.totalAmount.toFixed(2);
  if (amount && parseFloat(amount) !== parseFloat(expectedAmount)) {
    await prisma.payment.updateMany({
      where: { bookingId, gatewayOrderId: txnid },
      data: {
        status: "failed",
        failureReason: `Amount mismatch: expected ${expectedAmount}, got ${amount}`,
        gatewayPaymentId: mihpayid,
      },
    });

    // Expire the pending booking so its dates are released for other guests
    if (booking.status === "pending") {
      await prisma.booking.update({
        where: { id: bookingId },
        data: {
          status: "expired",
          paymentStatus: "failed",
          cancellationReason: `PayU amount mismatch: expected ${expectedAmount}, got ${amount}`,
          cancelledAt: new Date(),
        },
      }).catch(() => { /* best-effort */ });

      await prisma.commission.updateMany({
        where: { bookingId },
        data: { status: "reversed" },
      }).catch(() => { /* commission may not exist yet */ });

      logger.info(`Booking ${booking.bookingRef} expired due to PayU amount mismatch.`);
    }

    await createAuditLog({
      actorId: userId,
      action: "PAYMENT_AMOUNT_MISMATCH",
      category: "payment",
      resource: "Booking",
      resourceId: bookingId,
      details: { gateway: "payu", expected: expectedAmount, received: amount },
    });

    throw new BadRequestError("Payment amount mismatch. Verification failed.");
  }

  // Idempotency check: if already captured, return existing booking
  if (booking.paymentStatus === "paid") {
    logger.info(`PayU payment already verified for booking ${booking.bookingRef}`);
    return booking;
  }

  // Update payment record
  await prisma.payment.updateMany({
    where: { bookingId, gatewayOrderId: txnid },
    data: {
      status: "captured",
      gatewayPaymentId: mihpayid,
      gatewaySignature: hash,
      method: mode,
      paidAt: new Date(),
      metadata: payuResponse,
    },
  });

  // Update booking
  const updatedBooking = await prisma.booking.update({
    where: { id: bookingId },
    data: {
      paymentStatus: "paid",
      gatewayPaymentId: mihpayid,
      paidAt: new Date(),
      status: booking.bookingType === "instant" ? "confirmed" : booking.status,
      confirmedAt: booking.bookingType === "instant" ? new Date() : booking.confirmedAt,
    },
  });

  // Send confirmation notifications
  if (booking.guestEmail) {
    await sendTemplatedEmail(booking.guestEmail, "bookingConfirmation", {
      guestName: booking.guestName,
      itemName: booking.itemName,
      bookingRef: booking.bookingRef,
      checkIn: booking.checkIn?.toLocaleDateString(),
      checkOut: booking.checkOut?.toLocaleDateString(),
      guests: booking.guests,
      totalAmount: booking.totalAmount,
    });
  }

  // Notify host
  await sendPushToUser(booking.hostId, {
    title: "Payment Received!",
    body: `Payment of ₹${booking.totalAmount} received for ${booking.itemName}`,
    data: { bookingId, type: "payment" },
  });

  await createAuditLog({
    actorId: userId,
    action: "PAYMENT_VERIFIED",
    category: "payment",
    resource: "Booking",
    resourceId: bookingId,
    details: {
      bookingRef: booking.bookingRef,
      amount: booking.totalAmount,
      gateway: "payu",
      mihpayid,
      txnid,
      method: mode,
    },
  });

  logger.info(`PayU payment verified for booking ${booking.bookingRef}: mihpayid=${mihpayid}`);

  return updatedBooking;
}

// ─── Handle PayU webhook (server-to-server notification) ───
export async function handlePayuWebhook(body: any): Promise<void> {
  logger.info(`PayU webhook received: txnid=${body?.txnid}, status=${body?.status}`);

  const settings = await getGatewaySettings();
  if (!settings.payu.enabled) {
    logger.warn("PayU is disabled. Skipping webhook.");
    return;
  }

  // Use live or test credentials based on mode
  const payuKey = settings.payu.liveMode
    ? settings.payu.key
    : (settings.payu.testKey || settings.payu.key);
  const payuSalt = settings.payu.liveMode
    ? settings.payu.salt
    : (settings.payu.testSalt || settings.payu.salt);

  if (!payuKey || !payuSalt) {
    logger.warn("PayU credentials not configured for webhook verification.");
    return;
  }

  const {
    txnid,
    mihpayid,
    hash,
    status,
    amount,
    mode,
    udf1: bookingId,
    udf3: userId,
    error_Message,
    error,
  } = body;

  if (!bookingId || !txnid) {
    logger.warn("PayU webhook missing bookingId (udf1) or txnid.");
    return;
  }

  // Verify the hash
  const expectedHash = generatePayuReverseHash({
    key: payuKey,
    txnid,
    amount: amount || "",
    productinfo: body.productinfo || "",
    firstname: body.firstname || "",
    email: body.email || "",
    salt: payuSalt,
    status,
    udf1: body.udf1,
    udf2: body.udf2,
    udf3: body.udf3,
    udf4: body.udf4,
    udf5: body.udf5,
  });

  if (expectedHash !== hash) {
    logger.warn("PayU webhook hash verification failed.");
    return;
  }

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) {
    logger.warn(`PayU webhook: booking ${bookingId} not found.`);
    return;
  }

  // Idempotency: skip if already paid
  if (booking.paymentStatus === "paid" && status === "success") {
    logger.info(`PayU webhook: booking ${bookingId} already paid. Skipping.`);
    return;
  }

  if (status === "success") {
    // Update payment
    await prisma.payment.updateMany({
      where: { bookingId, gatewayOrderId: txnid },
      data: {
        status: "captured",
        gatewayPaymentId: mihpayid,
        gatewaySignature: hash,
        method: mode,
        paidAt: new Date(),
        metadata: body,
      },
    });

    const finalStatus = booking.bookingType === "instant" ? "confirmed" : booking.status;
    // Update booking
    await prisma.booking.update({
      where: { id: bookingId },
      data: {
        paymentStatus: "paid",
        gatewayPaymentId: mihpayid,
        paidAt: new Date(),
        status: finalStatus,
        confirmedAt: booking.bookingType === "instant" ? new Date() : booking.confirmedAt,
      },
    });

    await createAuditLog({
      actorId: userId,
      action: "PAYMENT_CAPTURED",
      category: "webhook",
      resource: "Booking",
      resourceId: bookingId,
      details: { bookingRef: booking.bookingRef, gateway: "payu", status: "success", amount: booking.totalAmount, mihpayid, txnid },
    });

    logger.info(`PayU webhook: payment captured for booking ${booking.bookingRef}`);

    // Emit real-time status update to Guest and Host
    emitToUser(booking.userId, "booking:status_update", {
      bookingId,
      status: finalStatus,
      paymentStatus: "paid",
      message: "Payment captured successfully!"
    });
    emitToUser(booking.hostId, "booking:status_update", {
      bookingId,
      status: finalStatus,
      paymentStatus: "paid",
      message: `New paid booking: ${booking.bookingRef}`
    });
  } else {
    // Payment failed
    await prisma.payment.updateMany({
      where: { bookingId, gatewayOrderId: txnid },
      data: {
        status: "failed",
        failureReason: error_Message || error || "Payment failed",
        gatewayPaymentId: mihpayid,
        method: mode,
        metadata: body,
      },
    });

    await createAuditLog({
      action: "PAYMENT_FAILED",
      category: "webhook",
      resource: "Booking",
      resourceId: bookingId,
      details: { gateway: "payu", status: "failed", txnid, error: error_Message || error },
    });

    logger.info(`PayU webhook: payment failed for booking ${booking.bookingRef}`);

    // Emit real-time failure notification to Guest
    emitToUser(booking.userId, "booking:status_update", {
      bookingId,
      status: booking.status,
      paymentStatus: "failed",
      message: `Payment failed: ${error_Message || error || "Declined"}`
    });
  }
}

// ─── Process PayU refund ───
async function processPayuRefund(
  mihpayid: string,
  amount: number,
): Promise<string | null> {
  const settings = await getGatewaySettings();
  // Use live or test credentials based on mode
  const payuKey = settings.payu.liveMode
    ? settings.payu.key
    : (settings.payu.testKey || settings.payu.key);
  const payuSalt = settings.payu.liveMode
    ? settings.payu.salt
    : (settings.payu.testSalt || settings.payu.salt);

  if (!payuKey || !payuSalt) {
    logger.warn("PayU credentials not configured for refund.");
    return null;
  }

  const var1 = mihpayid;
  const hash = generatePayuRefundHash(payuKey, payuSalt, var1);

  // Call PayU refund API
  const refundUrl = `${settings.payu.baseUrl}/merchant/postservice?form=2`;
  const formData = new URLSearchParams();
  formData.append("key", payuKey);
  formData.append("command", "cancel_refund_txn");
  formData.append("var1", var1);
  formData.append("var2", amount.toFixed(2));
  formData.append("var3", "Cancellation refund");
  formData.append("hash", hash);

  const response = await fetch(refundUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData.toString(),
  });

  const result = await response.json() as any;

  if (result.status === 0 || result.status === "0") {
    // Refund request accepted
    const refundId = result.request_id || result.mihpayid || `refund_${Date.now()}`;
    logger.info(`PayU refund initiated: ${refundId} for mihpayid ${mihpayid}`);
    return refundId;
  } else {
    logger.error(`PayU refund failed: ${JSON.stringify(result)}`);
    throw new BadRequestError(
      result.msg || result.error_msg || "PayU refund request failed.",
    );
  }
}

// ─── Process refund ───
export async function processRefund(
  bookingId: string,
  amount: number,
  reason?: string,
  actorId?: string,
) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new NotFoundError("Booking not found.");
  if (booking.paymentStatus !== "paid" && booking.paymentStatus !== "partially_paid") {
    throw new BadRequestError("Can only refund paid or partially paid bookings.");
  }

  // Calculate total paid amount and current refund status
  const payments = await prisma.payment.findMany({ where: { bookingId } });
  const totalPaid = payments
    .filter(p => p.status === "captured" || p.status === "refunded")
    .reduce((sum, p) => sum + p.amount, 0);

  const totalRefunded = booking.refundAmount || 0;
  const paidLimit = totalPaid || booking.totalAmount;

  if (totalRefunded >= paidLimit) {
    throw new BadRequestError("Booking has already been fully refunded.");
  }

  if (amount <= 0) {
    throw new BadRequestError("Refund amount must be greater than zero.");
  }

  if (amount > (paidLimit - totalRefunded)) {
    throw new BadRequestError(`Cannot refund ₹${amount}. Maximum refundable amount is ₹${paidLimit - totalRefunded}.`);
  }

  const newTotalRefunded = totalRefunded + amount;
  let refundId: string | null = null;

  if (booking.paymentGateway === "razorpay" && booking.gatewayPaymentId) {
    const razorpay = await getRazorpay();
    if (razorpay) {
      const refund = await razorpay.payments.refund(booking.gatewayPaymentId, {
        amount: Math.round(amount * 100),
        notes: { bookingId, reason: reason || "Cancellation refund" },
      });
      refundId = refund.id;
    }
  } else if (booking.paymentGateway === "payu" && booking.gatewayPaymentId) {
    refundId = await processPayuRefund(booking.gatewayPaymentId, amount);
  }

  // Update payment record(s) linked to this booking payment ID
  await prisma.payment.updateMany({
    where: { bookingId, gatewayPaymentId: booking.gatewayPaymentId || undefined },
    data: {
      status: "refunded",
      refundAmount: newTotalRefunded,
      refundId,
      refundedAt: new Date(),
    },
  });

  // Update booking with cumulative refund details
  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      refundAmount: newTotalRefunded,
      paymentStatus: newTotalRefunded >= paidLimit ? "refunded" : booking.paymentStatus,
    },
  });

  await createAuditLog({
    actorId,
    action: "REFUND_PROCESSED",
    category: "payment",
    resource: "Booking",
    resourceId: bookingId,
    details: { bookingRef: booking.bookingRef, amount, refundId, totalRefunded: newTotalRefunded },
  });

  logger.info(`Refund processed for booking ${booking.bookingRef}: ₹${amount}. Total refunded: ₹${newTotalRefunded}`);

  return { refundId, amount, totalRefunded: newTotalRefunded };
}

// ─── Get payment details ───
export async function getPayment(bookingId: string, userId: string) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new NotFoundError("Booking not found.");

  if (booking.userId !== userId && booking.hostId !== userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user?.role !== "Admin") {
      throw new UnauthorizedError("You don't have access to this payment.");
    }
  }

  const payments = await prisma.payment.findMany({
    where: { bookingId },
    orderBy: { createdAt: "desc" },
  });

  return payments;
}

export default {
  getRazorpay,
  createRazorpayOrder,
  verifyRazorpayPayment,
  handleRazorpayWebhook,
  createPayuOrder,
  verifyPayuPayment,
  handlePayuWebhook,
  processRefund,
  getPayment,
};
