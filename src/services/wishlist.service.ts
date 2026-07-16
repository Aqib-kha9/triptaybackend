import { prisma } from "../config/db.js";
import { NotFoundError, BadRequestError } from "../core/errors.js";

// ──────────────────────── Types ────────────────────────

export interface WishlistItem {
  _id: string;
  id: string;
  type: "listing" | "activity";
  item: Record<string, unknown> | null;
  createdAt: Date;
}

export interface WishlistCheckResult {
  _id: string;
  isWishlisted: boolean;
}

// ──────────────────────── Service Functions ────────────────────────

export async function getWishlist(userId: string): Promise<WishlistItem[]> {
  const wishlist = await prisma.wishlist.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  const listingIds = wishlist.filter((w) => w.itemType === "listing").map((w) => w.itemId);
  const activityIds = wishlist.filter((w) => w.itemType === "activity").map((w) => w.itemId);

  const [listings, activities] = await Promise.all([
    listingIds.length
      ? prisma.listing.findMany({ where: { id: { in: listingIds } } })
      : [],
    activityIds.length
      ? prisma.activity.findMany({ where: { id: { in: activityIds } } })
      : [],
  ]);

  const listingMap = new Map(
    listings.map((l) => {
      const obj = { ...l, _id: l.id } as Record<string, unknown>;
      (obj as any).coordinates = { lat: l.lat, lng: l.lng };
      delete (obj as any).lat;
      delete (obj as any).lng;
      return [l.id, obj];
    }),
  );

  const activityMap = new Map(
    activities.map((a) => {
      const obj = { ...a, _id: a.id } as Record<string, unknown>;
      (obj as any).coordinates = { lat: a.lat, lng: a.lng };
      delete (obj as any).lat;
      delete (obj as any).lng;
      return [a.id, obj];
    }),
  );

  return wishlist.map((w) => ({
    _id: w.id,
    id: w.id,
    type: w.itemType as "listing" | "activity",
    item: w.itemType === "listing"
      ? listingMap.get(w.itemId) || null
      : activityMap.get(w.itemId) || null,
    createdAt: w.createdAt,
  }));
}

export async function toggleWishlist(
  userId: string,
  itemId: string,
  itemType: "listing" | "activity",
): Promise<{ action: "added" | "removed"; item: WishlistItem }> {
  // Verify item exists
  if (itemType === "listing") {
    const listing = await prisma.listing.findUnique({ where: { id: itemId } });
    if (!listing) throw new NotFoundError("Listing not found.");
  } else {
    const activity = await prisma.activity.findUnique({ where: { id: itemId } });
    if (!activity) throw new NotFoundError("Activity not found.");
  }

  const existing = await prisma.wishlist.findFirst({
    where: { userId, itemId, itemType },
  });

  if (existing) {
    // Remove
    await prisma.wishlist.delete({ where: { id: existing.id } });

    return {
      action: "removed",
      item: {
        _id: existing.id,
        id: existing.id,
        type: existing.itemType as "listing" | "activity",
        item: null,
        createdAt: existing.createdAt,
      },
    };
  }

  // Add
  const created = await prisma.wishlist.create({
    data: { userId, itemId, itemType },
  });

  return {
    action: "added",
    item: {
      _id: created.id,
      id: created.id,
      type: created.itemType as "listing" | "activity",
      item: null,
      createdAt: created.createdAt,
    },
  };
}

export async function checkWishlist(
  userId: string,
  itemIds: string[],
): Promise<WishlistCheckResult[]> {
  if (!itemIds.length) return [];

  const items = await prisma.wishlist.findMany({
    where: {
      userId,
      itemId: { in: itemIds },
    },
    select: { itemId: true },
  });

  const wishlistedIds = new Set(items.map((i) => i.itemId));

  return itemIds.map((id) => ({
    _id: id,
    isWishlisted: wishlistedIds.has(id),
  }));
}

export async function removeWishlistItem(
  userId: string,
  wishlistId: string,
): Promise<void> {
  const item = await prisma.wishlist.findFirst({
    where: { id: wishlistId, userId },
  });

  if (!item) {
    throw new NotFoundError("Wishlist item not found.");
  }

  await prisma.wishlist.delete({ where: { id: wishlistId } });
}