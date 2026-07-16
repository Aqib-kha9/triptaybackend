import { prisma } from "../config/db.js";
import { NotFoundError, BadRequestError } from "../core/errors.js";

// ──────────────────────── Types ────────────────────────

export interface VendorItem {
  _id: string;
  name: string;
  type: "listing" | "activity";
  subtype: string;
  city: string;
  coverImage: string | null;
}

export interface AvailabilityResponse {
  itemId: string;
  itemType: string;
  itemName: string;
  blockedDates: string[];
  notes: string | null;
  updatedAt?: Date;
}

export interface BlockDatesInput {
  dates: string[];
  notes?: string;
}

export interface BulkBlockInput {
  action: string;
  year?: number;
  month?: number;
  startDate?: string;
  endDate?: string;
}

// ──────────────────────── Helpers ────────────────────────

const VALID_ITEM_TYPES = ["listing", "activity"] as const;

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isValidDate(str: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(Date.parse(str));
}

function validateItemType(itemType: string): asserts itemType is "listing" | "activity" {
  if (!VALID_ITEM_TYPES.includes(itemType as (typeof VALID_ITEM_TYPES)[number])) {
    throw new BadRequestError("Item type must be 'listing' or 'activity'.");
  }
}

function validateDates(dates: string[]): void {
  if (!dates || !Array.isArray(dates) || dates.length === 0) {
    throw new BadRequestError("At least one date (YYYY-MM-DD) is required.");
  }
  const invalidDates = dates.filter((d) => !isValidDate(d));
  if (invalidDates.length > 0) {
    throw new BadRequestError(
      `Invalid date format(s): ${invalidDates.join(", ")}. Use YYYY-MM-DD.`,
    );
  }
}

function extractCoverImage(media: unknown): string | null {
  if (!Array.isArray(media)) return null;
  const cover = media.find((m: any) => m?.isCover);
  if (cover?.url) return cover.url;
  return media[0]?.url || null;
}

/**
 * Verify an item belongs to a vendor. Throws if not found or not owned.
 */
async function verifyItemOwnership(
  vendorId: string,
  itemId: string,
  itemType: "listing" | "activity",
): Promise<{ id: string; name: string }> {
  if (itemType === "listing") {
    const listing = await prisma.listing.findFirst({
      where: { id: itemId, hostId: vendorId },
      select: { id: true, name: true },
    });
    if (!listing) {
      throw new NotFoundError("Listing not found or not owned by you.");
    }
    return listing;
  } else {
    const activity = await prisma.activity.findFirst({
      where: { id: itemId, hostId: vendorId },
      select: { id: true, name: true },
    });
    if (!activity) {
      throw new NotFoundError("Activity not found or not owned by you.");
    }
    return activity;
  }
}

/**
 * Generate dates for bulk actions.
 */
function generateBulkDates(input: BulkBlockInput): string[] {
  const { action } = input;
  const now = new Date();
  const year = input.year ?? now.getFullYear();
  const month = input.month ?? now.getMonth(); // 0-indexed as in original controller

  const dates: string[] = [];

  switch (action) {
    case "all-weekends": {
      if (input.year === undefined || input.month === undefined) {
        throw new BadRequestError("Year and month (0-indexed) are required for 'all-weekends'.");
      }
      const date = new Date(year, month, 1);
      while (date.getMonth() === month) {
        const day = date.getDay();
        if (day === 0 || day === 6) {
          dates.push(formatDate(date));
        }
        date.setDate(date.getDate() + 1);
      }
      break;
    }

    case "all-weekdays": {
      if (input.year === undefined || input.month === undefined) {
        throw new BadRequestError("Year and month (0-indexed) are required for 'all-weekdays'.");
      }
      const date = new Date(year, month, 1);
      while (date.getMonth() === month) {
        const day = date.getDay();
        if (day !== 0 && day !== 6) {
          dates.push(formatDate(date));
        }
        date.setDate(date.getDate() + 1);
      }
      break;
    }

    case "full-month": {
      if (input.year === undefined || input.month === undefined) {
        throw new BadRequestError("Year and month (0-indexed) are required for 'full-month'.");
      }
      const date = new Date(year, month, 1);
      while (date.getMonth() === month) {
        dates.push(formatDate(date));
        date.setDate(date.getDate() + 1);
      }
      break;
    }

    case "date-range": {
      if (!input.startDate || !input.endDate) {
        throw new BadRequestError(
          "startDate and endDate (YYYY-MM-DD) are required for 'date-range'.",
        );
      }
      if (!isValidDate(input.startDate) || !isValidDate(input.endDate)) {
        throw new BadRequestError(
          "startDate and endDate must be valid YYYY-MM-DD strings.",
        );
      }
      const current = new Date(input.startDate);
      const end = new Date(input.endDate);
      if (current > end) {
        throw new BadRequestError("startDate must be before or equal to endDate.");
      }
      while (current <= end) {
        dates.push(formatDate(current));
        current.setDate(current.getDate() + 1);
      }
      break;
    }

    default:
      throw new BadRequestError(
        `Invalid action "${action}". Use 'all-weekends', 'all-weekdays', 'full-month', or 'date-range'.`,
      );
  }

  return dates;
}

// ──────────────────────── Service Functions ────────────────────────

/**
 * Get all published listings + activities for the vendor (for calendar dropdown).
 */
export async function getVendorItems(vendorId: string): Promise<VendorItem[]> {
  const [listings, activities] = await Promise.all([
    prisma.listing.findMany({
      where: { hostId: vendorId },
      select: {
        id: true,
        name: true,
        propertyType: true,
        city: true,
        media: true,
        status: true,
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.activity.findMany({
      where: { hostId: vendorId },
      select: {
        id: true,
        name: true,
        activityType: true,
        city: true,
        media: true,
        status: true,
      },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  const items: VendorItem[] = [
    ...listings.map((l: any) => ({
      _id: l.id,
      name: l.name,
      type: "listing" as const,
      subtype: l.propertyType,
      city: l.city,
      coverImage: extractCoverImage(l.media),
    })),
    ...activities.map((a: any) => ({
      _id: a.id,
      name: a.name,
      type: "activity" as const,
      subtype: a.activityType,
      city: a.city,
      coverImage: extractCoverImage(a.media),
    })),
  ];

  return items;
}

/**
 * Get blocked dates for a specific item.
 * Returns empty array if no availability record exists yet.
 */
export async function getAvailability(
  vendorId: string,
  itemId: string,
  itemType: string,
  month?: number,
  year?: number,
): Promise<AvailabilityResponse> {
  validateItemType(itemType);
  const item = await verifyItemOwnership(vendorId, itemId, itemType);

  const availability = await prisma.availability.findUnique({
    where: { itemId_itemType: { itemId, itemType } },
  });

  if (!availability) {
    return {
      itemId,
      itemType,
      itemName: item.name,
      blockedDates: [],
      notes: null,
    };
  }

  // If month/year filtering is requested, filter the blockedDates array
  let blockedDates = availability.blockedDates;
  if (month !== undefined && year !== undefined) {
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    blockedDates = blockedDates.filter((d) => d.startsWith(prefix));
  }

  return {
    itemId: availability.itemId,
    itemType: availability.itemType,
    itemName: item.name,
    blockedDates,
    notes: availability.notes || null,
    updatedAt: availability.updatedAt,
  };
}

/**
 * Block specific dates for an item (upserts into the blockedDates array).
 */
export async function blockDates(
  vendorId: string,
  itemId: string,
  itemType: string,
  input: BlockDatesInput,
): Promise<AvailabilityResponse> {
  validateItemType(itemType);
  validateDates(input.dates);
  const item = await verifyItemOwnership(vendorId, itemId, itemType);

  // Read current blocked dates
  const existing = await prisma.availability.findUnique({
    where: { itemId_itemType: { itemId, itemType } },
  });
  const currentBlocked = existing ? existing.blockedDates : [];
  const updatedBlocked = Array.from(new Set([...currentBlocked, ...input.dates]));

  // Upsert
  const availability = await prisma.availability.upsert({
    where: { itemId_itemType: { itemId, itemType } },
    create: {
      itemId,
      itemType,
      hostId: vendorId,
      blockedDates: updatedBlocked,
      notes: input.notes !== undefined ? input.notes : null,
    },
    update: {
      hostId: vendorId,
      blockedDates: updatedBlocked,
      ...(input.notes !== undefined && { notes: input.notes }),
    },
  });

  return {
    itemId: availability.itemId,
    itemType: availability.itemType,
    itemName: item.name,
    blockedDates: availability.blockedDates,
    notes: availability.notes || null,
    updatedAt: availability.updatedAt,
  };
}

/**
 * Unblock specific dates for an item (removes from the blockedDates array).
 */
export async function unblockDates(
  vendorId: string,
  itemId: string,
  itemType: string,
  dates: string[],
): Promise<AvailabilityResponse> {
  validateItemType(itemType);
  validateDates(dates);
  const item = await verifyItemOwnership(vendorId, itemId, itemType);

  const existing = await prisma.availability.findUnique({
    where: { itemId_itemType: { itemId, itemType } },
  });

  let remaining: string[] = [];
  let notes: string | null = null;

  if (existing) {
    remaining = existing.blockedDates.filter((d) => !dates.includes(d));
    notes = existing.notes;
    await prisma.availability.update({
      where: { itemId_itemType: { itemId, itemType } },
      data: {
        blockedDates: remaining,
      },
    });
  }

  return {
    itemId,
    itemType,
    itemName: item.name,
    blockedDates: remaining,
    notes,
  };
}

/**
 * Bulk block: all weekends, all weekdays, full month, or date range.
 */
export async function bulkBlock(
  vendorId: string,
  itemId: string,
  itemType: string,
  input: BulkBlockInput,
): Promise<AvailabilityResponse> {
  validateItemType(itemType);
  const item = await verifyItemOwnership(vendorId, itemId, itemType);

  const datesToBlock = generateBulkDates(input);

  if (datesToBlock.length === 0) {
    return {
      itemId,
      itemType,
      itemName: item.name,
      blockedDates: [],
      notes: null,
    };
  }

  const existing = await prisma.availability.findUnique({
    where: { itemId_itemType: { itemId, itemType } },
  });
  const currentBlocked = existing ? existing.blockedDates : [];
  const updatedBlocked = Array.from(new Set([...currentBlocked, ...datesToBlock]));

  const availability = await prisma.availability.upsert({
    where: { itemId_itemType: { itemId, itemType } },
    create: {
      itemId,
      itemType,
      hostId: vendorId,
      blockedDates: updatedBlocked,
    },
    update: {
      hostId: vendorId,
      blockedDates: updatedBlocked,
    },
  });

  return {
    itemId: availability.itemId,
    itemType: availability.itemType,
    itemName: item.name,
    blockedDates: availability.blockedDates,
    notes: availability.notes || null,
    updatedAt: availability.updatedAt,
  };
}

/**
 * Clear all blocked dates for an item (resets to empty array).
 */
export async function clearBlockedDates(
  vendorId: string,
  itemId: string,
  itemType: string,
): Promise<AvailabilityResponse> {
  validateItemType(itemType);
  const item = await verifyItemOwnership(vendorId, itemId, itemType);

  await prisma.availability.upsert({
    where: { itemId_itemType: { itemId, itemType } },
    create: {
      itemId,
      itemType,
      hostId: vendorId,
      blockedDates: [],
      notes: null,
    },
    update: {
      blockedDates: [],
      hostId: vendorId,
      notes: null,
    },
  });

  return {
    itemId,
    itemType,
    itemName: item.name,
    blockedDates: [],
    notes: null,
  };
}