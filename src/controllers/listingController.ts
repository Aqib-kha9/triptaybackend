import type { Request, Response, NextFunction } from "express";
import { Listing } from "../models/Listing.js";
import { Activity } from "../models/Activity.js";
import cloudinary from "../config/cloudinary.js";
import { validateMagicBytes } from "../utils/validateMagicBytes.js";

// ──────────────────────── Helper: Get effective weekend price ────────────────────────

const computeEffectiveWeekendPrice = (base: number, weekend?: number): number => {
  if (weekend && weekend > 0) return weekend;
  return Math.round(base * 1.3);
};

// ──────────────────────── CREATE ────────────────────────

// @desc    Create a new listing
// @route   POST /api/listings
// @access  Private (Vendor / Dual Mode)
export const createListing = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const hostId = req.user?.id || req.user?._id;
    if (!hostId) {
      res.status(401).json({ status: "fail", message: "Authentication required." });
      return;
    }

    const {
      name, summary, description, propertyType, floorNumber, totalFloors,
      propertySizeSqFt, yearBuilt, isEntirePlace,
      address, city, state, country, zipCode, coordinates, landmark,
      maxGuests, bedrooms, beds, bathrooms, extraMattresses,
      basePrice, weekendPrice, seasonalPrices,
      cleaningFee, securityDeposit, extraGuestPrice, taxes,
      minStay, maxStay, checkInTime, checkOutTime,
      flexibleCheckIn, flexibleCheckOut,
      amenities, meals, hasKitchen, kitchenDetails,
      houseRules, cancellationPolicy, cancellationDetails,
      isPetFriendly, petRules, isSmokingAllowed, isPartyAllowed,
      quietHoursStart, quietHoursEnd,
      nearbyPlaces, languagesSpoken,
      instantBook, advanceNoticeHours, maxGuestsPerBooking,
      status,
    } = req.body;

    // ── Validate required core fields ──
    const requiredFields: Record<string, any> = { name, summary, description, propertyType, address, city, state, country, zipCode };
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

    if (!maxGuests || maxGuests < 1) {
      res.status(400).json({ status: "fail", message: "maxGuests must be at least 1." });
      return;
    }

    // ── Build the listing document ──
    const listing = await Listing.create({
      host: hostId,
      name: name.trim(),
      summary: summary.trim(),
      description: description.trim(),
      propertyType,
      floorNumber: floorNumber ?? undefined,
      totalFloors: totalFloors ?? undefined,
      propertySizeSqFt: propertySizeSqFt ?? undefined,
      yearBuilt: yearBuilt ?? undefined,
      isEntirePlace: isEntirePlace ?? true,
      address: address.trim(),
      city: city.trim(),
      state: state.trim(),
      country: country?.trim() || "India",
      zipCode: zipCode.trim(),
      coordinates: { lat: coordinates.lat, lng: coordinates.lng },
      landmark: landmark?.trim() || undefined,
      maxGuests,
      bedrooms: bedrooms ?? 1,
      beds: beds ?? 1,
      bathrooms: bathrooms ?? 1,
      extraMattresses: extraMattresses ?? 0,
      basePrice,
      weekendPrice: weekendPrice ?? undefined,
      seasonalPrices: seasonalPrices ?? [],
      cleaningFee: cleaningFee ?? 0,
      securityDeposit: securityDeposit ?? 0,
      extraGuestPrice: extraGuestPrice ?? 0,
      taxes: taxes ?? 0,
      minStay: minStay ?? 1,
      maxStay: maxStay ?? 0,
      checkInTime: checkInTime ?? "12:00 PM",
      checkOutTime: checkOutTime ?? "11:00 AM",
      flexibleCheckIn: flexibleCheckIn ?? false,
      flexibleCheckOut: flexibleCheckOut ?? false,
      amenities: amenities ?? [],
      meals: meals ?? [],
      hasKitchen: hasKitchen ?? false,
      kitchenDetails: kitchenDetails?.trim() || undefined,
      houseRules: houseRules ?? [],
      cancellationPolicy: cancellationPolicy ?? "Moderate",
      cancellationDetails: cancellationDetails?.trim() || undefined,
      isPetFriendly: isPetFriendly ?? false,
      petRules: petRules?.trim() || undefined,
      isSmokingAllowed: isSmokingAllowed ?? false,
      isPartyAllowed: isPartyAllowed ?? false,
      quietHoursStart: quietHoursStart ?? undefined,
      quietHoursEnd: quietHoursEnd ?? undefined,
      nearbyPlaces: nearbyPlaces ?? [],
      languagesSpoken: languagesSpoken ?? [],
      instantBook: instantBook ?? true,
      advanceNoticeHours: advanceNoticeHours ?? 0,
      maxGuestsPerBooking: maxGuestsPerBooking ?? maxGuests,
      status: status ?? "draft",
    });

    res.status(201).json({
      status: "success",
      message: "Listing created successfully.",
      data: { listing },
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

// @desc    Get all listings for the logged-in vendor
// @route   GET /api/listings
// @access  Private (Vendor / Dual Mode)
export const getMyListings = async (req: any, res: Response, next: NextFunction): Promise<void> => {
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

    const [listings, total] = await Promise.all([
      Listing.find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .select("-__v")
        .lean(),
      Listing.countDocuments(filter),
    ]);

    res.status(200).json({
      status: "success",
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      results: listings.length,
      data: { listings },
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── READ (Single) ────────────────────────

// @desc    Get a single listing by ID (owner or admin only for sensitive fields)
// @route   GET /api/listings/:id
// @access  Private
export const getListing = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const listing = await Listing.findById(req.params.id).select("-__v");
    if (!listing) {
      res.status(404).json({ status: "fail", message: "Listing not found." });
      return;
    }
    res.status(200).json({
      status: "success",
      data: { listing },
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── UPDATE ────────────────────────

// @desc    Update a listing
// @route   PUT /api/listings/:id
// @access  Private (Owner only)
export const updateListing = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const hostId = req.user?.id || req.user?._id;
    const listing = await Listing.findById(req.params.id);

    if (!listing) {
      res.status(404).json({ status: "fail", message: "Listing not found." });
      return;
    }
    if (listing.host.toString() !== hostId) {
      res.status(403).json({ status: "fail", message: "You can only edit your own listings." });
      return;
    }

    // Allowed updatable fields
    const updatableFields = [
      "name", "summary", "description", "propertyType", "floorNumber", "totalFloors",
      "propertySizeSqFt", "yearBuilt", "isEntirePlace",
      "address", "city", "state", "country", "zipCode", "coordinates", "landmark",
      "maxGuests", "bedrooms", "beds", "bathrooms", "extraMattresses",
      "basePrice", "weekendPrice", "seasonalPrices",
      "cleaningFee", "securityDeposit", "extraGuestPrice", "taxes",
      "minStay", "maxStay", "checkInTime", "checkOutTime",
      "flexibleCheckIn", "flexibleCheckOut",
      "amenities", "meals", "hasKitchen", "kitchenDetails",
      "houseRules", "cancellationPolicy", "cancellationDetails",
      "isPetFriendly", "petRules", "isSmokingAllowed", "isPartyAllowed",
      "quietHoursStart", "quietHoursEnd",
      "nearbyPlaces", "languagesSpoken",
      "instantBook", "advanceNoticeHours", "maxGuestsPerBooking",
      "status", "videoTourUrl",
    ];

    for (const field of updatableFields) {
      if (req.body[field] !== undefined) {
        (listing as any)[field] = req.body[field];
      }
    }

    await listing.save();

    res.status(200).json({
      status: "success",
      message: "Listing updated successfully.",
      data: { listing },
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

// @desc    Delete a listing
// @route   DELETE /api/listings/:id
// @access  Private (Owner only)
export const deleteListing = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const hostId = req.user?.id || req.user?._id;
    const listing = await Listing.findById(req.params.id);

    if (!listing) {
      res.status(404).json({ status: "fail", message: "Listing not found." });
      return;
    }
    if (listing.host.toString() !== hostId) {
      res.status(403).json({ status: "fail", message: "You can only delete your own listings." });
      return;
    }

    // Delete associated Cloudinary images
    if (listing.media && listing.media.length > 0) {
      const publicIds = listing.media.map((m) => m.publicId);
      if (publicIds.length > 0) {
        try {
          await cloudinary.api.delete_resources(publicIds, { resource_type: "image" });
        } catch (cloudErr) {
          console.warn("Cloudinary cleanup warning:", cloudErr);
          // Non-fatal — listing deletion proceeds
        }
      }
    }

    await listing.deleteOne();

    res.status(200).json({
      status: "success",
      message: "Listing deleted successfully.",
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── Upload Listing Image ────────────────────────

// @desc    Upload a photo for a listing
// @route   POST /api/listings/:id/media
// @access  Private (Owner only)
export const uploadListingMedia = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const hostId = req.user?.id || req.user?._id;
    const listing = await Listing.findById(req.params.id);

    if (!listing) {
      res.status(404).json({ status: "fail", message: "Listing not found." });
      return;
    }
    if (listing.host.toString() !== hostId) {
      res.status(403).json({ status: "fail", message: "You can only upload to your own listings." });
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
    if (listing.media.length + files.length > maxPhotos) {
      res.status(400).json({
        status: "fail",
        message: `Cannot upload more than ${maxPhotos} photos total. Currently have ${listing.media.length}.`,
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
      const alreadyHasCover = listing.media.some((m: any) => m.isCover) || uploadedMedia.some((m: any) => m.isCover);
      const isCover = !alreadyHasCover && !req.body.isCover; // first photo auto-cover

      const uploaded = await cloudinary.uploader.upload(b64, {
        folder: `triptay/listings/${listing._id}`,
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
        order: listing.media.length + uploadedMedia.length,
      };

      uploadedMedia.push(mediaItem);
    }

    listing.media.push(...uploadedMedia);

    // If any image is explicitly marked as cover, unset others
    if (uploadedMedia.some((m) => m.isCover)) {
      listing.media.forEach((m, i) => {
        const wasJustUploaded = uploadedMedia.some((um) => um.publicId === m.publicId);
        if (!wasJustUploaded && m.isCover) {
          listing.media[i].isCover = false;
        }
      });
    }

    await listing.save();

    res.status(200).json({
      status: "success",
      message: `${uploadedMedia.length} photo(s) uploaded.`,
      data: { media: uploadedMedia, totalPhotos: listing.media.length },
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── Delete Listing Image ────────────────────────

// @desc    Delete a single media item from a listing
// @route   DELETE /api/listings/:id/media/:mediaId
// @access  Private (Owner only)
export const deleteListingMedia = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const hostId = req.user?.id || req.user?._id;
    const listing = await Listing.findById(req.params.id);

    if (!listing) {
      res.status(404).json({ status: "fail", message: "Listing not found." });
      return;
    }
    if (listing.host.toString() !== hostId) {
      res.status(403).json({ status: "fail", message: "You can only modify your own listings." });
      return;
    }

    const mediaIndex = listing.media.findIndex(
      (m: any) => m._id.toString() === req.params.mediaId
    );

    if (mediaIndex === -1) {
      res.status(404).json({ status: "fail", message: "Media item not found." });
      return;
    }

    const mediaItem = listing.media[mediaIndex];

    // Delete from Cloudinary
    try {
      await cloudinary.uploader.destroy(mediaItem.publicId, { resource_type: "image" });
    } catch (cloudErr) {
      console.warn("Cloudinary delete warning:", cloudErr);
    }

    // Remove from array
    listing.media.splice(mediaIndex, 1);

    // If we deleted the cover, set first remaining as cover
    if (mediaItem.isCover && listing.media.length > 0) {
      listing.media[0].isCover = true;
    }

    await listing.save();

    res.status(200).json({
      status: "success",
      message: "Media item removed.",
      data: { totalPhotos: listing.media.length },
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── PUBLIC: Browse listings ────────────────────────

// @desc    Browse published listings (public facing)
// @route   GET /api/listings/browse
// @access  Public
export const browseListings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const {
      city, state, propertyType, minPrice, maxPrice,
      guests, bedrooms, bathrooms,
      amenities: amenityFilter,
      sort = "-updatedAt",
      page = "1",
      limit = "20",
    } = req.query;

    const filter: any = { status: "published", isActive: true };

    if (city) filter.city = new RegExp(city as string, "i");
    if (state) filter.state = new RegExp(state as string, "i");
    if (propertyType) filter.propertyType = propertyType;
    if (minPrice) filter.basePrice = { $gte: parseInt(minPrice as string, 10) };
    if (maxPrice) {
      filter.basePrice = { ...(filter.basePrice || {}), $lte: parseInt(maxPrice as string, 10) };
    }
    if (guests) filter.maxGuests = { $gte: parseInt(guests as string, 10) };
    if (bedrooms) filter.bedrooms = { $gte: parseInt(bedrooms as string, 10) };
    if (bathrooms) filter.bathrooms = { $gte: parseInt(bathrooms as string, 10) };
    if (amenityFilter) {
      const amenitiesList = (amenityFilter as string).split(",").map((a) => a.trim());
      filter.amenities = { $all: amenitiesList };
    }

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [listings, total] = await Promise.all([
      Listing.find(filter)
        .sort(sort as string)
        .skip(skip)
        .limit(limitNum)
        .select("name slug summary propertyType city state country basePrice weekendPrice avgRating totalReviews media coordinates maxGuests bedrooms bathrooms amenities isPetFriendly instantBook")
        .lean(),
      Listing.countDocuments(filter),
    ]);

    // Attach computed effectiveWeekendPrice (virtual won't work on lean)
    const enriched = listings.map((l: any) => ({
      ...l,
      effectiveWeekendPrice: l.weekendPrice && l.weekendPrice > 0 ? l.weekendPrice : Math.round(l.basePrice * 1.3),
    }));

    res.status(200).json({
      status: "success",
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      results: enriched.length,
      data: { listings: enriched },
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── PUBLIC LISTING BY SLUG ────────────────────────

// @desc    Get a single published listing by slug (or _id) for public detail page
// @route   GET /api/public/listing/:slug
// @access  Public
export const getPublicListing = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { slug } = req.params;

    // 1) Try by slug first
    let listing = await Listing.findOne({ slug, status: "published", isActive: true })
      .populate("host", "name avatar email phone")
      .select("-__v")
      .lean();

    // 2) Fallback: try by _id (ObjectId)
    if (!listing) {
      try {
        listing = await Listing.findOne({ _id: slug, status: "published", isActive: true })
          .populate("host", "name avatar email phone")
          .select("-__v")
          .lean();
      } catch {
        // invalid ObjectId string → ignore
      }
    }

    if (!listing) {
      res.status(404).json({ status: "fail", message: "Stay not found." });
      return;
    }

    // Attach computed effectiveWeekendPrice
    const enriched = {
      ...listing,
      effectiveWeekendPrice:
        (listing as any).weekendPrice && (listing as any).weekendPrice > 0
          ? (listing as any).weekendPrice
          : Math.round((listing as any).basePrice * 1.3),
    };

    res.status(200).json({
      status: "success",
      data: { listing: enriched },
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── LOCATION SUGGESTIONS ────────────────────────

// @desc    Get unique city suggestions from listings + activities for autocomplete
// @route   GET /api/locations/suggest
// @access  Public
export const locationSuggestions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { q = "" } = req.query;
    const query = (q as string).trim();

    if (!query || query.length < 1) {
      res.status(200).json({ status: "success", data: { suggestions: [] } });
      return;
    }

    const regex = new RegExp(query, "i");

    const [listingCities, activityCities] = await Promise.all([
      Listing.distinct("city", { status: "published", isActive: true, city: regex }),
      Activity.distinct("city", { status: "published", isActive: true, city: regex }),
    ]);

    // Merge, deduplicate, sort, limit
    const merged = [...new Set([...listingCities, ...activityCities])]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 8);

    res.status(200).json({
      status: "success",
      data: { suggestions: merged },
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── NEARBY BROWSE ────────────────────────

// @desc    Browse listings + activities near a given lat/lng
// @route   GET /api/nearby/browse
// @access  Public

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function boundingBox(lat: number, lng: number, radiusKm: number) {
  const latDelta = radiusKm / 111.32; // 1 degree lat ≈ 111.32 km
  const lngDelta = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}

export const browseNearby = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    const radius = Math.min(100, Math.max(1, parseInt(req.query.radius as string, 10) || 50)); // km, clamped 1–100
    const limit = Math.min(40, Math.max(1, parseInt(req.query.limit as string, 10) || 20));

    if (isNaN(lat) || isNaN(lng)) {
      res.status(400).json({ status: "fail", message: "lat and lng query parameters are required." });
      return;
    }

    const box = boundingBox(lat, lng, radius);

    const listingFilter = {
      status: "published",
      isActive: true,
      "coordinates.lat": { $gte: box.minLat, $lte: box.maxLat },
      "coordinates.lng": { $gte: box.minLng, $lte: box.maxLng },
    };

    const activityFilter = {
      status: "published",
      isActive: true,
      "coordinates.lat": { $gte: box.minLat, $lte: box.maxLat },
      "coordinates.lng": { $gte: box.minLng, $lte: box.maxLng },
    };

    const [rawListings, rawActivities] = await Promise.all([
      Listing.find(listingFilter)
        .select("name slug summary propertyType city state country basePrice weekendPrice avgRating totalReviews media coordinates maxGuests bedrooms bathrooms amenities isPetFriendly instantBook")
        .lean(),
      Activity.find(activityFilter)
        .select("name slug summary activityType difficulty city state country basePrice weekendPrice childPrice avgRating totalReviews media coordinates durationHours maxGroupSize minAge included instantBook")
        .lean(),
    ]);

    // Compute distance & enrich
    const listingsWithDist = rawListings.map((l: any) => ({
      _id: l._id,
      name: l.name,
      slug: l.slug,
      summary: l.summary,
      type: "listing" as const,
      subtype: l.propertyType,
      city: l.city,
      state: l.state,
      country: l.country,
      media: l.media,
      avgRating: l.avgRating,
      totalReviews: l.totalReviews,
      maxGuests: l.maxGuests,
      bedrooms: l.bedrooms,
      bathrooms: l.bathrooms,
      amenities: l.amenities,
      isPetFriendly: l.isPetFriendly,
      instantBook: l.instantBook,
      price: l.basePrice,
      effectiveWeekendPrice: l.weekendPrice && l.weekendPrice > 0 ? l.weekendPrice : Math.round(l.basePrice * 1.3),
      distanceKm: parseFloat(haversineKm(lat, lng, l.coordinates.lat, l.coordinates.lng).toFixed(2)),
    }));

    const activitiesWithDist = rawActivities.map((a: any) => ({
      _id: a._id,
      name: a.name,
      slug: a.slug,
      summary: a.summary,
      type: "activity" as const,
      subtype: a.activityType,
      difficulty: a.difficulty,
      city: a.city,
      state: a.state,
      country: a.country,
      media: a.media,
      avgRating: a.avgRating,
      totalReviews: a.totalReviews,
      durationHours: a.durationHours,
      maxGroupSize: a.maxGroupSize,
      minAge: a.minAge,
      included: a.included,
      instantBook: a.instantBook,
      price: a.basePrice,
      effectiveWeekendPrice: a.weekendPrice && a.weekendPrice > 0 ? a.weekendPrice : Math.round(a.basePrice * 1.3),
      distanceKm: parseFloat(haversineKm(lat, lng, a.coordinates.lat, a.coordinates.lng).toFixed(2)),
    }));

    // Merge, filter by radius, sort by distance, limit
    const merged = [...listingsWithDist, ...activitiesWithDist]
      .filter((item) => item.distanceKm <= radius)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, limit);

    res.status(200).json({
      status: "success",
      total: merged.length,
      radius,
      center: { lat, lng },
      results: merged.length,
      data: { items: merged },
    });
  } catch (error) {
    next(error);
  }
};