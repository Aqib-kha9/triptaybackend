import type { Request, Response, NextFunction } from "express";
import * as paymentService from "../services/payment.service.js";
import { prisma } from "../config/db.js";
import { UnauthorizedError } from "../core/errors.js";
import { logger } from "../core/logger.js";

// ──────────────────────── Controllers ────────────────────────

// @desc    Create a Razorpay order
// @route   POST /api/payments/razorpay/order
// @access  Private
export const createRazorpayOrder = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { bookingId } = req.body;

    // Fetch booking to get the amount
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) {
      throw new UnauthorizedError("Booking not found.");
    }
    if (booking.userId !== req.user.id) {
      throw new UnauthorizedError("You can only pay for your own bookings.");
    }

    const result = await paymentService.createRazorpayOrder(bookingId, booking.totalAmount, req.user.id);

    res.status(200).json({
      status: "success",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Verify Razorpay payment
// @route   POST /api/payments/razorpay/verify
// @access  Private
export const verifyRazorpayPayment = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { bookingId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

    const booking = await paymentService.verifyRazorpayPayment(
      bookingId,
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      req.user.id,
    );

    res.status(200).json({
      status: "success",
      message: "Payment verified successfully.",
      data: {
        booking,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create a PayU payment (initiate transaction)
// @route   POST /api/payments/payu/order
// @access  Private
export const createPayuOrder = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { bookingId } = req.body;

    // Fetch booking to get the amount
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) {
      throw new UnauthorizedError("Booking not found.");
    }
    if (booking.userId !== req.user.id) {
      throw new UnauthorizedError("You can only pay for your own bookings.");
    }

    const result = await paymentService.createPayuOrder(bookingId, booking.totalAmount, req.user.id);

    res.status(200).json({
      status: "success",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Verify PayU payment (called after PayU redirects back)
// @route   POST /api/payments/payu/verify
// @access  Private
export const verifyPayuPayment = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { bookingId, ...payuResponse } = req.body;

    const booking = await paymentService.verifyPayuPayment(
      bookingId,
      payuResponse,
      req.user.id,
    );

    res.status(200).json({
      status: "success",
      message: "Payment verified successfully.",
      data: {
        booking,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get payment details for a booking
// @route   GET /api/payments/:bookingId
// @access  Private
export const getPayment = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const payments = await paymentService.getPayment(req.params.bookingId, req.user.id);

    res.status(200).json({
      status: "success",
      results: payments.length,
      data: {
        payments,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Process a refund (admin)
// @route   POST /api/payments/refund
// @access  Private (Admin)
export const processRefund = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { bookingId, amount, reason } = req.body;

    const result = await paymentService.processRefund(bookingId, amount, reason, req.admin?.id);

    res.status(200).json({
      status: "success",
      message: "Refund processed successfully.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Razorpay webhook handler
// @route   POST /api/payments/webhooks/razorpay
// @access  Public (verified by signature)
export const razorpayWebhook = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const signature = req.headers["x-razorpay-signature"] as string;
    await paymentService.handleRazorpayWebhook(req.body, signature);
    res.status(200).json({ received: true });
  } catch (error) {
    next(error);
  }
};

// @desc    PayU webhook handler (server-to-server notification)
// @route   POST /api/payments/webhooks/payu
// @access  Public (verified by hash)
export const payuWebhook = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    logger.info("PayU webhook received", {
      txnid: req.body?.txnid,
      mihpayid: req.body?.mihpayid,
      status: req.body?.status,
    });

    // PayU sends form-urlencoded data; express.urlencoded() parses it into req.body
    // We must respond with HTTP 200 immediately to acknowledge receipt.
    // The hash verification & processing happens inside the service.
    await paymentService.handlePayuWebhook(req.body);

    // Always acknowledge with 200 to prevent PayU from retrying
    res.status(200).json({ received: true });
  } catch (error) {
    // Even on error, respond 200 to stop retries — log the error for investigation
    logger.error("PayU webhook processing failed", { error: (error as Error).message });
    res.status(200).json({ received: true, error: "Processing failed" });
  }
};
