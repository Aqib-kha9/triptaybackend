import { prisma } from "../config/db.js";
import cloudinary from "../config/cloudinary.js";
import { validateMagicBytes } from "../utils/validateMagicBytes.js";
import { generateSlug, ensureUniqueSlug } from "../utils/slug.js";
import { buildPaginationMeta } from "../utils/pagination.js";
import { config } from "../core/config.js";
import { BadRequestError, NotFoundError, ForbiddenError } from "../core/errors.js";
import { logger } from "../core/logger.js";
import { uploadMedia, deleteMedia, resolveMediaUrl } from "./upload.service.js";
import { isRedisAvailable, cacheWrap, cacheDelPattern } from "../config/redis.js";
import { getCancellationPolicySettings } from "./configuration.service.js";

// ─── Resolve the effective cancellation policy (admin-configurable) ───
// If the admin has disabled vendor overrides, the admin's global default
// is used regardless of what the vendor sent. Otherwise the vendor's
// choice is respected (falling back to the admin default if not provided).
async function resolveCancellationPolicy(vendorPolicy?: string): Promise<string> {
  const cfg = await getCancellationPolicySettings();
  if (!cfg.vendorOverrideEnabled) return cfg.defaultPolicy;
  return vendorPolicy || cfg.defaultPolicy;
}

// ──────────────────────── Types ────────────────────────

interface MediaItem {
  url: string;
  publicId: string;
  type: "photo" | "video";
  caption?: string;
  isCover?: boolean;
  order?: number;
}

export interface ListingResponse {
  _id: string;
  id: string;
  host: string;
  hostId: string;
  coordinates: { lat: number; lng: number };
  [key: string]: unknown;
}

export interface CreateListingInput {
  name: string;
  summary: string;
  description: string;
  propertyType: string;
  floorNumber?: number;
  totalFloors?: number;
  propertySizeSqFt?: number;
  yearBuilt?: number;
  isEntirePlace?: boolean;
  address: string;
  city: string;
  state: string;
  country?: string;
  zipCode: string;
  coordinates: { lat: number; lng: number };
  landmark?: string;
  maxGuests: number;
  bedrooms?: number;
  beds?: number;
  bathrooms?: number;
  extraMattresses?: number;
  basePrice: number;
  weekendPrice?: number;
  seasonalPrices?: unknown;
  cleaningFee?: number;
  securityDeposit?: number;
  extraGuestPrice?: number;
  taxes?: number;
  minStay?: number;
  maxStay?: number;
  checkInTime?: string;
  checkOutTime?: string;
  flexibleCheckIn?: boolean;
  flexibleCheckOut?: boolean;
  amenities?: string[];
  meals?: unknown;
  hasKitchen?: boolean;
  kitchenDetails?: string;
  houseRules?: unknown;
  cancellationPolicy?: string;
  cancellationDetails?: string;
  isPetFriendly?: boolean;
  petRules?: string;
  isSmokingAllowed?: boolean;
  isPartyAllowed?: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  nearbyPlaces?: unknown;
  languagesSpoken?: string[];
  instantBook?: boolean;
  advanceNoticeHours?: number;
  maxGuestsPerBooking?: number;
  status?: string;
}

export interface BrowseListingsQuery {
  city?: string;
  state?: string;
  propertyType?: string;
  minPrice?: string;
  maxPrice?: string;
  guests?: string;
  bedrooms?: string;
  bathrooms?: string;
  amenities?: string;
  sort?: string;
  page?: string;
  limit?: string;
}

// ──────────────────────── Pagination Helper ────────────────────────

function resolvePagination(pageStr?: string, limitStr?: string, defaultLimit = 20, maxLimit = 100) {
  const page = Math.max(1, parseInt(pageStr || "1", 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(limitStr || String(defaultLimit), 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

/**
 * Casts Prisma JsonValue media to our MediaItem array.
 * Returns an empty array if the value is not a valid array of MediaItem-shaped objects.
 */
function castMediaArray(raw: unknown): MediaItem[] {
  if (!Array.isArray(raw)) return [];
  return raw as unknown as MediaItem[];
}

// ──────────────────────── Helpers ────────────────────────

/**
 * Computes the effective weekend price: uses explicit weekend price if set,
 * otherwise falls back to basePrice * 1.3 (rounded).
 */
export function computeEffectiveWeekendPrice(base: number, weekend?: number): number {
  if (weekend && weekend > 0) return weekend;
  return Math.round(base * 1.3);
}

/**
 * Maps a flat Prisma listing record to the frontend-compatible shape
 * with `_id` alias and nested `coordinates` object.
 */
export function mapListingResponse(l: Record<string, unknown>): ListingResponse | null {
  if (!l) return null;
  const { lat, lng, ...rest } = l as Record<string, unknown>;
  return {
    ...rest,
    _id: l.id as string,
    host: l.hostId as string,
    coordinates: { lat: lat as number, lng: lng as number },
  } as ListingResponse;
}

/**
 * Attaches the host user's profile info to a listing response.
 */
export async function populateHostForListing(
  listing: Record<string, unknown>,
): Promise<ListingResponse | null> {
  if (!listing) return null;
  const host = await prisma.user.findUnique({
    where: { id: listing.hostId as string },
    select: { id: true, name: true, avatar: true, email: true, phone: true },
  });
  const mapped = mapListingResponse(listing);
  if (mapped) {
    (mapped as Record<string, unknown>).host = host
      ? { _id: host.id, id: host.id, name: host.name, avatar: host.avatar, email: host.email, phone: host.phone }
      : null;
  }
  return mapped;
}

/**
 * Looks up a listing by slug, falling back to ID lookup.
 */
async function findListingBySlug(slug: string) {
  let listing = await prisma.listing.findFirst({
    where: { slug, status: "published", isActive: true },
  });
  if (!listing) {
    try {
      listing = await prisma.listing.findFirst({
        where: { id: slug, status: "published", isActive: true },
      });
    } catch {
      // invalid ID format → ignore
    }
  }
  return listing;
}

// ──────────────────────── Service Functions ────────────────────────

/**
 * Creates a new listing for a vendor.
 */
export async function createListing(hostId: string, data: CreateListingInput) {
  // Validate required fields
  const requiredFields: Record<string, unknown> = {
    name: data.name,
    summary: data.summary,
    description: data.description,
    propertyType: data.propertyType,
    address: data.address,
    city: data.city,
    state: data.state,
    country: data.country || "India",
    zipCode: data.zipCode,
  };
  const missing = Object.entries(requiredFields).filter(
    ([, v]) => !v || (typeof v === "string" && !v.trim()),
  );
  if (missing.length > 0) {
    throw new BadRequestError(
      `Missing required fields: ${missing.map(([k]) => k).join(", ")}`,
    );
  }

  if (!data.coordinates || data.coordinates.lat == null || data.coordinates.lng == null) {
    throw new BadRequestError("Coordinates (lat, lng) are required.");
  }

  if (!data.basePrice || data.basePrice <= 0) {
    throw new BadRequestError("basePrice must be a positive number.");
  }

  if (!data.maxGuests || data.maxGuests < 1) {
    throw new BadRequestError("maxGuests must be at least 1.");
  }

  const baseSlug = generateSlug(data.name);
  const slug = await ensureUniqueSlug(baseSlug, async (s) => {
    const existing = await prisma.listing.findFirst({ where: { slug: s } });
    return !!existing;
  });

  const listing = await prisma.listing.create({
    data: {
      hostId,
      name: data.name.trim(),
      slug,
      summary: data.summary.trim(),
      description: data.description.trim(),
      propertyType: data.propertyType,
      floorNumber: data.floorNumber !== undefined ? Number(data.floorNumber) : null,
      totalFloors: data.totalFloors !== undefined ? Number(data.totalFloors) : null,
      propertySizeSqFt: data.propertySizeSqFt !== undefined ? Number(data.propertySizeSqFt) : null,
      yearBuilt: data.yearBuilt !== undefined ? Number(data.yearBuilt) : null,
      isEntirePlace: data.isEntirePlace ?? true,
      address: data.address.trim(),
      city: data.city.trim(),
      state: data.state.trim(),
      country: data.country?.trim() || "India",
      zipCode: data.zipCode.trim(),
      lat: Number(data.coordinates.lat),
      lng: Number(data.coordinates.lng),
      landmark: data.landmark?.trim() || null,
      maxGuests: Number(data.maxGuests),
      bedrooms: data.bedrooms !== undefined ? Number(data.bedrooms) : 1,
      beds: data.beds !== undefined ? Number(data.beds) : 1,
      bathrooms: data.bathrooms !== undefined ? Number(data.bathrooms) : 1,
      extraMattresses: data.extraMattresses !== undefined ? Number(data.extraMattresses) : 0,
      basePrice: Number(data.basePrice),
      weekendPrice: data.weekendPrice !== undefined ? Number(data.weekendPrice) : null,
      seasonalPrices: (data.seasonalPrices as object) || null,
      cleaningFee: data.cleaningFee !== undefined ? Number(data.cleaningFee) : 0,
      securityDeposit: data.securityDeposit !== undefined ? Number(data.securityDeposit) : 0,
      extraGuestPrice: data.extraGuestPrice !== undefined ? Number(data.extraGuestPrice) : 0,
      taxes: data.taxes !== undefined ? Number(data.taxes) : 0,
      minStay: data.minStay !== undefined ? Number(data.minStay) : 1,
      maxStay: data.maxStay !== undefined ? Number(data.maxStay) : 0,
      checkInTime: data.checkInTime || "12:00 PM",
      checkOutTime: data.checkOutTime || "11:00 AM",
      flexibleCheckIn: data.flexibleCheckIn ?? false,
      flexibleCheckOut: data.flexibleCheckOut ?? false,
      amenities: data.amenities || [],
      meals: (data.meals as object) || null,
      hasKitchen: data.hasKitchen ?? false,
      kitchenDetails: data.kitchenDetails?.trim() || null,
      houseRules: (data.houseRules as object) || null,
      cancellationPolicy: await resolveCancellationPolicy(data.cancellationPolicy),
      cancellationDetails: data.cancellationDetails?.trim() || null,
      isPetFriendly: data.isPetFriendly ?? false,
      petRules: data.petRules?.trim() || null,
      isSmokingAllowed: data.isSmokingAllowed ?? false,
      isPartyAllowed: data.isPartyAllowed ?? false,
      quietHoursStart: data.quietHoursStart || null,
      quietHoursEnd: data.quietHoursEnd || null,
      nearbyPlaces: (data.nearbyPlaces as object) || null,
      languagesSpoken: data.languagesSpoken || [],
      instantBook: data.instantBook ?? true,
      advanceNoticeHours: data.advanceNoticeHours !== undefined ? Number(data.advanceNoticeHours) : 0,
      maxGuestsPerBooking: data.maxGuestsPerBooking !== undefined
        ? Number(data.maxGuestsPerBooking)
        : Number(data.maxGuests),
      status: data.status || "draft",
      media: [],
    },
  });

  // Invalidate browse cache (new listing may appear in browse results)
  await cacheDelPattern("listings:browse:*");

  return listing;
}

/**
 * Returns paginated listings for a specific vendor.
 */
export async function getMyListings(
  hostId: string,
  query: { status?: string; page?: string; limit?: string },
) {
  const filter: Record<string, unknown> = { hostId };
  if (query.status && ["draft", "published", "unlisted", "rejected"].includes(query.status)) {
    filter.status = query.status;
  }

  const { page, limit, skip } = resolvePagination(query.page, query.limit, 20, 100);

  const [listings, total] = await Promise.all([
    prisma.listing.findMany({
      where: filter,
      orderBy: { updatedAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.listing.count({ where: filter }),
  ]);

  const mapped = listings.map((l) => mapListingResponse(l as unknown as Record<string, unknown>));

  return {
    listings: mapped,
    pagination: buildPaginationMeta(page, limit, total),
  };
}

/**
 * Returns a single listing by ID.
 */
export async function getListing(id: string) {
  const listing = await prisma.listing.findUnique({ where: { id } });
  if (!listing) {
    throw new NotFoundError("Listing not found.");
  }
  return mapListingResponse(listing as unknown as Record<string, unknown>);
}

/**
 * Updates a listing. Only the owner can update.
 */
export async function updateListing(id: string, hostId: string, data: Record<string, unknown>) {
  const listing = await prisma.listing.findUnique({ where: { id } });
  if (!listing) {
    throw new NotFoundError("Listing not found.");
  }
  if (listing.hostId !== hostId) {
    throw new ForbiddenError("You can only edit your own listings.");
  }

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

  const numericFields = [
    "floorNumber", "totalFloors", "propertySizeSqFt", "yearBuilt",
    "maxGuests", "bedrooms", "beds", "bathrooms", "extraMattresses",
    "basePrice", "weekendPrice", "cleaningFee", "securityDeposit",
    "extraGuestPrice", "taxes", "minStay", "maxStay",
    "advanceNoticeHours", "maxGuestsPerBooking",
  ];

  const updateData: Record<string, unknown> = {};
  for (const field of updatableFields) {
    if (data[field] !== undefined) {
      if (field === "coordinates") {
        const coords = data.coordinates as { lat: number; lng: number };
        updateData.lat = Number(coords.lat);
        updateData.lng = Number(coords.lng);
      } else if (numericFields.includes(field)) {
        updateData[field] = data[field] !== null ? Number(data[field]) : null;
      } else {
        updateData[field] = data[field];
      }
    }
  }

  // ── Enforce admin cancellation-policy override permission ──
  // If the admin has disabled vendor overrides, the cancellation policy
  // cannot be changed by the vendor — it is always the admin's global default.
  const cancelConfig = await getCancellationPolicySettings();
  if (!cancelConfig.vendorOverrideEnabled) {
    updateData.cancellationPolicy = cancelConfig.defaultPolicy;
  } else if (updateData.cancellationPolicy === undefined) {
    // Vendor override allowed but vendor didn't send a policy — keep existing
  }

  // Regenerate slug if name changed
  if (data.name && typeof data.name === "string" && data.name.trim() !== listing.name) {
    const baseSlug = generateSlug(data.name);
    updateData.slug = await ensureUniqueSlug(baseSlug, async (s) => {
      const existing = await prisma.listing.findFirst({
        where: { slug: s, id: { not: id } },
      });
      return !!existing;
    });
  }

  const updated = await prisma.listing.update({
    where: { id },
    data: updateData,
  });

  // Invalidate caches: browse results + this listing's public page (old & new slug)
  await cacheDelPattern("listings:browse:*");
  await cacheDelPattern("listings:public:*");

  return mapListingResponse(updated as unknown as Record<string, unknown>);
}

/**
 * Deletes a listing and its associated Cloudinary media.
 */
export async function deleteListing(id: string, hostId: string) {
  const listing = await prisma.listing.findUnique({ where: { id } });
  if (!listing) {
    throw new NotFoundError("Listing not found.");
  }
  if (listing.hostId !== hostId) {
    throw new ForbiddenError("You can only delete your own listings.");
  }

  // Clean up Cloudinary media
  const mediaArray = castMediaArray(listing.media);
  if (mediaArray.length > 0) {
    const publicIds = mediaArray.map((m) => m.publicId).filter(Boolean);
    if (publicIds.length > 0) {
      try {
        await cloudinary.api.delete_resources(publicIds, { resource_type: "image" });
      } catch (err) {
        logger.warn("Cloudinary cleanup warning during listing deletion", err);
      }
    }
  }

  await prisma.listing.delete({ where: { id } });

  // Invalidate caches: browse results + this listing's public page
  await cacheDelPattern("listings:browse:*");
  await cacheDelPattern("listings:public:*");
}

/**
 * Uploads media files to a listing. Only the owner can upload.
 */
export async function uploadListingMedia(
  id: string,
  hostId: string,
  files: Express.Multer.File[],
  body: Record<string, string>,
) {
  const listing = await prisma.listing.findUnique({ where: { id } });
  if (!listing) {
    throw new NotFoundError("Listing not found.");
  }
  if (listing.hostId !== hostId) {
    throw new ForbiddenError("You can only upload to your own listings.");
  }

  if (!files || files.length === 0) {
    throw new BadRequestError("No files uploaded.");
  }

  const maxPhotos = 15;
  const existingMedia = castMediaArray(listing.media);

  if (existingMedia.length + files.length > maxPhotos) {
    throw new BadRequestError(
      `Cannot upload more than ${maxPhotos} photos total. Currently have ${existingMedia.length}.`,
    );
  }

  const uploadedMedia: MediaItem[] = [];

  for (const file of files) {
    if (!file.buffer || file.buffer.length === 0) {
      throw new BadRequestError("One of the files is empty.");
    }

    if (!validateMagicBytes(file.buffer, file.mimetype)) {
      throw new BadRequestError(
        `${file.originalname}: file content does not match its declared type. Only JPEG, PNG, WebP, and PDF are accepted.`,
      );
    }

    const alreadyHasCover =
      existingMedia.some((m) => m.isCover) || uploadedMedia.some((m) => m.isCover);
    const isCover = !alreadyHasCover && !body.isCover;

    // Upload to S3 (or Cloudinary fallback) — stores path/key, not full URL
    const uploaded = await uploadMedia(file, `listings/${listing.id}`);

    uploadedMedia.push({
      url: uploaded.url,
      publicId: uploaded.publicId || uploaded.path,
      type: "photo",
      caption: body.caption || undefined,
      isCover: body.isCover === "true" || isCover,
      order: existingMedia.length + uploadedMedia.length,
    });
  }

  const newMedia = [...existingMedia, ...uploadedMedia];

  // If any image is explicitly marked as cover, unset previous covers
  if (uploadedMedia.some((m) => m.isCover)) {
    for (let i = 0; i < newMedia.length; i++) {
      const item = newMedia[i];
      if (!item) continue;
      const wasJustUploaded = uploadedMedia.some((um) => um.publicId === item.publicId);
      if (!wasJustUploaded && item.isCover) {
        newMedia[i] = { ...item, isCover: false };
      }
    }
  }

  await prisma.listing.update({
    where: { id },
    data: { media: newMedia as unknown as object[] },
  });

  // Invalidate caches: browse results + this listing's public page (media changed)
  await cacheDelPattern("listings:browse:*");
  await cacheDelPattern("listings:public:*");

  return { media: uploadedMedia, totalPhotos: newMedia.length };
}

/**
 * Deletes a single media item from a listing.
 */
export async function deleteListingMedia(id: string, hostId: string, mediaId: string) {
  const listing = await prisma.listing.findUnique({ where: { id } });
  if (!listing) {
    throw new NotFoundError("Listing not found.");
  }
  if (listing.hostId !== hostId) {
    throw new ForbiddenError("You can only modify your own listings.");
  }

  const existingMedia = castMediaArray(listing.media);

  const mediaIndex = existingMedia.findIndex(
    (m) => (m as unknown as Record<string, unknown>)._id?.toString() === mediaId || m.publicId === mediaId,
  );

  if (mediaIndex === -1) {
    throw new NotFoundError("Media item not found.");
  }

  const mediaItem = existingMedia[mediaIndex]!;

  // Delete from S3 (or Cloudinary fallback)
  await deleteMedia(mediaItem.publicId, mediaItem.publicId?.startsWith("http") || !mediaItem.publicId?.includes("/"));

  existingMedia.splice(mediaIndex, 1);

  // If we deleted the cover, set first remaining as cover
  const firstRemaining = existingMedia[0];
  if (mediaItem.isCover && firstRemaining) {
    existingMedia[0] = { ...firstRemaining, isCover: true };
  }

  await prisma.listing.update({
    where: { id },
    data: { media: existingMedia as unknown as object[] },
  });

  // Invalidate caches: browse results + this listing's public page (media changed)
  await cacheDelPattern("listings:browse:*");
  await cacheDelPattern("listings:public:*");

  return { totalPhotos: existingMedia.length };
}

/**
 * Browses published listings with filtering, sorting, and pagination.
 */
export async function browseListings(query: BrowseListingsQuery) {
  // Build a cache key from the query parameters
  const cacheKey = `listings:browse:${JSON.stringify(query)}`;

  return cacheWrap(
    cacheKey,
    async () => {
      const filter: Record<string, any> = { status: "published", isActive: true };

      if (query.city) filter.city = { contains: query.city, mode: "insensitive" };
      if (query.state) filter.state = { contains: query.state, mode: "insensitive" };
      
      if (query.propertyType) {
        const typeMap: Record<string, string> = {
          villa: "Villa",
          apartment: "Apartment",
          cottage: "Cottage",
          farmstay: "Farmhouse",
          farmhouse: "Farmhouse",
          homestay: "Homestay",
        };
        const mappedType = typeMap[query.propertyType.toLowerCase()] || query.propertyType;
        filter.propertyType = { equals: mappedType, mode: "insensitive" };
      }
      
      if (query.minPrice) {
        filter.basePrice = { gte: parseInt(query.minPrice, 10) };
      }
      if (query.maxPrice) {
        filter.basePrice = { ...(filter.basePrice as object), lte: parseInt(query.maxPrice, 10) };
      }
      if (query.guests) filter.maxGuests = { gte: parseInt(query.guests, 10) };
      if (query.bedrooms) filter.bedrooms = { gte: parseInt(query.bedrooms, 10) };
      if (query.bathrooms) filter.bathrooms = { gte: parseInt(query.bathrooms, 10) };
      
      if (query.amenities) {
        const queryList = query.amenities.split(",").map((a) => a.trim().toLowerCase());
        const dbAmenities: string[] = [];
        
        queryList.forEach((a) => {
          if (a === "pet friendly" || a === "petfriendly" || a === "pets allowed" || a === "petsallowed") {
            filter.isPetFriendly = true;
          } else {
            dbAmenities.push(a);
          }
        });
        
        if (dbAmenities.length > 0) {
          filter.amenities = { hasEvery: dbAmenities };
        }
      }

      const { page, limit, skip } = resolvePagination(query.page, query.limit, 20, 50);

      const sortStr = query.sort || "-updatedAt";
      const sortField = sortStr.startsWith("-") ? sortStr.substring(1) : sortStr;
      const sortOrder = sortStr.startsWith("-") ? "desc" : "asc";
      const orderBy = { [sortField]: sortOrder };

      const [listings, total] = await Promise.all([
        prisma.listing.findMany({
          where: filter,
          orderBy,
          skip,
          take: limit,
        }),
        prisma.listing.count({ where: filter }),
      ]);

      const mapped = listings.map((l) => {
        const m = mapListingResponse(l as unknown as Record<string, unknown>);
        if (m) {
          (m as Record<string, unknown>).effectiveWeekendPrice = computeEffectiveWeekendPrice(
            (l as unknown as Record<string, unknown>).basePrice as number,
            (l as unknown as Record<string, unknown>).weekendPrice as number | undefined,
          );
        }
        return m;
      });

      return {
        listings: mapped,
        pagination: buildPaginationMeta(page, limit, total),
      };
    },
    300, // 5-minute TTL for browse results
  );
}

/**
 * Returns a public listing by slug (or ID fallback) with host info.
 */
export async function getPublicListing(slug: string) {
  const cacheKey = `listings:public:${slug}`;

  return cacheWrap(
    cacheKey,
    async () => {
      const listing = await findListingBySlug(slug);
      if (!listing) {
        throw new NotFoundError("Stay not found.");
      }

      const enriched = await populateHostForListing(listing as unknown as Record<string, unknown>);
      if (enriched) {
        (enriched as Record<string, unknown>).effectiveWeekendPrice = computeEffectiveWeekendPrice(
          (listing as unknown as Record<string, unknown>).basePrice as number,
          (listing as unknown as Record<string, unknown>).weekendPrice as number | undefined,
        );
      }

      return enriched;
    },
    600, // 10-minute TTL for individual listing pages
  );
}

/**
 * Returns unique city suggestions from listings + activities for autocomplete.
 */
export async function locationSuggestions(query: string) {
  if (!query || query.length < 1) {
    return { suggestions: [] };
  }

  const [listings, activities] = await Promise.all([
    prisma.listing.findMany({
      where: {
        status: "published",
        isActive: true,
        city: { contains: query, mode: "insensitive" },
      },
      select: { city: true },
    }),
    prisma.activity.findMany({
      where: {
        status: "published",
        isActive: true,
        city: { contains: query, mode: "insensitive" },
      },
      select: { city: true },
    }),
  ]);

  const merged = [...new Set([...listings.map((l) => l.city), ...activities.map((a) => a.city)])]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 8);

  return { suggestions: merged };
}

// ──────────────────────── Geo Helpers ────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
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
  const latDelta = radiusKm / 111.32;
  const lngDelta = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}

/**
 * Searches for listings and activities near a given coordinate.
 */
export async function browseNearby(lat: number, lng: number, radius: number, limit: number) {
  if (isNaN(lat) || isNaN(lng)) {
    throw new BadRequestError("lat and lng query parameters are required.");
  }

  const clampedRadius = Math.min(100, Math.max(1, radius || 50));
  const clampedLimit = Math.min(40, Math.max(1, limit || 20));

  const box = boundingBox(lat, lng, clampedRadius);

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

  const listingsWithDist = (rawListings as unknown as Record<string, unknown>[]).map((l) => ({
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
    effectiveWeekendPrice: computeEffectiveWeekendPrice(
      l.basePrice as number,
      l.weekendPrice as number | undefined,
    ),
    distanceKm: parseFloat(haversineKm(lat, lng, l.lat as number, l.lng as number).toFixed(2)),
  }));

  const activitiesWithDist = (rawActivities as unknown as Record<string, unknown>[]).map((a) => ({
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
    effectiveWeekendPrice: computeEffectiveWeekendPrice(
      a.basePrice as number,
      a.weekendPrice as number | undefined,
    ),
    distanceKm: parseFloat(haversineKm(lat, lng, a.lat as number, a.lng as number).toFixed(2)),
  }));

  const merged = [...listingsWithDist, ...activitiesWithDist]
    .filter((item) => item.distanceKm <= clampedRadius)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, clampedLimit);

  return {
    items: merged,
    total: merged.length,
    radius: clampedRadius,
    center: { lat, lng },
  };
}