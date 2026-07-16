import type { Response, NextFunction } from "express";
import * as availabilityService from "../services/availability.service.js";

// ──────────────────────── Controllers ────────────────────────

// @desc    Get vendor's items (listings + activities)
// @route   GET /api/availability/vendor-items
// @access  Private (Vendor)
export const getVendorItems = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const items = await availabilityService.getVendorItems(req.user.id);

    res.status(200).json({
      status: "success",
      results: items.length,
      data: { items },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get availability for an item
// @route   GET /api/availability/:itemType/:itemId
// @access  Private (Vendor)
export const getAvailability = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const itemId = (req.params.itemId || req.query.itemId) as string;
    const itemType = (req.params.itemType || req.query.itemType) as string;
    const { month, year } = req.query;
    const monthNum = month ? parseInt(month as string, 10) : undefined;
    const yearNum = year ? parseInt(year as string, 10) : undefined;

    const result = await availabilityService.getAvailability(
      req.user.id,
      itemId,
      itemType,
      !isNaN(monthNum as number) ? monthNum : undefined,
      !isNaN(yearNum as number) ? yearNum : undefined,
    );

    res.status(200).json({
      status: "success",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Block dates for an item
// @route   POST /api/availability/:itemType/:itemId/block
// @access  Private (Vendor)
export const blockDates = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const itemId = req.params.itemId || req.body.itemId;
    const itemType = req.params.itemType || req.body.itemType;
    const { dates, notes } = req.body;
    const result = await availabilityService.blockDates(req.user.id, itemId, itemType, { dates, notes });

    res.status(200).json({
      status: "success",
      message: `${result.blockedDates.length} date(s) now blocked.`,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Unblock dates for an item
// @route   POST /api/availability/:itemType/:itemId/unblock
// @access  Private (Vendor)
export const unblockDates = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const itemId = req.params.itemId || req.body.itemId;
    const itemType = req.params.itemType || req.body.itemType;
    const { dates } = req.body;
    const result = await availabilityService.unblockDates(req.user.id, itemId, itemType, dates);

    res.status(200).json({
      status: "success",
      message: "Dates unblocked successfully.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Bulk block dates by pattern
// @route   POST /api/availability/:itemType/:itemId/bulk-block
// @access  Private (Vendor)
export const bulkBlock = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const itemId = req.params.itemId || req.body.itemId;
    const itemType = req.params.itemType || req.body.itemType;
    const { ...rest } = req.body;
    const result = await availabilityService.bulkBlock(req.user.id, itemId, itemType, rest);

    res.status(200).json({
      status: "success",
      message: `Successfully blocked ${result.blockedDates.length} date(s).`,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Clear all blocked dates for an item
// @route   DELETE /api/availability/:itemId/:itemType
// @access  Private (Vendor)
export const clearBlockedDates = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    await availabilityService.clearBlockedDates(req.user.id, req.params.itemId, req.params.itemType);

    res.status(200).json({
      status: "success",
      message: "All blocked dates cleared successfully.",
    });
  } catch (error) {
    next(error);
  }
};