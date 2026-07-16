import type { Response, NextFunction } from "express";
import * as wishlistService from "../services/wishlist.service.js";

// ──────────────────────── Controllers ────────────────────────

// @desc    Get user's wishlist
// @route   GET /api/wishlist
// @access  Private
export const getWishlist = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await wishlistService.getWishlist(req.user.id);

    res.status(200).json({
      status: "success",
      results: result.length,
      data: {
        wishlist: result,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Toggle (add/remove) item from wishlist
// @route   POST /api/wishlist/toggle
// @access  Private
export const toggleWishlist = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { itemId, itemType } = req.body;
    const result = await wishlistService.toggleWishlist(req.user.id, itemId, itemType);

    res.status(200).json({
      status: "success",
      message: result.action === "added" ? "Item added to wishlist." : "Item removed from wishlist.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Check if item(s) are in wishlist
// @route   POST /api/wishlist/check
// @access  Private
export const checkWishlist = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { itemIds } = req.body;
    const result = await wishlistService.checkWishlist(req.user.id, itemIds);

    res.status(200).json({
      status: "success",
      data: {
        wishlist: result,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Remove an item from wishlist
// @route   DELETE /api/wishlist/:itemId
// @access  Private
export const removeWishlistItem = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    await wishlistService.removeWishlistItem(req.user.id, req.params.itemId);

    res.status(200).json({
      status: "success",
      message: "Item removed from wishlist.",
    });
  } catch (error) {
    next(error);
  }
};