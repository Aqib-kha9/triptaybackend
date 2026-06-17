import type { Request, Response, NextFunction } from "express";
import { prisma } from "../config/db.js";
import cloudinary from "../config/cloudinary.js";
import { validateMagicBytes } from "../utils/validateMagicBytes.js";

// ──────────────────────── Helper: Get effective weekend price ────────────────────────

const computeEffectiveWeekendPrice = (base: number, weekend?: number): number => {
  if (weekend && weekend > 0) return weekend;
  return Math.round(base * 1.3);
};

// ─── Helper: auto-generate slug from name ───
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ─── Helper: ensure unique slug ───
async function ensureUniqueActivitySlug(baseSlug: string, excludeId?: string): Promise<string> {
  let slug = baseSlug;
  let counter = 1;
  while (true) {
    const existing = await prisma.activity.findFirst({
      where: {
        slug,
        id: excludeId ? { not: excludeId } : undefined,
      },
    });
    if (!existing) break;
    slug = `${baseSlug}-${counter}`;
    counter++;
  }
  return slug;
}

// Helper to map flat database lat/lng to frontend-compatible coordinates object
function mapActivityResponse(a: any) {
  if (!a) return null;
  const mapped = {
    ...a,
    _id: a.id,
    host: a.hostId,
    coordinates: {
      lat: a.lat,
      lng: a.lng,
    },
  };
  delete mapped.lat;
  delete mapped.lng;
  return mapped;
}

const populateHostForActivity = async (activity: any) => {
  if (!activity) return null;
  const host = await prisma.user.findUnique({
    where: { id: activity.hostId },
    select: { id: true, name: true, avatar: true, email: true, phone: true }
  });
  const mapped = mapActivityResponse(activity);
  if (mapped) {
    mapped.host = host ? { _id: host.id, id: host.id, name: host.name, avatar: host.avatar, email: host.email, phone: host.phone } : null;
  }
  return mapped;
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

    const baseSlug = generateSlug(name);
    const slug = await ensureUniqueActivitySlug(baseSlug);

    // ── Build the activity document ──
    const activity = await prisma.activity.create({
      data: {
        hostId,
        name: name.trim(),
        slug,
        summary: summary.trim(),
        description: description.trim(),
        activityType,
        difficulty,
        address: address.trim(),
        city: city.trim(),
        state: state.trim(),
        country: country?.trim() || "India",
        zipCode: zipCode.trim(),
        lat: Number(coordinates.lat),
        lng: Number(coordinates.lng),
        landmark: landmark?.trim() || null,
        meetingPoint: meetingPoint?.trim() || null,
        durationHours: Number(durationHours),
        durationDays: durationDays !== undefined ? Number(durationDays) : 0,
        startTimes: startTimes || [],
        availability: availability || "Daily",
        availabilityNotes: availabilityNotes?.trim() || null,
        minAge: minAge !== undefined ? Number(minAge) : 0,
        maxGroupSize: Number(maxGroupSize),
        minGroupSize: minGroupSize !== undefined ? Number(minGroupSize) : 1,
        basePrice: Number(basePrice),
        weekendPrice: weekendPrice !== undefined ? Number(weekendPrice) : null,
        childPrice: childPrice !== undefined ? Number(childPrice) : null,
        foreignerPrice: foreignerPrice !== undefined ? Number(foreignerPrice) : null,
        seasonalPrices: seasonalPrices || null,
        taxes: taxes !== undefined ? Number(taxes) : 0,
        securityDeposit: securityDeposit !== undefined ? Number(securityDeposit) : 0,
        equipmentProvided: equipmentProvided || [],
        equipmentRequired: equipmentRequired || [],
        safetyGuidelines: safetyGuidelines?.trim() || null,
        hasInsurance: hasInsurance ?? false,
        certifiedGuides: certifiedGuides ?? false,
        guideRatio: guideRatio?.trim() || null,
        included: included || [],
        excluded: excluded || [],
        houseRules: houseRules || null,
        cancellationPolicy: cancellationPolicy || "Moderate",
        cancellationDetails: cancellationDetails?.trim() || null,
        isPetFriendly: isPetFriendly ?? false,
        petRules: petRules?.trim() || null,
        restrictions: restrictions?.trim() || null,
        nearbyPlaces: nearbyPlaces || null,
        languagesSpoken: languagesSpoken || [],
        videoTourUrl: videoTourUrl?.trim() || null,
        instantBook: instantBook ?? true,
        advanceNoticeHours: advanceNoticeHours !== undefined ? Number(advanceNoticeHours) : 0,
        maxGuestsPerBooking: maxGuestsPerBooking !== undefined ? Number(maxGuestsPerBooking) : Number(maxGroupSize),
        status: status || "draft",
        media: [],
      }
    });

    res.status(201).json({
      status: "success",
      message: "Activity created successfully.",
      data: { activity: mapActivityResponse(activity) },
    });
  } catch (error: any) {
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
    const filter: any = { hostId };
    if (status && ["draft", "published", "unlisted", "rejected"].includes(status as string)) {
      filter.status = status;
    }
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [activities, total] = await Promise.all([
      prisma.activity.findMany({
        where: filter,
        orderBy: { updatedAt: "desc" },
        skip,
        take: limitNum,
      }),
      prisma.activity.count({ where: filter }),
    ]);

    const mappedActivities = activities.map(mapActivityResponse);

    res.status(200).json({
      status: "success",
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      results: mappedActivities.length,
      data: { activities: mappedActivities },
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
    const activity = await prisma.activity.findUnique({
      where: { id: req.params.id }
    });
    if (!activity) {
      res.status(404).json({ status: "fail", message: "Activity not found." });
      return;
    }
    res.status(200).json({
      status: "success",
      data: { activity: mapActivityResponse(activity) },
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
    const activity = await prisma.activity.findUnique({
      where: { id: req.params.id }
    });

    if (!activity) {
      res.status(404).json({ status: "fail", message: "Activity not found." });
      return;
    }
    if (activity.hostId !== hostId) {
      res.status(403).json({ status: "fail", message: "You can only edit your own activities." });
      return;
    }

    // Allowed updatable fields
    const updatableFields = [
      "name", "summary", "description", "activityType", "difficulty",
      "address", "city", "state", "country", "zipCode", "landmark", "meetingPoint",
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

    const updateData: any = {};
    for (const field of updatableFields) {
      if (req.body[field] !== undefined) {
        if (field === "coordinates") {
          updateData.lat = Number(req.body.coordinates.lat);
          updateData.lng = Number(req.body.coordinates.lng);
        } else if (["durationHours", "durationDays", "minAge", "maxGroupSize", "minGroupSize", "basePrice", "weekendPrice", "childPrice", "foreignerPrice", "taxes", "securityDeposit", "advanceNoticeHours", "maxGuestsPerBooking"].includes(field)) {
          updateData[field] = req.body[field] !== null ? Number(req.body[field]) : null;
        } else {
          updateData[field] = req.body[field];
        }
      }
    }

    if (req.body.name && req.body.name.trim() !== activity.name) {
      const baseSlug = generateSlug(req.body.name);
      updateData.slug = await ensureUniqueActivitySlug(baseSlug, activity.id);
    }

    const updated = await prisma.activity.update({
      where: { id: req.params.id },
      data: updateData,
    });

    res.status(200).json({
      status: "success",
      message: "Activity updated successfully.",
      data: { activity: mapActivityResponse(updated) },
    });
  } catch (error: any) {
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
    const activity = await prisma.activity.findUnique({
      where: { id: req.params.id }
    });

    if (!activity) {
      res.status(404).json({ status: "fail", message: "Activity not found." });
      return;
    }
    if (activity.hostId !== hostId) {
      res.status(403).json({ status: "fail", message: "You can only delete your own activities." });
      return;
    }

    // Delete associated Cloudinary images
    const mediaArray = activity.media && Array.isArray(activity.media) ? activity.media : [];
    if (mediaArray.length > 0) {
      const publicIds = mediaArray.map((m: any) => m.publicId).filter(Boolean);
      if (publicIds.length > 0) {
        try {
          await cloudinary.api.delete_resources(publicIds, { resource_type: "image" });
        } catch (cloudErr) {
          console.warn("Cloudinary cleanup warning:", cloudErr);
        }
      }
    }

    await prisma.activity.delete({
      where: { id: req.params.id }
    });

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
    const activity = await prisma.activity.findUnique({
      where: { id: req.params.id }
    });

    if (!activity) {
      res.status(404).json({ status: "fail", message: "Activity not found." });
      return;
    }
    if (activity.hostId !== hostId) {
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
    const existingMedia = Array.isArray(activity.media) ? activity.media : [];

    // Check if we'd exceed max photos
    if (existingMedia.length + files.length > maxPhotos) {
      res.status(400).json({
        status: "fail",
        message: `Cannot upload more than ${maxPhotos} photos total. Currently have ${existingMedia.length}.`,
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
      const alreadyHasCover = existingMedia.some((m: any) => m.isCover) || uploadedMedia.some((m: any) => m.isCover);
      const isCover = !alreadyHasCover && !req.body.isCover; // first photo auto-cover

      const uploaded = await cloudinary.uploader.upload(b64, {
        folder: `triptay/activities/${activity.id}`,
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
        order: existingMedia.length + uploadedMedia.length,
      };

      uploadedMedia.push(mediaItem);
    }

    const newMedia = [...existingMedia, ...uploadedMedia];

    // If any image is explicitly marked as cover, unset others
    if (uploadedMedia.some((m) => m.isCover)) {
      newMedia.forEach((m: any, i) => {
        const wasJustUploaded = uploadedMedia.some((um) => um.publicId === m.publicId);
        if (!wasJustUploaded && m.isCover) {
          newMedia[i].isCover = false;
        }
      });
    }

    await prisma.activity.update({
      where: { id: req.params.id },
      data: { media: newMedia }
    });

    res.status(200).json({
      status: "success",
      message: `${uploadedMedia.length} photo(s) uploaded.`,
      data: { media: uploadedMedia, totalPhotos: newMedia.length },
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
    const activity = await prisma.activity.findUnique({
      where: { id: req.params.id }
    });

    if (!activity) {
      res.status(404).json({ status: "fail", message: "Activity not found." });
      return;
    }
    if (activity.hostId !== hostId) {
      res.status(403).json({ status: "fail", message: "You can only modify your own activities." });
      return;
    }

    const existingMedia = Array.isArray(activity.media) ? [...activity.media] : [];
    const mediaIndex = existingMedia.findIndex(
      (m: any) => m._id?.toString() === req.params.mediaId || m.publicId === req.params.mediaId
    );

    if (mediaIndex === -1) {
      res.status(404).json({ status: "fail", message: "Media item not found." });
      return;
    }

    const mediaItem: any = existingMedia[mediaIndex];

    // Delete from Cloudinary
    try {
      await cloudinary.uploader.destroy(mediaItem.publicId, { resource_type: "image" });
    } catch (cloudErr) {
      console.warn("Cloudinary delete warning:", cloudErr);
    }

    // Remove from array
    existingMedia.splice(mediaIndex, 1);

    // If we deleted the cover, set first remaining as cover
    if (mediaItem.isCover && existingMedia.length > 0 && existingMedia[0]) {
      (existingMedia[0] as any).isCover = true;
    }

    await prisma.activity.update({
      where: { id: req.params.id },
      data: { media: existingMedia }
    });

    res.status(200).json({
      status: "success",
      message: "Media item removed.",
      data: { totalPhotos: existingMedia.length },
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

    if (city) filter.city = { contains: city as string, mode: "insensitive" };
    if (state) filter.state = { contains: state as string, mode: "insensitive" };
    if (activityType) filter.activityType = activityType;
    if (difficulty) filter.difficulty = difficulty;
    if (minPrice) filter.basePrice = { gte: parseInt(minPrice as string, 10) };
    if (maxPrice) {
      filter.basePrice = { ...(filter.basePrice || {}), lte: parseInt(maxPrice as string, 10) };
    }
    if (minDuration) filter.durationHours = { gte: parseInt(minDuration as string, 10) };
    if (maxDuration) {
      filter.durationHours = { ...(filter.durationHours || {}), lte: parseInt(maxDuration as string, 10) };
    }
    if (ageFilter) filter.minAge = { lte: parseInt(ageFilter as string, 10) };

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const sortField = (sort as string).startsWith("-") ? (sort as string).substring(1) : (sort as string);
    const sortOrder = (sort as string).startsWith("-") ? "desc" : "asc";
    const orderBy = { [sortField]: sortOrder };

    const [activities, total] = await Promise.all([
      prisma.activity.findMany({
        where: filter,
        orderBy,
        skip,
        take: limitNum,
      }),
      prisma.activity.count({ where: filter }),
    ]);

    const mappedActivities = activities.map(mapActivityResponse);

    // Attach computed effective weekend price
    const enriched = mappedActivities.map((a: any) => ({
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

// ──────────────────────── PUBLIC: Get Single Activity ────────────────────────

// @desc    Get a single published activity by slug or ID (public facing)
// @route   GET /api/public/activity/:slug
// @access  Public
export const getPublicActivity = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { slug } = req.params;

    // 1) Try by slug first
    let activity = await prisma.activity.findFirst({
      where: { slug, status: "published", isActive: true }
    });

    // 2) Fallback: try by id
    if (!activity) {
      try {
        activity = await prisma.activity.findFirst({
          where: { id: slug, status: "published", isActive: true }
        });
      } catch {
        // invalid ID string → ignore
      }
    }

    if (!activity) {
      res.status(404).json({ status: "fail", message: "Activity not found." });
      return;
    }

    const enriched = await populateHostForActivity(activity);
    if (enriched) {
      (enriched as any).effectiveWeekendPrice = computeEffectiveWeekendPrice(
        (enriched as any).basePrice,
        (enriched as any).weekendPrice
      );
    }

    res.status(200).json({
      status: "success",
      data: { activity: enriched },
    });
  } catch (error) {
    next(error);
  }
};