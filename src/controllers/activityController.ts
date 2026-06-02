import type { Request, Response, NextFunction } from "express";
import { Activity } from "../models/Activity.js";
import cloudinary from "../config/cloudinary.js";
import { validateMagicBytes } from "../utils/validateMagicBytes.js";

// ──────────────────────── Helper: Get effective weekend price ────────────────────────

const computeEffectiveWeekendPrice = (base: number, weekend?: number): number => {
  if (weekend && weekend > 0) return weekend;
  return Math.round(base * 1.3);
};

// ──────────────────────── CREATE ────────────────────────

// @desc    Create a new activity
// @route   POST /api/activities
// @access  Private (Vendor / Dual Mode)
export const createActivity = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const hostId = req.user?.id || req.user?._id;
    if (!hostId) {
      res.status(401).json({ status: "fail", message: "Authentication required." });
      return;
    }

    const {
      name, summary, description, activityType, difficulty,
      address, city, state, country, zipCode, coordinates, landmark, meetingPoint,
      durationHours, durationDays, startTimes, availability, availabilityNotes,
      minAge, maxGroupSize, minGroupSize,
      basePrice, weekendPrice, childPrice, foreignerPrice, seasonalPrices,
      taxes, securityDeposit,
      equipmentProvided, equipmentRequired, safetyGuidelines,
      hasInsurance, certifiedGuides, guideRatio,
      included, excluded,
      houseRules, cancellationPolicy, cancellationDetails,
      isPetFriendly, petRules, restrictions,
      nearbyPlaces, languagesSpoken, videoTourUrl,
      instantBook, advanceNoticeHours, maxGuestsPerBooking,
      status,
    } = req.body;

    // ── Validate required core fields ──
    const requiredFields: Record<string, any> = {
      name, summary, description, activityType, difficulty,
      address, city, state, country, zipCode,
    };
    const missing = Object.entries(requiredFields).filter(([, v]) => !v || (typeof v === "string" && !v.trim()));
    if (missing.length > 0) {
      res.status(400).json({
        status: "fail",
        message: `Missing required fields: ${missing.map(([k]) => k).join(", ")}`,
      });
      return;
    }

    if (!coordinates || coordinates.lat == null || coordinates.lng == null) {
      res.status(400).json({ status: "fail", message: "Coordinates (lat, lng) are required." });
      return;
    }

    if (!basePrice || basePrice <= 0) {
      res.status(400).json({ status: "fail", message: "basePrice must be a positive number." });
      return;
    }

    if (!maxGroupSize || maxGroupSize < 1) {
      res.status(400).json({ status: "fail", message: "maxGroupSize must be at least 1." });
      return;
    }

    if (!durationHours || durationHours <= 0) {
      res.status(400).json({ status: "fail", message: "durationHours must be a positive number." });
      return;
    }

    // ── Build the activity document ──
    const activity = await Activity.create({
      host: hostId,
      name: name.trim(),
      summary: summary.trim(),
      description: description.trim(),
      activityType,
      difficulty,
      address: address.trim(),
      city: city.trim(),
      state: state.trim(),
      country: country?.trim() || "India",
      zipCode: zipCode.trim(),
      coordinates: { lat: coordinates.lat, lng: coordinates.lng },
      landmark: landmark?.trim() || undefined,
      meetingPoint: meetingPoint?.trim() || undefined,
      durationHours,
      durationDays: durationDays ?? 0,
      startTimes: startTimes ?? [],
      availability: availability ?? "Daily",
      availabilityNotes: availabilityNotes?.trim() || undefined,
      minAge: minAge ?? 0,
      maxGroupSize,
      minGroupSize: minGroupSize ?? 1,
      basePrice,
      weekendPrice: weekendPrice ?? undefined,
      childPrice: childPrice ?? undefined,
      foreignerPrice: foreignerPrice ?? undefined,
      seasonalPrices: seasonalPrices ?? [],
      taxes: taxes ?? 0,
      securityDeposit: securityDeposit ?? 0,
      equipmentProvided: equipmentProvided ?? [],
      equipmentRequired: equipmentRequired ?? [],
      safetyGuidelines: safetyGuidelines?.trim() || undefined,
      hasInsurance: hasInsurance ?? false,
      certifiedGuides: certifiedGuides ?? false,
      guideRatio: guideRatio?.trim() || undefined,
      included: included ?? [],
      excluded: excluded ?? [],
      houseRules: houseRules ?? [],
      cancellationPolicy: cancellationPolicy ?? "Moderate",
      cancellationDetails: cancellationDetails?.trim() || undefined,
      isPetFriendly: isPetFriendly ?? false,
      petRules: petRules?.trim() || undefined,
      restrictions: restrictions?.trim() || undefined,
      nearbyPlaces: nearbyPlaces ?? [],
      languagesSpoken: languagesSpoken ?? [],
      videoTourUrl: videoTourUrl?.trim() || undefined,
      instantBook: instantBook ?? true,
      advanceNoticeHours: advanceNoticeHours ?? 0,
      maxGuestsPerBooking: maxGuestsPerBooking ?? maxGroupSize,
      status: status ?? "draft",
    });

    res.status(201).json({
      status: "success",
      message: "Activity created successfully.",
      data: { activity },
    });
  } catch (error: any) {
    // Mongoose validation error
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e: any) => e.message);
      res.status(400).json({ status: "fail", message: messages.join("; ") });
      return;
    }
    next(error);
  }
};

// ──────────────────────── READ (All — Vendor's own) ────────────────────────

// @desc    Get all activities for the logged-in vendor
// @route   GET /api/activities
// @access  Private (Vendor / Dual Mode)
export const getMyActivities = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const hostId = req.user?.id || req.user?._id;
    const { status, page = "1", limit = "20" } = req.query;
    const filter: any = { host: hostId };
    if (status && ["draft", "published", "unlisted", "rejected"].includes(status as string)) {
      filter.status = status;
    }
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [activities, total] = await Promise.all([
      Activity.find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .select("-__v")
        .lean(),
      Activity.countDocuments(filter),
    ]);

    res.status(200).json({
      status: "success",
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      results: activities.length,
      data: { activities },
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── READ (Single) ────────────────────────

// @desc    Get a single activity by ID
// @route   GET /api/activities/:id
// @access  Private
export const getActivity = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const activity = await Activity.findById(req.params.id).select("-__v");
    if (!activity) {
      res.status(404).json({ status: "fail", message: "Activity not found." });
      return;
    }
    res.status(200).json({
      status: "success",
      data: { activity },
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── UPDATE ────────────────────────

// @desc    Update an activity
// @route   PUT /api/activities/:id
// @access  Private (Owner only)
export const updateActivity = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const hostId = req.user?.id || req.user?._id;
    const activity = await Activity.findById(req.params.id);

    if (!activity) {
      res.status(404).json({ status: "fail", message: "Activity not found." });
      return;
    }
    if (activity.host.toString() !== hostId) {
      res.status(403).json({ status: "fail", message: "You can only edit your own activities." });
      return;
    }

    // Allowed updatable fields
    const updatableFields = [
      "name", "summary", "description", "activityType", "difficulty",
      "address", "city", "state", "country", "zipCode", "coordinates", "landmark", "meetingPoint",
      "durationHours", "durationDays", "startTimes", "availability", "availabilityNotes",
      "minAge", "maxGroupSize", "minGroupSize",
      "basePrice", "weekendPrice", "childPrice", "foreignerPrice", "seasonalPrices",
      "taxes", "securityDeposit",
      "equipmentProvided", "equipmentRequired", "safetyGuidelines",
      "hasInsurance", "certifiedGuides", "guideRatio",
      "included", "excluded",
      "houseRules", "cancellationPolicy", "cancellationDetails",
      "isPetFriendly", "petRules", "restrictions",
      "nearbyPlaces", "languagesSpoken", "videoTourUrl",
      "instantBook", "advanceNoticeHours", "maxGuestsPerBooking",
      "status",
    ];

    for (const field of updatableFields) {
      if (req.body[field] !== undefined) {
        (activity as any)[field] = req.body[field];
      }
    }

    await activity.save();

    res.status(200).json({
      status: "success",
      message: "Activity updated successfully.",
      data: { activity },
    });
  } catch (error: any) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e: any) => e.message);
      res.status(400).json({ status: "fail", message: messages.join("; ") });
      return;
    }
    next(error);
  }
};

// ──────────────────────── DELETE ────────────────────────

// @desc    Delete an activity
// @route   DELETE /api/activities/:id
// @access  Private (Owner only)
export const deleteActivity = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const hostId = req.user?.id || req.user?._id;
    const activity = await Activity.findById(req.params.id);

    if (!activity) {
      res.status(404).json({ status: "fail", message: "Activity not found." });
      return;
    }
    if (activity.host.toString() !== hostId) {
      res.status(403).json({ status: "fail", message: "You can only delete your own activities." });
      return;
    }

    // Delete associated Cloudinary images
    if (activity.media && activity.media.length > 0) {
      const publicIds = activity.media.map((m) => m.publicId);
      if (publicIds.length > 0) {
        try {
          await cloudinary.api.delete_resources(publicIds, { resource_type: "image" });
        } catch (cloudErr) {
          console.warn("Cloudinary cleanup warning:", cloudErr);
          // Non-fatal — activity deletion proceeds
        }
      }
    }

    await activity.deleteOne();

    res.status(200).json({
      status: "success",
      message: "Activity deleted successfully.",
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── Upload Activity Media ────────────────────────

// @desc    Upload photos for an activity
// @route   POST /api/activities/:id/media
// @access  Private (Owner only)
export const uploadActivityMedia = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const hostId = req.user?.id || req.user?._id;
    const activity = await Activity.findById(req.params.id);

    if (!activity) {
      res.status(404).json({ status: "fail", message: "Activity not found." });
      return;
    }
    if (activity.host.toString() !== hostId) {
      res.status(403).json({ status: "fail", message: "You can only upload to your own activities." });
      return;
    }

    if (!req.files || (Array.isArray(req.files) && req.files.length === 0)) {
      res.status(400).json({ status: "fail", message: "No files uploaded." });
      return;
    }

    const files = Array.isArray(req.files) ? req.files : [req.files];
    const uploadedMedia: any[] = [];
    const maxPhotos = 15;

    // Check if we'd exceed max photos
    if (activity.media.length + files.length > maxPhotos) {
      res.status(400).json({
        status: "fail",
        message: `Cannot upload more than ${maxPhotos} photos total. Currently have ${activity.media.length}.`,
      });
      return;
    }

    for (const file of files) {
      // Validate magic bytes
      if (!file.buffer || file.buffer.length === 0) {
        res.status(400).json({ status: "fail", message: "One of the files is empty." });
        return;
      }

      if (!validateMagicBytes(file.buffer, file.mimetype)) {
        res.status(400).json({
          status: "fail",
          message: `${file.originalname}: file content does not match its declared type. Only JPEG, PNG, WebP, and PDF are accepted.`,
        });
        return;
      }

      const b64 = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
      const alreadyHasCover = activity.media.some((m: any) => m.isCover) || uploadedMedia.some((m: any) => m.isCover);
      const isCover = !alreadyHasCover && !req.body.isCover; // first photo auto-cover

      const uploaded = await cloudinary.uploader.upload(b64, {
        folder: `triptay/activities/${activity._id}`,
        resource_type: "image",
        quality: "auto:good",
        fetch_format: "auto",
      });

      const mediaItem = {
        url: uploaded.secure_url,
        publicId: uploaded.public_id,
        type: "photo" as const,
        caption: req.body.caption || undefined,
        isCover: req.body.isCover === "true" || isCover,
        order: activity.media.length + uploadedMedia.length,
      };

      uploadedMedia.push(mediaItem);
    }

    activity.media.push(...uploadedMedia);

    // If any image is explicitly marked as cover, unset others
    if (uploadedMedia.some((m) => m.isCover)) {
      activity.media.forEach((m: any, i: number) => {
        const wasJustUploaded = uploadedMedia.some((um) => um.publicId === m.publicId);
        if (!wasJustUploaded && m.isCover) {
          (activity.media as any)[i].isCover = false;
        }
      });
    }

    await activity.save();

    res.status(200).json({
      status: "success",
      message: `${uploadedMedia.length} photo(s) uploaded.`,
      data: { media: uploadedMedia, totalPhotos: activity.media.length },
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── Delete Activity Media ────────────────────────

// @desc    Delete a single media item from an activity
// @route   DELETE /api/activities/:id/media/:mediaId
// @access  Private (Owner only)
export const deleteActivityMedia = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const hostId = req.user?.id || req.user?._id;
    const activity = await Activity.findById(req.params.id);

    if (!activity) {
      res.status(404).json({ status: "fail", message: "Activity not found." });
      return;
    }
    if (activity.host.toString() !== hostId) {
      res.status(403).json({ status: "fail", message: "You can only modify your own activities." });
      return;
    }

    const mediaIndex = activity.media.findIndex(
      (m: any) => m._id.toString() === req.params.mediaId
    );

    if (mediaIndex === -1) {
      res.status(404).json({ status: "fail", message: "Media item not found." });
      return;
    }

    const mediaItem = activity.media[mediaIndex];
    if (!mediaItem) {
      res.status(404).json({ status: "fail", message: "Media item not found." });
      return;
    }

    // Delete from Cloudinary
    try {
      await cloudinary.uploader.destroy(mediaItem.publicId, { resource_type: "image" });
    } catch (cloudErr) {
      console.warn("Cloudinary delete warning:", cloudErr);
    }

    // Remove from array
    activity.media.splice(mediaIndex, 1);

    // If we deleted the cover, set first remaining as cover
    if (mediaItem.isCover && activity.media.length > 0 && activity.media[0]) {
      activity.media[0].isCover = true;
    }

    await activity.save();

    res.status(200).json({
      status: "success",
      message: "Media item removed.",
      data: { totalPhotos: activity.media.length },
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── PUBLIC: Browse Activities ────────────────────────

// @desc    Browse published activities (public facing)
// @route   GET /api/activities/browse
// @access  Public
export const browseActivities = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const {
      city, state, activityType, difficulty,
      minPrice, maxPrice,
      minDuration, maxDuration,
      minAge: ageFilter,
      sort = "-updatedAt",
      page = "1",
      limit = "20",
    } = req.query;

    const filter: any = { status: "published", isActive: true };

    if (city) filter.city = new RegExp(city as string, "i");
    if (state) filter.state = new RegExp(state as string, "i");
    if (activityType) filter.activityType = activityType;
    if (difficulty) filter.difficulty = difficulty;
    if (minPrice) filter.basePrice = { $gte: parseInt(minPrice as string, 10) };
    if (maxPrice) {
      filter.basePrice = { ...(filter.basePrice || {}), $lte: parseInt(maxPrice as string, 10) };
    }
    if (minDuration) filter.durationHours = { $gte: parseInt(minDuration as string, 10) };
    if (maxDuration) {
      filter.durationHours = { ...(filter.durationHours || {}), $lte: parseInt(maxDuration as string, 10) };
    }
    if (ageFilter) filter.minAge = { $lte: parseInt(ageFilter as string, 10) };

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [activities, total] = await Promise.all([
      Activity.find(filter)
        .sort(sort as string)
        .skip(skip)
        .limit(limitNum)
        .select("name slug summary activityType difficulty city state country basePrice weekendPrice childPrice foreignerPrice avgRating totalReviews media coordinates durationHours maxGroupSize minAge included instantBook")
        .lean(),
      Activity.countDocuments(filter),
    ]);

    // Attach computed effectiveWeekendPrice (virtual won't work on lean)
    const enriched = activities.map((a: any) => ({
      ...a,
      effectiveWeekendPrice: computeEffectiveWeekendPrice(a.basePrice, a.weekendPrice),
    }));

    res.status(200).json({
      status: "success",
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      results: enriched.length,
      data: { activities: enriched },
    });
  } catch (error) {
    next(error);
  }
};