import type { Request, Response, NextFunction } from "express";
import { Availability } from "../models/Availability.js";
import { Listing } from "../models/Listing.js";
import { Activity } from "../models/Activity.js";

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
      Listing.find({ host: hostId })
        .select("name propertyType city media status")
        .sort({ updatedAt: -1 })
        .lean(),
      Activity.find({ host: hostId })
        .select("name activityType city media status")
        .sort({ updatedAt: -1 })
        .lean(),
    ]);

    const items = [
      ...listings.map((l: any) => ({
        _id: l._id,
        name: l.name,
        type: "listing" as const,
        subtype: l.propertyType,
        city: l.city,
        coverImage: l.media?.find((m: any) => m.isCover)?.url || l.media?.[0]?.url || null,
      })),
      ...activities.map((a: any) => ({
        _id: a._id,
        name: a.name,
        type: "activity" as const,
        subtype: a.activityType,
        city: a.city,
        coverImage: a.media?.find((m: any) => m.isCover)?.url || a.media?.[0]?.url || null,
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
    const Model = itemType === "listing" ? Listing : Activity;
    const item = await (Model as any).findOne({ _id: itemId, host: hostId }).select("_id name").lean();
    if (!item) {
      res.status(404).json({ status: "fail", message: `${itemType === "listing" ? "Listing" : "Activity"} not found or not owned by you.` });
      return;
    }

    let availability = await Availability.findOne({ itemId, itemType }).lean();

    if (!availability) {
      // Return empty availability — no blocked dates yet
      res.status(200).json({
        status: "success",
        data: {
          availability: {
            itemId,
            itemType,
            itemName: (item as any).name,
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
          itemName: (item as any).name,
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
    const Model = itemType === "listing" ? Listing : Activity;
    const item = await (Model as any).findOne({ _id: itemId, host: hostId }).select("_id").lean();
    if (!item) {
      res.status(404).json({ status: "fail", message: `${itemType === "listing" ? "Listing" : "Activity"} not found or not owned by you.` });
      return;
    }

    // Upsert: add dates to blockedDates, deduplicate
    const availability = await Availability.findOneAndUpdate(
      { itemId, itemType },
      {
        $set: { host: hostId },
        $addToSet: { blockedDates: { $each: dates } },
        ...(notes !== undefined && { $set: { ...{ host: hostId }, notes } }),
      },
      { upsert: true, new: true, runValidators: true }
    );

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

    const Model = itemType === "listing" ? Listing : Activity;
    const item = await (Model as any).findOne({ _id: itemId, host: hostId }).select("_id").lean();
    if (!item) {
      res.status(404).json({ status: "fail", message: `${itemType === "listing" ? "Listing" : "Activity"} not found or not owned by you.` });
      return;
    }

    const availability = await Availability.findOneAndUpdate(
      { itemId, itemType },
      { $pull: { blockedDates: { $in: dates } } },
      { new: true }
    );

    const remaining = availability?.blockedDates || [];

    res.status(200).json({
      status: "success",
      message: `${dates.length} date(s) unblocked successfully.`,
      data: {
        availability: {
          itemId,
          itemType,
          blockedDates: remaining,
          notes: availability?.notes || null,
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

    const Model = itemType === "listing" ? Listing : Activity;
    const item = await (Model as any).findOne({ _id: itemId, host: hostId }).select("_id").lean();
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

    const availability = await Availability.findOneAndUpdate(
      { itemId, itemType },
      {
        $set: { host: hostId },
        $addToSet: { blockedDates: { $each: datesToBlock } },
      },
      { upsert: true, new: true, runValidators: true }
    );

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

    const Model = itemType === "listing" ? Listing : Activity;
    const item = await (Model as any).findOne({ _id: itemId, host: hostId }).select("_id").lean();
    if (!item) {
      res.status(404).json({ status: "fail", message: `${itemType === "listing" ? "Listing" : "Activity"} not found or not owned by you.` });
      return;
    }

    await Availability.findOneAndUpdate(
      { itemId, itemType },
      { $set: { blockedDates: [], host: hostId } },
      { upsert: true }
    );

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