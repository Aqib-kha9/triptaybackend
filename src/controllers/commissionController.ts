import type { Request, Response, NextFunction } from "express";
import * as commissionService from "../services/commission.service.js";

// ──────────────────────── Controllers ────────────────────────

// @desc    Get host's pending payouts
// @route   GET /api/commission/pending
// @access  Private (Vendor / Dual Mode)
export const getHostPendingPayouts = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await commissionService.getHostPendingPayouts(req.user.id);

    res.status(200).json({
      status: "success",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Process a payout to a host (admin)
// @route   POST /api/commission/payouts
// @access  Private (Admin)
export const processPayout = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { hostId, bookingIds } = req.body;
    const payout = await commissionService.processPayout(hostId, bookingIds, req.admin.id);

    res.status(200).json({
      status: "success",
      message: "Payout processed successfully.",
      data: {
        payout,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get host's payout history
// @route   GET /api/commission/payouts
// @access  Private (Vendor / Dual Mode)
export const getHostPayouts = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, limit, status } = req.query;
    const result = await commissionService.getHostPayouts(req.user.id, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      status: status as string | undefined,
    });

    res.status(200).json({
      status: "success",
      results: result.payouts.length,
      pagination: result.pagination,
      data: {
        payouts: result.payouts,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all payouts (admin)
// @route   GET /api/commission/payouts/all
// @access  Private (Admin)
export const getAllPayouts = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, limit, status, hostId } = req.query;
    const result = await commissionService.getAllPayouts({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      status: status as string | undefined,
      hostId: hostId as string | undefined,
    });

    res.status(200).json({
      status: "success",
      results: result.payouts.length,
      pagination: result.pagination,
      data: {
        payouts: result.payouts,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get commission summary (admin)
// @route   GET /api/commission/summary
// @access  Private (Admin)
export const getCommissionSummary = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;
    const result = await commissionService.getCommissionSummary({
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
    });

    res.status(200).json({
      status: "success",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get host ledger (for a specific host)
// @route   GET /api/commission/ledger
// @access  Private (Vendor / Dual Mode)
export const getHostLedger = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, limit, startDate, endDate } = req.query;
    const result = await commissionService.getHostLedger(req.user.id, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
    });

    res.status(200).json({
      status: "success",
      results: result.ledger.length,
      pagination: result.pagination,
      data: {
        ledger: result.ledger,
        summary: result.summary,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get host ledger by hostId (admin)
// @route   GET /api/commission/ledger/:hostId
// @access  Private (Admin)
export const getHostLedgerByAdmin = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, limit, startDate, endDate } = req.query;
    const result = await commissionService.getHostLedger(req.params.hostId, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
    });

    res.status(200).json({
      status: "success",
      results: result.ledger.length,
      pagination: result.pagination,
      data: {
        ledger: result.ledger,
        summary: result.summary,
      },
    });
  } catch (error) {
    next(error);
  }
};
