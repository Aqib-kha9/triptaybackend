import type { Request, Response, NextFunction } from "express";
import * as disputeService from "../services/dispute.service.js";

// ──────────────────────── Controllers ────────────────────────

// @desc    Create a dispute (user raises against a booking)
// @route   POST /api/disputes
// @access  Private
export const createDispute = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { bookingId, reason, description, evidenceUrls } = req.body;
    const dispute = await disputeService.createDispute(req.user.id, {
      bookingId,
      reason,
      description,
      evidenceUrls,
    });

    res.status(201).json({
      status: "success",
      message: "Dispute raised successfully.",
      data: { dispute },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get my disputes (user)
// @route   GET /api/disputes/mine
// @access  Private
export const getMyDisputes = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, limit, status, priority, type } = req.query;
    const result = await disputeService.getMyDisputes(req.user.id, {
      page: page as string | undefined,
      limit: limit as string | undefined,
      status: status as string | undefined,
      priority: priority as string | undefined,
      type: type as string | undefined,
    });

    res.status(200).json({
      status: "success",
      results: result.disputes.length,
      pagination: result.pagination,
      data: { disputes: result.disputes },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    List all disputes (admin)
// @route   GET /api/admin/disputes
// @access  Private (Admin)
export const listAllDisputes = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, limit, status, priority, type } = req.query;
    const result = await disputeService.listAllDisputes({
      page: page as string | undefined,
      limit: limit as string | undefined,
      status: status as string | undefined,
      priority: priority as string | undefined,
      type: type as string | undefined,
    });

    res.status(200).json({
      status: "success",
      results: result.disputes.length,
      pagination: result.pagination,
      data: { disputes: result.disputes },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get dispute detail (admin)
// @route   GET /api/admin/disputes/:disputeId
// @access  Private (Admin)
export const getDisputeDetail = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const dispute = await disputeService.getDisputeDetail(req.params.disputeId);

    res.status(200).json({
      status: "success",
      data: { dispute },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update dispute status (admin)
// @route   PATCH /api/admin/disputes/:disputeId/status
// @access  Private (Admin)
export const updateDisputeStatus = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { status, resolution, refundAmount, adminNotes } = req.body;
    const dispute = await disputeService.updateDisputeStatus(
      req.params.disputeId,
      { status, resolution, refundAmount, adminNotes },
      req.admin.id,
    );

    res.status(200).json({
      status: "success",
      message: "Dispute status updated successfully.",
      data: { dispute },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Process dispute refund (admin refunds guest)
// @route   POST /api/admin/disputes/:disputeId/refund
// @access  Private (Admin)
export const refundDispute = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await disputeService.processDisputeRefund(req.params.disputeId, req.admin.id);

    res.status(200).json({
      status: "success",
      message: "Dispute resolved: Guest has been refunded.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Release dispute funds to host (admin decides in favor of host)
// @route   POST /api/admin/disputes/:disputeId/release
// @access  Private (Admin)
export const releaseDispute = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const dispute = await disputeService.releaseDisputeFunds(req.params.disputeId, req.admin.id);

    res.status(200).json({
      status: "success",
      message: "Dispute resolved: Funds released to host.",
      data: { dispute },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get dispute statistics (admin dashboard)
// @route   GET /api/admin/disputes/stats
// @access  Private (Admin)
export const getDisputeStats = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const stats = await disputeService.getDisputeStats();

    res.status(200).json({
      status: "success",
      data: { stats },
    });
  } catch (error) {
    next(error);
  }
};
