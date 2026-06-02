import type { Response } from "express";
import { Wishlist } from "../models/Wishlist.js";
import { Listing } from "../models/Listing.js";
import { Activity } from "../models/Activity.js";

// ── Helper: Build populated wishlist with full item details ──
async function populateWishlist(userId: string) {
  const items = await Wishlist.find({ userId } as any).sort({ createdAt: -1 }).lean();

  const stayIds = items.filter((w) => w.itemType === "stay").map((w) => w.itemId);
  const activityIds = items.filter((w) => w.itemType === "activity").map((w) => w.itemId);

  const [stays, activities] = await Promise.all([
    stayIds.length > 0
      ? Listing.find({ _id: { $in: stayIds } } as any)
          .select("title location city media price avgRating")
          .lean()
      : [],
    activityIds.length > 0
      ? Activity.find({ _id: { $in: activityIds } } as any)
          .select("title location city media price avgRating")
          .lean()
      : [],
  ]);

  const stayMap = new Map(stays.map((s: any) => [s._id.toString(), s]));
  const activityMap = new Map(activities.map((a: any) => [a._id.toString(), a]));

  return items
    .map((w) => {
      const idStr = w.itemId.toString();
      const item = w.itemType === "stay" ? stayMap.get(idStr) : activityMap.get(idStr);
      if (!item) return null;
      return {
        wishlistId: w._id,
        itemType: w.itemType,
        item: {
          _id: (item as any)._id,
          title: (item as any).title,
          location: (item as any).location || (item as any).city,
          city: (item as any).city,
          price: (item as any).price,
          avgRating: (item as any).avgRating,
          image:
            (item as any).media && (item as any).media.length > 0
              ? (item as any).media[0].url
              : "https://images.unsplash.com/photo-1580587771525-78b9dba3b914?auto=format&fit=crop&q=80&w=600",
        },
      };
    })
    .filter(Boolean);
}

// @desc   Get all wishlist items for current user (with item details)
// @route  GET /api/wishlist
export const getWishlist = async (req: any, res: Response): Promise<void> => {
  try {
    const userId = req.user.id;
    const result = await populateWishlist(userId);

    const stays = result.filter((r: any) => r.itemType === "stay");
    const activities = result.filter((r: any) => r.itemType === "activity");

    res.status(200).json({
      status: "success",
      data: { stays, activities, all: result },
    });
  } catch (error: any) {
    res.status(500).json({ status: "fail", message: error.message || "Failed to fetch wishlist." });
  }
};

// @desc   Toggle wishlist item (add if not exists, remove if exists)
// @route  POST /api/wishlist/toggle
export const toggleWishlist = async (req: any, res: Response): Promise<void> => {
  try {
    const userId = req.user.id;
    const { itemId, itemType } = req.body;

    if (!itemId || !itemType) {
      res.status(400).json({ status: "fail", message: "itemId and itemType are required." });
      return;
    }

    if (!["stay", "activity"].includes(itemType)) {
      res.status(400).json({ status: "fail", message: 'itemType must be "stay" or "activity".' });
      return;
    }

    // Check if already wishlisted
    const existing = await Wishlist.findOne({ userId, itemId, itemType } as any);

    if (existing) {
      // Remove from wishlist
      await Wishlist.deleteOne({ _id: existing._id } as any);
      res.status(200).json({
        status: "success",
        data: { isWishlisted: false, action: "removed" },
      });
      return;
    }

    // Add to wishlist
    await Wishlist.create({ userId, itemId, itemType } as any);
    res.status(200).json({
      status: "success",
      data: { isWishlisted: true, action: "added" },
    });
  } catch (error: any) {
    // Handle duplicate key error (race condition)
    if (error.code === 11000) {
      res.status(200).json({
        status: "success",
        data: { isWishlisted: true, action: "already_exists" },
      });
      return;
    }
    res.status(500).json({ status: "fail", message: error.message || "Toggle wishlist failed." });
  }
};

// @desc   Check if specific items are wishlisted (batch check)
// @route  POST /api/wishlist/check
export const checkWishlist = async (req: any, res: Response): Promise<void> => {
  try {
    const userId = req.user.id;
    const { items } = req.body; // [{ itemId, itemType }]

    if (!items || !Array.isArray(items)) {
      res.status(400).json({ status: "fail", message: "items array is required." });
      return;
    }

    const wishlistItems = await Wishlist.find({
      userId,
      $or: items.map((i: any) => ({ itemId: i.itemId, itemType: i.itemType })),
    } as any).lean();

    const wishlistedSet = new Set(
      wishlistItems.map((w) => `${w.itemType}:${w.itemId.toString()}`)
    );

    const result = items.map((i: any) => ({
      itemId: i.itemId,
      itemType: i.itemType,
      isWishlisted: wishlistedSet.has(`${i.itemType}:${i.itemId}`),
    }));

    res.status(200).json({
      status: "success",
      data: { items: result },
    });
  } catch (error: any) {
    res.status(500).json({ status: "fail", message: error.message || "Check wishlist failed." });
  }
};

// @desc   Remove an item from wishlist
// @route  DELETE /api/wishlist/:itemType/:itemId
export const removeWishlistItem = async (req: any, res: Response): Promise<void> => {
  try {
    const userId = req.user.id;
    const { itemType, itemId } = req.params;

    if (!["stay", "activity"].includes(itemType)) {
      res.status(400).json({ status: "fail", message: 'itemType must be "stay" or "activity".' });
      return;
    }

    await Wishlist.deleteOne({ userId, itemId, itemType } as any);

    res.status(200).json({
      status: "success",
      data: { isWishlisted: false },
    });
  } catch (error: any) {
    res.status(500).json({ status: "fail", message: error.message || "Remove from wishlist failed." });
  }
};