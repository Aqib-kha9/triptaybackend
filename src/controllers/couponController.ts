import type { Request, Response, NextFunction } from "express";
import * as couponService from "../services/coupon.service.js";

// ──────────────────────── Controllers ────────────────────────

// @desc    Create a coupon (admin)
// @route   POST /api/coupons
// @access  Private (Admin)
export const createCoupon = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const coupon = await couponService.createCoupon(req.body, req.admin?.id);

    res.status(201).json({
      status: "success",
      data: {
        coupon,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update a coupon (admin)
// @route   PUT /api/coupons/:id
// @access  Private (Admin)
export const updateCoupon = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const coupon = await couponService.updateCoupon(req.params.id, req.body, req.admin?.id);

    res.status(200).json({
      status: "success",
      data: {
        coupon,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete a coupon (admin)
// @route   DELETE /api/coupons/:id
// @access  Private (Admin)
export const deleteCoupon = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await couponService.deleteCoupon(req.params.id, req.admin?.id);

    res.status(200).json({
      status: "success",
      message: result.message,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    List all coupons (admin)
// @route   GET /api/coupons
// @access  Private (Admin)
export const listCoupons = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, limit, isActive, scope } = req.query;
    const result = await couponService.listCoupons({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      isActive: isActive !== undefined ? isActive === "true" : undefined,
      scope: scope as string | undefined,
    });

    res.status(200).json({
      status: "success",
      results: result.coupons.length,
      pagination: result.pagination,
      data: {
        coupons: result.coupons,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get coupon usage stats (admin)
// @route   GET /api/coupons/:id/stats
// @access  Private (Admin)
export const getCouponStats = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await couponService.getCouponStats(req.params.id);

    res.status(200).json({
      status: "success",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Validate a coupon (public/authenticated)
// @route   POST /api/coupons/validate
// @access  Private
export const validateCoupon = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { code, orderValue, itemType, itemId } = req.body;
    const result = await couponService.validateCoupon(
      code,
      orderValue,
      itemType,
      itemId,
      req.user?.id,
    );

    res.status(200).json({
      status: "success",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};
