import type { Request, Response, NextFunction } from "express";
import * as bookingService from "../services/booking.service.js";

// ──────────────────────── Controllers ────────────────────────

// @desc    Create a new booking
// @route   POST /api/bookings
// @access  Private
export const createBooking = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const booking = await bookingService.createBooking(req.user.id, req.body);

    res.status(201).json({
      status: "success",
      data: {
        booking,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get booking pricing preview
// @route   POST /api/bookings/preview
// @access  Private
export const getBookingPreview = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const preview = await bookingService.getBookingPreview(req.body);

    res.status(200).json({
      status: "success",
      data: preview,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get current user's bookings (as guest or host)
// @route   GET /api/bookings
// @access  Private
export const getMyBookings = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { status, page, limit, role } = req.query;
    const result = await bookingService.getMyBookings(req.user.id, {
      status: status as string | undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      role: role as "guest" | "host" | undefined,
    });

    res.status(200).json({
      status: "success",
      results: result.bookings.length,
      pagination: result.pagination,
      data: {
        bookings: result.bookings,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get a single booking by ID
// @route   GET /api/bookings/:id
// @access  Private
export const getBooking = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const booking = await bookingService.getBooking(req.params.id, req.user.id);

    res.status(200).json({
      status: "success",
      data: {
        booking,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get cancellation preview (refund amount, policy, penalty)
// @route   GET /api/bookings/:id/cancel-preview
// @access  Private
export const getCancelPreview = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const preview = await bookingService.getCancelPreview(req.params.id, req.user.id);

    res.status(200).json({
      status: "success",
      data: preview,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Cancel a booking
// @route   POST /api/bookings/:id/cancel
// @access  Private
export const cancelBooking = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const booking = await bookingService.cancelBooking(req.params.id, req.user.id, req.body.reason);

    res.status(200).json({
      status: "success",
      message: "Booking cancelled successfully.",
      data: {
        booking,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Expire a pending booking (release dates on payment failure/abandonment)
// @route   POST /api/bookings/:id/expire
// @access  Private
export const expireBooking = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const booking = await bookingService.expireBooking(
      req.params.id,
      req.user.id,
      req.body?.reason,
    );

    res.status(200).json({
      status: "success",
      message: "Pending booking expired. Dates released.",
      data: {
        booking,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Confirm a booking (host action)
// @route   POST /api/bookings/:id/confirm
// @access  Private (Vendor / Dual Mode)
export const confirmBooking = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const booking = await bookingService.confirmBooking(req.params.id, req.user.id);

    res.status(200).json({
      status: "success",
      message: "Booking confirmed successfully.",
      data: {
        booking,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Reject a booking (host action)
// @route   POST /api/bookings/:id/reject
// @access  Private (Vendor / Dual Mode)
export const rejectBooking = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const booking = await bookingService.rejectBooking(req.params.id, req.user.id, req.body.reason);

    res.status(200).json({
      status: "success",
      message: "Booking rejected.",
      data: {
        booking,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Verify booking check-in OTP (host action)
// @route   POST /api/bookings/:id/verify-otp
// @access  Private (Vendor / Dual Mode)
export const verifyBookingOtp = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { otp } = req.body;
    if (!otp) {
      res.status(400).json({ status: "fail", message: "OTP is required." });
      return;
    }

    const booking = await bookingService.verifyCheckIn(req.params.id, req.user.id, otp);

    res.status(200).json({
      status: "success",
      message: "Check-in verified successfully. Booking completed.",
      data: {
        booking,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Complete a booking (admin or system)
// @route   POST /api/bookings/:id/complete
// @access  Private (Admin)
export const completeBooking = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const booking = await bookingService.completeBooking(req.params.id, req.admin?.id);

    res.status(200).json({
      status: "success",
      message: "Booking marked as completed.",
      data: {
        booking,
      },
    });
  } catch (error) {
    next(error);
  }
};
