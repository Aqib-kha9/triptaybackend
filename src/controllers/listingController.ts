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
async function ensureUniqueListingSlug(baseSlug: string, excludeId?: string): Promise<string> {
  let slug = baseSlug;
  let counter = 1;
  while (true) {
    const existing = await prisma.listing.findFirst({
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
function mapListingResponse(l: any) {
  if (!l) return null;
  const mapped = {
    ...l,
    _id: l.id,
    host: l.hostId,
    coordinates: {
      lat: l.lat,
      lng: l.lng,
    },
  };
  delete mapped.lat;
  delete mapped.lng;
  return mapped;
}

const populateHostForListing = async (listing: any) => {
  if (!listing) return null;
  const host = await prisma.user.findUnique({
    where: { id: listing.hostId },
    select: { id: true, name: true, avatar: true, email: true, phone: true }
  });
  const mapped = mapListingResponse(listing);
  if (mapped) {
    mapped.host = host ? { _id: host.id, id: host.id, name: host.name, avatar: host.avatar, email: host.email, phone: host.phone } : null;
  }
  return mapped;
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

    const baseSlug = generateSlug(name);
    const slug = await ensureUniqueListingSlug(baseSlug);

    // ── Build the listing document ──
    const listing = await prisma.listing.create({
      data: {
        hostId,
        name: name.trim(),
        slug,
        summary: summary.trim(),
        description: description.trim(),
        propertyType,
        floorNumber: floorNumber !== undefined ? Number(floorNumber) : null,
        totalFloors: totalFloors !== undefined ? Number(totalFloors) : null,
        propertySizeSqFt: propertySizeSqFt !== undefined ? Number(propertySizeSqFt) : null,
        yearBuilt: yearBuilt !== undefined ? Number(yearBuilt) : null,
        isEntirePlace: isEntirePlace ?? true,
        address: address.trim(),
        city: city.trim(),
        state: state.trim(),
        country: country?.trim() || "India",
        zipCode: zipCode.trim(),
        lat: Number(coordinates.lat),
        lng: Number(coordinates.lng),
        landmark: landmark?.trim() || null,
        maxGuests: Number(maxGuests),
        bedrooms: bedrooms !== undefined ? Number(bedrooms) : 1,
        beds: beds !== undefined ? Number(beds) : 1,
        bathrooms: bathrooms !== undefined ? Number(bathrooms) : 1,
        extraMattresses: extraMattresses !== undefined ? Number(extraMattresses) : 0,
        basePrice: Number(basePrice),
        weekendPrice: weekendPrice !== undefined ? Number(weekendPrice) : null,
        seasonalPrices: seasonalPrices || null,
        cleaningFee: cleaningFee !== undefined ? Number(cleaningFee) : 0,
        securityDeposit: securityDeposit !== undefined ? Number(securityDeposit) : 0,
        extraGuestPrice: extraGuestPrice !== undefined ? Number(extraGuestPrice) : 0,
        taxes: taxes !== undefined ? Number(taxes) : 0,
        minStay: minStay !== undefined ? Number(minStay) : 1,
        maxStay: maxStay !== undefined ? Number(maxStay) : 0,
        checkInTime: checkInTime || "12:00 PM",
        checkOutTime: checkOutTime || "11:00 AM",
        flexibleCheckIn: flexibleCheckIn ?? false,
        flexibleCheckOut: flexibleCheckOut ?? false,
        amenities: amenities || [],
        meals: meals || null,
        hasKitchen: hasKitchen ?? false,
        kitchenDetails: kitchenDetails?.trim() || null,
        houseRules: houseRules || null,
        cancellationPolicy: cancellationPolicy || "Moderate",
        cancellationDetails: cancellationDetails?.trim() || null,
        isPetFriendly: isPetFriendly ?? false,
        petRules: petRules?.trim() || null,
        isSmokingAllowed: isSmokingAllowed ?? false,
        isPartyAllowed: isPartyAllowed ?? false,
        quietHoursStart: quietHoursStart || null,
        quietHoursEnd: quietHoursEnd || null,
        nearbyPlaces: nearbyPlaces || null,
        languagesSpoken: languagesSpoken || [],
        instantBook: instantBook ?? true,
        advanceNoticeHours: advanceNoticeHours !== undefined ? Number(advanceNoticeHours) : 0,
        maxGuestsPerBooking: maxGuestsPerBooking !== undefined ? Number(maxGuestsPerBooking) : Number(maxGuests),
        status: status || "draft",
        media: [],
      }
    });

    res.status(201).json({
      status: "success",
      message: "Listing created successfully.",
      data: { listing: mapListingResponse(listing) },
    });
  } catch (error: any) {
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
    const filter: any = { hostId };
    if (status && ["draft", "published", "unlisted", "rejected"].includes(status as string)) {
      filter.status = status;
    }
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [listings, total] = await Promise.all([
      prisma.listing.findMany({
        where: filter,
        orderBy: { updatedAt: "desc" },
        skip,
        take: limitNum,
      }),
      prisma.listing.count({ where: filter }),
    ]);

    const mappedListings = listings.map(mapListingResponse);

    res.status(200).json({
      status: "success",
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      results: mappedListings.length,
      data: { listings: mappedListings },
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
    const listing = await prisma.listing.findUnique({
      where: { id: req.params.id }
    });
    if (!listing) {
      res.status(404).json({ status: "fail", message: "Listing not found." });
      return;
    }
    res.status(200).json({
      status: "success",
      data: { listing: mapListingResponse(listing) },
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
    const listing = await prisma.listing.findUnique({
      where: { id: req.params.id }
    });

    if (!listing) {
      res.status(404).json({ status: "fail", message: "Listing not found." });
      return;
    }
    if (listing.hostId !== hostId) {
      res.status(403).json({ status: "fail", message: "You can only edit your own listings." });
      return;
    }

    // Allowed updatable fields
    const updatableFields = [
      "name", "summary", "description", "propertyType", "floorNumber", "totalFloors",
      "propertySizeSqFt", "yearBuilt", "isEntirePlace",
      "address", "city", "state", "country", "zipCode", "landmark",
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

    const updateData: any = {};
    for (const field of updatableFields) {
      if (req.body[field] !== undefined) {
        if (field === "coordinates") {
          updateData.lat = Number(req.body.coordinates.lat);
          updateData.lng = Number(req.body.coordinates.lng);
        } else if (["floorNumber", "totalFloors", "propertySizeSqFt", "yearBuilt", "maxGuests", "bedrooms", "beds", "bathrooms", "extraMattresses", "basePrice", "weekendPrice", "cleaningFee", "securityDeposit", "extraGuestPrice", "taxes", "minStay", "maxStay", "advanceNoticeHours", "maxGuestsPerBooking"].includes(field)) {
          updateData[field] = req.body[field] !== null ? Number(req.body[field]) : null;
        } else {
          updateData[field] = req.body[field];
        }
      }
    }

    if (req.body.name && req.body.name.trim() !== listing.name) {
      const baseSlug = generateSlug(req.body.name);
      updateData.slug = await ensureUniqueListingSlug(baseSlug, listing.id);
    }

    const updated = await prisma.listing.update({
      where: { id: req.params.id },
      data: updateData,
    });

    res.status(200).json({
      status: "success",
      message: "Listing updated successfully.",
      data: { listing: mapListingResponse(updated) },
    });
  } catch (error: any) {
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
    const listing = await prisma.listing.findUnique({
      where: { id: req.params.id }
    });

    if (!listing) {
      res.status(404).json({ status: "fail", message: "Listing not found." });
      return;
    }
    if (listing.hostId !== hostId) {
      res.status(403).json({ status: "fail", message: "You can only delete your own listings." });
      return;
    }

    // Delete associated Cloudinary images
    const mediaArray = listing.media && Array.isArray(listing.media) ? listing.media : [];
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

    await prisma.listing.delete({
      where: { id: req.params.id }
    });

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
    const listing = await prisma.listing.findUnique({
      where: { id: req.params.id }
    });

    if (!listing) {
      res.status(404).json({ status: "fail", message: "Listing not found." });
      return;
    }
    if (listing.hostId !== hostId) {
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
    const existingMedia = Array.isArray(listing.media) ? listing.media : [];

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
        folder: `triptay/listings/${listing.id}`,
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

    await prisma.listing.update({
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

// ──────────────────────── Delete Listing Image ────────────────────────

// @desc    Delete a single media item from a listing
// @route   DELETE /api/listings/:id/media/:mediaId
// @access  Private (Owner only)
export const deleteListingMedia = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const hostId = req.user?.id || req.user?._id;
    const listing = await prisma.listing.findUnique({
      where: { id: req.params.id }
    });

    if (!listing) {
      res.status(404).json({ status: "fail", message: "Listing not found." });
      return;
    }
    if (listing.hostId !== hostId) {
      res.status(403).json({ status: "fail", message: "You can only modify your own listings." });
      return;
    }

    const existingMedia = Array.isArray(listing.media) ? [...listing.media] : [];
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

    await prisma.listing.update({
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

    if (city) filter.city = { contains: city as string, mode: "insensitive" };
    if (state) filter.state = { contains: state as string, mode: "insensitive" };
    if (propertyType) filter.propertyType = propertyType;
    if (minPrice) filter.basePrice = { gte: parseInt(minPrice as string, 10) };
    if (maxPrice) {
      filter.basePrice = { ...(filter.basePrice || {}), lte: parseInt(maxPrice as string, 10) };
    }
    if (guests) filter.maxGuests = { gte: parseInt(guests as string, 10) };
    if (bedrooms) filter.bedrooms = { gte: parseInt(bedrooms as string, 10) };
    if (bathrooms) filter.bathrooms = { gte: parseInt(bathrooms as string, 10) };
    if (amenityFilter) {
      const amenitiesList = (amenityFilter as string).split(",").map((a) => a.trim());
      filter.amenities = { hasEvery: amenitiesList };
    }

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const sortField = (sort as string).startsWith("-") ? (sort as string).substring(1) : (sort as string);
    const sortOrder = (sort as string).startsWith("-") ? "desc" : "asc";
    const orderBy = { [sortField]: sortOrder };

    const [listings, total] = await Promise.all([
      prisma.listing.findMany({
        where: filter,
        orderBy,
        skip,
        take: limitNum,
      }),
      prisma.listing.count({ where: filter }),
    ]);

    const mappedListings = listings.map(mapListingResponse);

    // Attach computed effectiveWeekendPrice
    const enriched = mappedListings.map((l: any) => ({
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
export const getPublicListing = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { slug } = req.params;

    // 1) Try by slug first
    let listing = await prisma.listing.findFirst({
      where: { slug, status: "published", isActive: true }
    });

    // 2) Fallback: try by id
    if (!listing) {
      try {
        listing = await prisma.listing.findFirst({
          where: { id: slug, status: "published", isActive: true }
        });
      } catch {
        // invalid ID string → ignore
      }
    }

    if (!listing) {
      res.status(404).json({ status: "fail", message: "Stay not found." });
      return;
    }

    const enriched = await populateHostForListing(listing);
    if (enriched) {
      (enriched as any).effectiveWeekendPrice =
        (enriched as any).weekendPrice && (enriched as any).weekendPrice > 0
          ? (enriched as any).weekendPrice
          : Math.round((enriched as any).basePrice * 1.3);
    }

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

    const [listings, activities] = await Promise.all([
      prisma.listing.findMany({
        where: {
          status: "published",
          isActive: true,
          city: { contains: query, mode: "insensitive" }
        },
        select: { city: true }
      }),
      prisma.activity.findMany({
        where: {
          status: "published",
          isActive: true,
          city: { contains: query, mode: "insensitive" }
        },
        select: { city: true }
      }),
    ]);

    const listingCities = listings.map(l => l.city);
    const activityCities = activities.map(a => a.city);

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
      lat: { gte: box.minLat, lte: box.maxLat },
      lng: { gte: box.minLng, lte: box.maxLng },
    };

    const activityFilter = {
      status: "published",
      isActive: true,
      lat: { gte: box.minLat, lte: box.maxLat },
      lng: { gte: box.minLng, lte: box.maxLng },
    };

    const [rawListings, rawActivities] = await Promise.all([
      prisma.listing.findMany({ where: listingFilter }),
      prisma.activity.findMany({ where: activityFilter }),
    ]);

    // Compute distance & enrich
    const listingsWithDist = rawListings.map((l: any) => ({
      _id: l.id,
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
      distanceKm: parseFloat(haversineKm(lat, lng, l.lat, l.lng).toFixed(2)),
    }));

    const activitiesWithDist = rawActivities.map((a: any) => ({
      _id: a.id,
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
      distanceKm: parseFloat(haversineKm(lat, lng, a.lat, a.lng).toFixed(2)),
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