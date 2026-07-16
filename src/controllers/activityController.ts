import type { Request, Response, NextFunction } from "express";
import * as activityService from "../services/activity.service.js";
import { prisma } from "../config/db.js";

// ──────────────────────── Controllers ────────────────────────

// @desc    Create a new activity
// @route   POST /api/activities
// @access  Private (Vendor / Dual Mode)
export const createActivity = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const activity = await activityService.createActivity(req.user.id, req.body);

    const enriched = await activityService.populateHostForActivity(
      activity as unknown as Record<string, unknown>,
    );

    res.status(201).json({
      status: "success",
      data: {
        activity: enriched,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all activities for current vendor
// @route   GET /api/activities
// @access  Private
export const getMyActivities = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { status, page, limit } = req.query;
    const result = await activityService.getMyActivities(req.user.id, { status, page, limit });

    res.status(200).json({
      status: "success",
      results: result.activities.length,
      pagination: result.pagination,
      data: {
        activities: result.activities,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get a single activity by ID
// @route   GET /api/activities/:id
// @access  Private
export const getActivity = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const activity = await activityService.getActivity(req.params.id);
    const enriched = await activityService.populateHostForActivity(
      activity as unknown as Record<string, unknown>,
    );

    res.status(200).json({
      status: "success",
      data: {
        activity: enriched,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update an activity
// @route   PUT /api/activities/:id
// @access  Private
export const updateActivity = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const activity = await activityService.updateActivity(req.params.id, req.user.id, req.body);

    res.status(200).json({
      status: "success",
      data: {
        activity,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete an activity
// @route   DELETE /api/activities/:id
// @access  Private
export const deleteActivity = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    await activityService.deleteActivity(req.params.id, req.user.id);

    res.status(200).json({
      status: "success",
      message: "Activity deleted successfully.",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Upload media files to an activity
// @route   POST /api/activities/:id/media
// @access  Private
export const uploadActivityMedia = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await activityService.uploadActivityMedia(
      req.params.id,
      req.user.id,
      req.files as Express.Multer.File[],
      req.body as Record<string, string>,
    );

    res.status(200).json({
      status: "success",
      message: "Media uploaded successfully.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete a media item from an activity
// @route   DELETE /api/activities/:id/media/:mediaId
// @access  Private
export const deleteActivityMedia = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await activityService.deleteActivityMedia(
      req.params.id,
      req.user.id,
      req.params.mediaId,
    );

    res.status(200).json({
      status: "success",
      message: "Media deleted successfully.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Browse published activities (public)
// @route   GET /api/activities/browse
// @access  Public
export const browseActivities = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const {
      city, state, activityType, difficulty,
      minPrice, maxPrice, sort, page, limit,
    } = req.query as Record<string, string>;

    const result = await activityService.browseActivities({
      city, state, activityType, difficulty,
      minPrice, maxPrice, sort, page, limit,
    });

    // Enrich activities with host info
    const enriched = await Promise.all(
      result.activities.map(async (a) => {
        if (!a) return a;
        const enrichedActivity = await activityService.populateHostForActivity(
          a as unknown as Record<string, unknown>,
        );
        return enrichedActivity;
      }),
    );

    res.status(200).json({
      status: "success",
      results: enriched.length,
      pagination: result.pagination,
      data: {
        activities: enriched,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get a public activity by slug
// @route   GET /api/public/activity/:slug
// @access  Public
export const getPublicActivity = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const activity = await activityService.getPublicActivity(req.params.slug);

    res.status(200).json({
      status: "success",
      data: {
        activity,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get blocked dates and booked slots for an activity (public)
// @route   GET /api/public/activities/:id/availability
// @access  Public
export const getActivityAvailability = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const now = new Date();

    const activity = await prisma.activity.findUnique({ where: { id } });
    if (!activity) {
      res.status(404).json({ status: "fail", message: "Activity not found" });
      return;
    }

    // 1. Get blocked dates from Availability
    const availability = await prisma.availability.findUnique({
      where: { itemId_itemType: { itemId: id, itemType: "activity" } },
    });
    const blockedDates = availability ? availability.blockedDates : [];

    // 2. Get active bookings for this activity to check slot capacity
    const bookings = await prisma.booking.findMany({
      where: {
        itemId: id,
        itemType: "activity",
        status: { in: ["pending", "confirmed"] },
        OR: [
          { status: "confirmed" },
          {
            status: "pending",
            OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
          },
        ],
      },
      select: {
        activityDate: true,
        startTime: true,
        guests: true,
      },
    });

    // 3. Group and sum participants by date and time slot
    // structure: { "2026-07-15": { "10:00 AM": 5, "02:00 PM": 8 } }
    const slotParticipants: Record<string, Record<string, number>> = {};

    bookings.forEach((booking: any) => {
      if (!booking.activityDate || !booking.startTime) return;
      const dateStr = booking.activityDate.toISOString().split("T")[0];
      const timeSlot = booking.startTime;
      const guests = booking.guests || 0;

      if (!slotParticipants[dateStr]) {
        slotParticipants[dateStr] = {};
      }
      slotParticipants[dateStr][timeSlot] = (slotParticipants[dateStr][timeSlot] || 0) + guests;
    });

    // 4. Identify slots that are fully booked
    const maxCapacity = activity.maxGroupSize || 20;
    const bookedSlots: Record<string, string[]> = {};

    Object.entries(slotParticipants).forEach(([dateStr, slots]) => {
      Object.entries(slots).forEach(([timeSlot, totalGuests]) => {
        if (totalGuests >= maxCapacity) {
          if (!bookedSlots[dateStr]) {
            bookedSlots[dateStr] = [];
          }
          bookedSlots[dateStr].push(timeSlot);
        }
      });
    });

    res.status(200).json({
      status: "success",
      data: {
        blockedDates,
        bookedSlots,
      },
    });
  } catch (error) {
    next(error);
  }
};