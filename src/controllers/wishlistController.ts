import type { Response } from "express";
import { prisma } from "../config/db.js";

// ── Helper: Build populated wishlist with full item details ──
async function populateWishlist(userId: string) {
  const items = await prisma.wishlist.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  const stayIds = items.filter((w) => w.itemType === "stay").map((w) => w.itemId);
  const activityIds = items.filter((w) => w.itemType === "activity").map((w) => w.itemId);

  const [stays, activities] = await Promise.all([
    stayIds.length > 0
      ? prisma.listing.findMany({
          where: { id: { in: stayIds } },
          select: {
            id: true,
            name: true,
            city: true,
            address: true,
            media: true,
            basePrice: true,
            avgRating: true,
          },
        })
      : [],
    activityIds.length > 0
      ? prisma.activity.findMany({
          where: { id: { in: activityIds } },
          select: {
            id: true,
            name: true,
            city: true,
            address: true,
            media: true,
            basePrice: true,
            avgRating: true,
          },
        })
      : [],
  ]);

  const stayMap = new Map(stays.map((s: any) => [s.id, s]));
  const activityMap = new Map(activities.map((a: any) => [a.id, a]));

  return items
    .map((w) => {
      const idStr = w.itemId;
      const item = w.itemType === "stay" ? stayMap.get(idStr) : activityMap.get(idStr);
      if (!item) return null;
      return {
        wishlistId: w.id,
        itemType: w.itemType,
        item: {
          _id: (item as any).id,
          title: (item as any).name,
          location: (item as any).address || (item as any).city,
          city: (item as any).city,
          price: (item as any).basePrice,
          avgRating: (item as any).avgRating,
          image:
            (item as any).media && Array.isArray((item as any).media) && (item as any).media.length > 0
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
    const existing = await prisma.wishlist.findUnique({
      where: {
        userId_itemId_itemType: {
          userId,
          itemId,
          itemType,
        },
      },
    });

    if (existing) {
      // Remove from wishlist
      await prisma.wishlist.delete({
        where: { id: existing.id },
      });
      res.status(200).json({
        status: "success",
        data: { isWishlisted: false, action: "removed" },
      });
      return;
    }

    // Add to wishlist
    await prisma.wishlist.create({
      data: { userId, itemId, itemType },
    });
    res.status(200).json({
      status: "success",
      data: { isWishlisted: true, action: "added" },
    });
  } catch (error: any) {
    // Handle duplicate key error (P2002 in Prisma)
    if (error.code === "P2002") {
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

    const wishlistItems = await prisma.wishlist.findMany({
      where: {
        userId,
        OR: items.map((i: any) => ({ itemId: i.itemId, itemType: i.itemType })),
      },
    });

    const wishlistedSet = new Set(
      wishlistItems.map((w) => `${w.itemType}:${w.itemId}`)
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

    // Delete matching wishlist record
    await prisma.wishlist.deleteMany({
      where: { userId, itemId, itemType },
    });

    res.status(200).json({
      status: "success",
      data: { isWishlisted: false },
    });
  } catch (error: any) {
    res.status(500).json({ status: "fail", message: error.message || "Remove from wishlist failed." });
  }
};