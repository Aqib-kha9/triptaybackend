import type { Request, Response, NextFunction } from "express";
import { prisma } from "../config/db.js";

// ──────────────────────── Helpers ────────────────────────

const formatDate = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const isValidDate = (str: string): boolean => {
  return /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(Date.parse(str));
};

// ──────────────────────── GET ITEMS FOR DROPDOWN ────────────────────────

// @desc    Get all published listings + activities for the vendor (for calendar dropdown)
// @route   GET /api/availability/items
// @access  Private (Vendor / Dual Mode)
export const getVendorItems = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const hostId = req.user?.id || req.user?._id;

    const [listings, activities] = await Promise.all([
      prisma.listing.findMany({
        where: { hostId },
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
        where: { hostId },
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

    const items = [
      ...listings.map((l: any) => ({
        _id: l.id,
        name: l.name,
        type: "listing" as const,
        subtype: l.propertyType,
        city: l.city,
        coverImage:
          (Array.isArray(l.media) ? l.media.find((m: any) => m.isCover)?.url : null) ||
          (Array.isArray(l.media) ? l.media[0]?.url : null) ||
          null,
      })),
      ...activities.map((a: any) => ({
        _id: a.id,
        name: a.name,
        type: "activity" as const,
        subtype: a.activityType,
        city: a.city,
        coverImage:
          (Array.isArray(a.media) ? a.media.find((m: any) => m.isCover)?.url : null) ||
          (Array.isArray(a.media) ? a.media[0]?.url : null) ||
          null,
      })),
    ];

    res.status(200).json({
      status: "success",
      results: items.length,
      data: { items },
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── GET AVAILABILITY ────────────────────────

// @desc    Get blocked dates for a specific item (listing or activity)
// @route   GET /api/availability/:itemType/:itemId
// @access  Private (Vendor / Dual Mode)
export const getAvailability = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const hostId = req.user?.id || req.user?._id;
    const { itemType, itemId } = req.params;

    if (!["listing", "activity"].includes(itemType)) {
      res.status(400).json({ status: "fail", message: "Item type must be 'listing' or 'activity'." });
      return;
    }

    // Verify item belongs to this vendor
    const item =
      itemType === "listing"
        ? await prisma.listing.findFirst({ where: { id: itemId, hostId }, select: { id: true, name: true } })
        : await prisma.activity.findFirst({ where: { id: itemId, hostId }, select: { id: true, name: true } });

    if (!item) {
      res.status(404).json({ status: "fail", message: `${itemType === "listing" ? "Listing" : "Activity"} not found or not owned by you.` });
      return;
    }

    const availability = await prisma.availability.findUnique({
      where: { itemId_itemType: { itemId, itemType } },
    });

    if (!availability) {
      // Return empty availability — no blocked dates yet
      res.status(200).json({
        status: "success",
        data: {
          availability: {
            itemId,
            itemType,
            itemName: item.name,
            blockedDates: [],
            notes: null,
          },
        },
      });
      return;
    }

    res.status(200).json({
      status: "success",
      data: {
        availability: {
          itemId: availability.itemId,
          itemType: availability.itemType,
          itemName: item.name,
          blockedDates: availability.blockedDates,
          notes: availability.notes || null,
          updatedAt: availability.updatedAt,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── BLOCK DATES ────────────────────────

// @desc    Block specific dates for an item
// @route   POST /api/availability/:itemType/:itemId/block
// @access  Private (Vendor / Dual Mode)
export const blockDates = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const hostId = req.user?.id || req.user?._id;
    const { itemType, itemId } = req.params;
    const { dates, notes } = req.body;

    if (!["listing", "activity"].includes(itemType)) {
      res.status(400).json({ status: "fail", message: "Item type must be 'listing' or 'activity'." });
      return;
    }

    if (!dates || !Array.isArray(dates) || dates.length === 0) {
      res.status(400).json({ status: "fail", message: "At least one date (YYYY-MM-DD) is required." });
      return;
    }

    // Validate all dates
    const invalidDates = dates.filter((d: string) => !isValidDate(d));
    if (invalidDates.length > 0) {
      res.status(400).json({
        status: "fail",
        message: `Invalid date format(s): ${invalidDates.join(", ")}. Use YYYY-MM-DD.`,
      });
      return;
    }

    // Verify item belongs to this vendor
    const item =
      itemType === "listing"
        ? await prisma.listing.findFirst({ where: { id: itemId, hostId }, select: { id: true } })
        : await prisma.activity.findFirst({ where: { id: itemId, hostId }, select: { id: true } });

    if (!item) {
      res.status(404).json({ status: "fail", message: `${itemType === "listing" ? "Listing" : "Activity"} not found or not owned by you.` });
      return;
    }

    // Read current blocked dates
    const existing = await prisma.availability.findUnique({
      where: { itemId_itemType: { itemId, itemType } },
    });
    const currentBlocked = existing ? existing.blockedDates : [];
    const updatedBlocked = Array.from(new Set([...currentBlocked, ...dates]));

    // Upsert
    const availability = await prisma.availability.upsert({
      where: { itemId_itemType: { itemId, itemType } },
      create: {
        itemId,
        itemType,
        hostId,
        blockedDates: updatedBlocked,
        notes: notes !== undefined ? notes : null,
      },
      update: {
        hostId,
        blockedDates: updatedBlocked,
        ...(notes !== undefined && { notes }),
      },
    });

    res.status(200).json({
      status: "success",
      message: `${dates.length} date(s) blocked successfully.`,
      data: {
        availability: {
          itemId: availability.itemId,
          itemType: availability.itemType,
          blockedDates: availability.blockedDates,
          notes: availability.notes || null,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── UNBLOCK DATES ────────────────────────

// @desc    Unblock specific dates for an item
// @route   POST /api/availability/:itemType/:itemId/unblock
// @access  Private (Vendor / Dual Mode)
export const unblockDates = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const hostId = req.user?.id || req.user?._id;
    const { itemType, itemId } = req.params;
    const { dates } = req.body;

    if (!["listing", "activity"].includes(itemType)) {
      res.status(400).json({ status: "fail", message: "Item type must be 'listing' or 'activity'." });
      return;
    }

    if (!dates || !Array.isArray(dates) || dates.length === 0) {
      res.status(400).json({ status: "fail", message: "At least one date (YYYY-MM-DD) is required." });
      return;
    }

    const invalidDates = dates.filter((d: string) => !isValidDate(d));
    if (invalidDates.length > 0) {
      res.status(400).json({
        status: "fail",
        message: `Invalid date format(s): ${invalidDates.join(", ")}. Use YYYY-MM-DD.`,
      });
      return;
    }

    const item =
      itemType === "listing"
        ? await prisma.listing.findFirst({ where: { id: itemId, hostId }, select: { id: true } })
        : await prisma.activity.findFirst({ where: { id: itemId, hostId }, select: { id: true } });

    if (!item) {
      res.status(404).json({ status: "fail", message: `${itemType === "listing" ? "Listing" : "Activity"} not found or not owned by you.` });
      return;
    }

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

    res.status(200).json({
      status: "success",
      message: `${dates.length} date(s) unblocked successfully.`,
      data: {
        availability: {
          itemId,
          itemType,
          blockedDates: remaining,
          notes: notes || null,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── BULK BLOCK ────────────────────────

// @desc    Bulk block: all weekends, all weekdays, or a date range for a month
// @route   POST /api/availability/:itemType/:itemId/bulk-block
// @access  Private (Vendor / Dual Mode)
export const bulkBlock = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const hostId = req.user?.id || req.user?._id;
    const { itemType, itemId } = req.params;
    const { action, year, month, startDate, endDate } = req.body;

    if (!["listing", "activity"].includes(itemType)) {
      res.status(400).json({ status: "fail", message: "Item type must be 'listing' or 'activity'." });
      return;
    }

    const item =
      itemType === "listing"
        ? await prisma.listing.findFirst({ where: { id: itemId, hostId }, select: { id: true } })
        : await prisma.activity.findFirst({ where: { id: itemId, hostId }, select: { id: true } });

    if (!item) {
      res.status(404).json({ status: "fail", message: `${itemType === "listing" ? "Listing" : "Activity"} not found or not owned by you.` });
      return;
    }

    let datesToBlock: string[] = [];

    switch (action) {
      case "all-weekends": {
        if (year === undefined || month === undefined) {
          res.status(400).json({ status: "fail", message: "Year and month (0-indexed) are required for 'all-weekends'." });
          return;
        }
        const date = new Date(year, month, 1);
        while (date.getMonth() === month) {
          const day = date.getDay();
          if (day === 0 || day === 6) {
            datesToBlock.push(formatDate(date));
          }
          date.setDate(date.getDate() + 1);
        }
        break;
      }
      case "all-weekdays": {
        if (year === undefined || month === undefined) {
          res.status(400).json({ status: "fail", message: "Year and month (0-indexed) are required for 'all-weekdays'." });
          return;
        }
        const date = new Date(year, month, 1);
        while (date.getMonth() === month) {
          const day = date.getDay();
          if (day !== 0 && day !== 6) {
            datesToBlock.push(formatDate(date));
          }
          date.setDate(date.getDate() + 1);
        }
        break;
      }
      case "full-month": {
        if (year === undefined || month === undefined) {
          res.status(400).json({ status: "fail", message: "Year and month (0-indexed) are required for 'full-month'." });
          return;
        }
        const date = new Date(year, month, 1);
        while (date.getMonth() === month) {
          datesToBlock.push(formatDate(date));
          date.setDate(date.getDate() + 1);
        }
        break;
      }
      case "date-range": {
        if (!startDate || !endDate) {
          res.status(400).json({ status: "fail", message: "startDate and endDate (YYYY-MM-DD) are required for 'date-range'." });
          return;
        }
        if (!isValidDate(startDate) || !isValidDate(endDate)) {
          res.status(400).json({ status: "fail", message: "startDate and endDate must be valid YYYY-MM-DD strings." });
          return;
        }
        const current = new Date(startDate);
        const end = new Date(endDate);
        if (current > end) {
          res.status(400).json({ status: "fail", message: "startDate must be before or equal to endDate." });
          return;
        }
        while (current <= end) {
          datesToBlock.push(formatDate(current));
          current.setDate(current.getDate() + 1);
        }
        break;
      }
      default:
        res.status(400).json({
          status: "fail",
          message: "Invalid action. Use 'all-weekends', 'all-weekdays', 'full-month', or 'date-range'.",
        });
        return;
    }

    if (datesToBlock.length === 0) {
      res.status(200).json({ status: "success", message: "No dates to block.", data: { blockedDates: [] } });
      return;
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
        hostId,
        blockedDates: updatedBlocked,
      },
      update: {
        hostId,
        blockedDates: updatedBlocked,
      },
    });

    res.status(200).json({
      status: "success",
      message: `${datesToBlock.length} date(s) blocked via bulk action "${action}".`,
      data: {
        availability: {
          itemId: availability.itemId,
          itemType: availability.itemType,
          blockedDates: availability.blockedDates,
          notes: availability.notes || null,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── SYNC/CLEAR ────────────────────────

// @desc    Clear all blocked dates for an item (full sync reset)
// @route   DELETE /api/availability/:itemType/:itemId/clear
// @access  Private (Vendor / Dual Mode)
export const clearBlockedDates = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const hostId = req.user?.id || req.user?._id;
    const { itemType, itemId } = req.params;

    if (!["listing", "activity"].includes(itemType)) {
      res.status(400).json({ status: "fail", message: "Item type must be 'listing' or 'activity'." });
      return;
    }

    const item =
      itemType === "listing"
        ? await prisma.listing.findFirst({ where: { id: itemId, hostId }, select: { id: true } })
        : await prisma.activity.findFirst({ where: { id: itemId, hostId }, select: { id: true } });

    if (!item) {
      res.status(404).json({ status: "fail", message: `${itemType === "listing" ? "Listing" : "Activity"} not found or not owned by you.` });
      return;
    }

    await prisma.availability.upsert({
      where: { itemId_itemType: { itemId, itemType } },
      create: {
        itemId,
        itemType,
        hostId,
        blockedDates: [],
        notes: null,
      },
      update: {
        blockedDates: [],
        hostId,
        notes: null,
      },
    });

    res.status(200).json({
      status: "success",
      message: "All blocked dates cleared successfully.",
      data: {
        availability: {
          itemId,
          itemType,
          blockedDates: [],
          notes: null,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};