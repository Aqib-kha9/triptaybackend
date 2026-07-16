import { prisma } from "../config/db.js";
import cloudinary from "../config/cloudinary.js";
import { validateMagicBytes } from "../utils/validateMagicBytes.js";
import { generateSlug, ensureUniqueSlug } from "../utils/slug.js";
import { buildPaginationMeta } from "../utils/pagination.js";
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

export interface CreateActivityInput {
  name: string;
  summary: string;
  description: string;
  activityType: string;
  difficulty?: string;
  address: string;
  city: string;
  state: string;
  country?: string;
  zipCode: string;
  coordinates: { lat: number; lng: number };
  landmark?: string;
  meetingPoint?: string;
  durationHours: number;
  durationDays?: number;
  startTimes?: string[];
  availability?: string;
  availabilityNotes?: string;
  minAge?: number;
  maxGroupSize: number;
  minGroupSize?: number;
  basePrice: number;
  weekendPrice?: number;
  childPrice?: number;
  foreignerPrice?: number;
  seasonalPrices?: unknown;
  taxes?: number;
  securityDeposit?: number;
  equipmentProvided?: string[];
  equipmentRequired?: string[];
  safetyGuidelines?: string;
  hasInsurance?: boolean;
  certifiedGuides?: boolean;
  guideRatio?: string;
  included?: string[];
  excluded?: string[];
  houseRules?: unknown;
  cancellationPolicy?: string;
  cancellationDetails?: string;
  isPetFriendly?: boolean;
  petRules?: string;
  restrictions?: string;
  nearbyPlaces?: unknown;
  languagesSpoken?: string[];
  instantBook?: boolean;
  advanceNoticeHours?: number;
  maxGuestsPerBooking?: number;
  status?: string;
}

export interface BrowseActivitiesQuery {
  city?: string;
  state?: string;
  activityType?: string;
  difficulty?: string;
  minPrice?: string;
  maxPrice?: string;
  sort?: string;
  page?: string;
  limit?: string;
}

// ──────────────────────── Helpers ────────────────────────

function resolvePagination(pageStr?: string, limitStr?: string, defaultLimit = 20, maxLimit = 100) {
  const page = Math.max(1, parseInt(pageStr || "1", 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(limitStr || String(defaultLimit), 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

function castMediaArray(raw: unknown): MediaItem[] {
  if (!Array.isArray(raw)) return [];
  return raw as unknown as MediaItem[];
}

/**
 * Computes the effective weekend price: uses explicit weekend price if set,
 * otherwise falls back to basePrice * 1.3 (rounded).
 */
export function computeEffectiveWeekendPrice(base: number, weekend?: number): number {
  if (weekend && weekend > 0) return weekend;
  return Math.round(base * 1.3);
}

/**
 * Maps a flat Prisma activity record to the frontend-compatible shape.
 */
export function mapActivityResponse(a: Record<string, unknown>) {
  if (!a) return null;
  const { lat, lng, ...rest } = a;
  return {
    ...rest,
    _id: a.id,
    host: a.hostId,
    coordinates: { lat: lat as number, lng: lng as number },
  };
}

/**
 * Attaches the host user's profile info to an activity response.
 */
export async function populateHostForActivity(activity: Record<string, unknown>) {
  if (!activity) return null;
  const host = await prisma.user.findUnique({
    where: { id: activity.hostId as string },
    select: { id: true, name: true, avatar: true, email: true, phone: true },
  });
  const mapped = mapActivityResponse(activity);
  if (mapped) {
    (mapped as Record<string, unknown>).host = host
      ? { _id: host.id, id: host.id, name: host.name, avatar: host.avatar, email: host.email, phone: host.phone }
      : null;
  }
  return mapped;
}

// ──────────────────────── Service Functions ────────────────────────

/**
 * Creates a new activity for a vendor.
 */
export async function createActivity(hostId: string, data: CreateActivityInput) {
  const requiredFields: Record<string, unknown> = {
    name: data.name,
    summary: data.summary,
    description: data.description,
    activityType: data.activityType,
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
    throw new BadRequestError(`Missing required fields: ${missing.map(([k]) => k).join(", ")}`);
  }

  if (!data.coordinates || data.coordinates.lat == null || data.coordinates.lng == null) {
    throw new BadRequestError("Coordinates (lat, lng) are required.");
  }

  if (!data.basePrice || data.basePrice <= 0) {
    throw new BadRequestError("basePrice must be a positive number.");
  }

  if (!data.maxGroupSize || data.maxGroupSize < 1) {
    throw new BadRequestError("maxGroupSize must be at least 1.");
  }

  const baseSlug = generateSlug(data.name);
  const slug = await ensureUniqueSlug(baseSlug, async (s) => {
    const existing = await prisma.activity.findFirst({ where: { slug: s } });
    return !!existing;
  });

  const activity = await prisma.activity.create({
    data: {
      hostId,
      name: data.name.trim(),
      slug,
      summary: data.summary.trim(),
      description: data.description.trim(),
      activityType: data.activityType,
      difficulty: data.difficulty || "Moderate",
      address: data.address.trim(),
      city: data.city.trim(),
      state: data.state.trim(),
      country: data.country?.trim() || "India",
      zipCode: data.zipCode.trim(),
      lat: Number(data.coordinates.lat),
      lng: Number(data.coordinates.lng),
      landmark: data.landmark?.trim() || null,
      meetingPoint: data.meetingPoint?.trim() || null,
      durationHours: Number(data.durationHours),
      durationDays: data.durationDays !== undefined ? Number(data.durationDays) : 0,
      startTimes: data.startTimes || [],
      availability: data.availability || "Daily",
      availabilityNotes: data.availabilityNotes?.trim() || null,
      minAge: data.minAge !== undefined ? Number(data.minAge) : 0,
      maxGroupSize: Number(data.maxGroupSize),
      minGroupSize: data.minGroupSize !== undefined ? Number(data.minGroupSize) : 1,
      basePrice: Number(data.basePrice),
      weekendPrice: data.weekendPrice !== undefined ? Number(data.weekendPrice) : null,
      childPrice: data.childPrice !== undefined ? Number(data.childPrice) : null,
      foreignerPrice: data.foreignerPrice !== undefined ? Number(data.foreignerPrice) : null,
      seasonalPrices: (data.seasonalPrices as object) || null,
      taxes: data.taxes !== undefined ? Number(data.taxes) : 0,
      securityDeposit: data.securityDeposit !== undefined ? Number(data.securityDeposit) : 0,
      equipmentProvided: data.equipmentProvided || [],
      equipmentRequired: data.equipmentRequired || [],
      safetyGuidelines: data.safetyGuidelines?.trim() || null,
      hasInsurance: data.hasInsurance ?? false,
      certifiedGuides: data.certifiedGuides ?? false,
      guideRatio: data.guideRatio || null,
      included: data.included || [],
      excluded: data.excluded || [],
      houseRules: (data.houseRules as object) || null,
      cancellationPolicy: await resolveCancellationPolicy(data.cancellationPolicy),
      cancellationDetails: data.cancellationDetails?.trim() || null,
      isPetFriendly: data.isPetFriendly ?? false,
      petRules: data.petRules?.trim() || null,
      restrictions: data.restrictions?.trim() || null,
      nearbyPlaces: (data.nearbyPlaces as object) || null,
      languagesSpoken: data.languagesSpoken || [],
      instantBook: data.instantBook ?? true,
      advanceNoticeHours: data.advanceNoticeHours !== undefined ? Number(data.advanceNoticeHours) : 0,
      maxGuestsPerBooking: data.maxGuestsPerBooking !== undefined ? Number(data.maxGuestsPerBooking) : Number(data.maxGroupSize),
      status: data.status || "draft",
      media: [],
    },
  });

  // Invalidate browse cache (new activity may appear in browse results)
  await cacheDelPattern("activities:browse:*");

  return activity;
}

/**
 * Returns paginated activities for a specific vendor.
 */
export async function getMyActivities(hostId: string, query: { status?: string; page?: string; limit?: string }) {
  const filter: Record<string, unknown> = { hostId };
  if (query.status && ["draft", "published", "unlisted", "rejected"].includes(query.status)) {
    filter.status = query.status;
  }

  const { page, limit, skip } = resolvePagination(query.page, query.limit, 20, 100);

  const [activities, total] = await Promise.all([
    prisma.activity.findMany({
      where: filter,
      orderBy: { updatedAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.activity.count({ where: filter }),
  ]);

  const mapped = activities.map((a) => mapActivityResponse(a as unknown as Record<string, unknown>));

  return {
    activities: mapped,
    pagination: buildPaginationMeta(page, limit, total),
  };
}

/**
 * Returns a single activity by ID.
 */
export async function getActivity(id: string) {
  const activity = await prisma.activity.findUnique({ where: { id } });
  if (!activity) {
    throw new NotFoundError("Activity not found.");
  }
  return mapActivityResponse(activity as unknown as Record<string, unknown>);
}

/**
 * Updates an activity. Only the owner can update.
 */
export async function updateActivity(id: string, hostId: string, data: Record<string, unknown>) {
  const activity = await prisma.activity.findUnique({ where: { id } });
  if (!activity) {
    throw new NotFoundError("Activity not found.");
  }
  if (activity.hostId !== hostId) {
    throw new ForbiddenError("You can only edit your own activities.");
  }

  const updatableFields = [
    "name", "summary", "description", "activityType", "difficulty",
    "address", "city", "state", "country", "zipCode", "landmark",
    "meetingPoint", "durationHours", "durationDays", "startTimes",
    "availability", "availabilityNotes", "minAge", "maxGroupSize", "minGroupSize",
    "basePrice", "weekendPrice", "childPrice", "foreignerPrice", "seasonalPrices",
    "taxes", "securityDeposit",
    "equipmentProvided", "equipmentRequired", "safetyGuidelines",
    "hasInsurance", "certifiedGuides", "guideRatio",
    "included", "excluded",
    "houseRules", "cancellationPolicy", "cancellationDetails",
    "isPetFriendly", "petRules", "restrictions",
    "nearbyPlaces", "languagesSpoken",
    "instantBook", "advanceNoticeHours", "maxGuestsPerBooking",
    "status", "videoTourUrl",
  ];

  const numericFields = [
    "durationHours", "durationDays", "minAge", "maxGroupSize", "minGroupSize",
    "basePrice", "weekendPrice", "childPrice", "foreignerPrice", "taxes",
    "securityDeposit", "advanceNoticeHours", "maxGuestsPerBooking",
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
  }

  if (data.name && typeof data.name === "string" && data.name.trim() !== activity.name) {
    const baseSlug = generateSlug(data.name);
    updateData.slug = await ensureUniqueSlug(baseSlug, async (s) => {
      const existing = await prisma.activity.findFirst({
        where: { slug: s, id: { not: id } },
      });
      return !!existing;
    });
  }

  const updated = await prisma.activity.update({
    where: { id },
    data: updateData,
  });

  // Invalidate caches: browse results + this activity's public page (old & new slug)
  await cacheDelPattern("activities:browse:*");
  await cacheDelPattern("activities:public:*");

  return mapActivityResponse(updated as unknown as Record<string, unknown>);
}

/**
 * Deletes an activity and its associated media (S3 or Cloudinary).
 */
export async function deleteActivity(id: string, hostId: string) {
  const activity = await prisma.activity.findUnique({ where: { id } });
  if (!activity) {
    throw new NotFoundError("Activity not found.");
  }
  if (activity.hostId !== hostId) {
    throw new ForbiddenError("You can only delete your own activities.");
  }

  // Clean up media from S3 (or Cloudinary fallback)
  const mediaArray = castMediaArray(activity.media);
  for (const media of mediaArray) {
    if (media.publicId) {
      try {
        await deleteMedia(
          media.publicId,
          media.publicId.startsWith("http") || !media.publicId.includes("/"),
        );
      } catch (err) {
        logger.warn("Media cleanup warning during activity deletion", err);
      }
    }
  }

  await prisma.activity.delete({ where: { id } });

  // Invalidate caches: browse results + this activity's public page
  await cacheDelPattern("activities:browse:*");
  await cacheDelPattern("activities:public:*");
}

/**
 * Uploads media files to an activity.
 */
export async function uploadActivityMedia(
  id: string,
  hostId: string,
  files: Express.Multer.File[],
  body: Record<string, string>,
) {
  const activity = await prisma.activity.findUnique({ where: { id } });
  if (!activity) {
    throw new NotFoundError("Activity not found.");
  }
  if (activity.hostId !== hostId) {
    throw new ForbiddenError("You can only upload to your own activities.");
  }

  if (!files || files.length === 0) {
    throw new BadRequestError("No files uploaded.");
  }

  const maxPhotos = 15;
  const existingMedia = castMediaArray(activity.media);

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
    const uploaded = await uploadMedia(file, `activities/${activity.id}`);

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

  await prisma.activity.update({
    where: { id },
    data: { media: newMedia as unknown as object[] },
  });

  // Invalidate caches: browse results + this activity's public page (media changed)
  await cacheDelPattern("activities:browse:*");
  await cacheDelPattern("activities:public:*");

  return { media: uploadedMedia, totalPhotos: newMedia.length };
}

/**
 * Deletes a single media item from an activity.
 */
export async function deleteActivityMedia(id: string, hostId: string, mediaId: string) {
  const activity = await prisma.activity.findUnique({ where: { id } });
  if (!activity) {
    throw new NotFoundError("Activity not found.");
  }
  if (activity.hostId !== hostId) {
    throw new ForbiddenError("You can only modify your own activities.");
  }

  const existingMedia = castMediaArray(activity.media);

  const mediaIndex = existingMedia.findIndex(
    (m) => (m as unknown as Record<string, unknown>)._id?.toString() === mediaId || m.publicId === mediaId,
  );

  if (mediaIndex === -1) {
    throw new NotFoundError("Media item not found.");
  }

  const mediaItem = existingMedia[mediaIndex]!;

  // Delete from S3 (or Cloudinary fallback)
  await deleteMedia(
    mediaItem.publicId,
    mediaItem.publicId?.startsWith("http") || !mediaItem.publicId?.includes("/"),
  );

  existingMedia.splice(mediaIndex, 1);

  const firstRemaining = existingMedia[0];
  if (mediaItem.isCover && firstRemaining) {
    existingMedia[0] = { ...firstRemaining, isCover: true };
  }

  await prisma.activity.update({
    where: { id },
    data: { media: existingMedia as unknown as object[] },
  });

  // Invalidate caches: browse results + this activity's public page (media changed)
  await cacheDelPattern("activities:browse:*");
  await cacheDelPattern("activities:public:*");

  return { totalPhotos: existingMedia.length };
}

/**
 * Browses published activities with filtering, sorting, and pagination.
 * Results are cached in Redis (5-minute TTL) for fast subsequent reads.
 */
export async function browseActivities(query: BrowseActivitiesQuery) {
  const cacheKey = `activities:browse:${JSON.stringify(query)}`;

  return cacheWrap(
    cacheKey,
    async () => {
      const filter: Record<string, unknown> = { status: "published", isActive: true };

      if (query.city) filter.city = { contains: query.city, mode: "insensitive" };
      if (query.state) filter.state = { contains: query.state, mode: "insensitive" };
      if (query.activityType) {
        const formattedType = query.activityType.charAt(0).toUpperCase() + query.activityType.slice(1).toLowerCase();
        filter.activityType = { equals: formattedType, mode: "insensitive" };
      }
      if (query.difficulty) {
        const formattedDiff = query.difficulty.charAt(0).toUpperCase() + query.difficulty.slice(1).toLowerCase();
        filter.difficulty = { equals: formattedDiff, mode: "insensitive" };
      }
      if (query.minPrice) {
        filter.basePrice = { gte: parseInt(query.minPrice, 10) };
      }
      if (query.maxPrice) {
        filter.basePrice = { ...(filter.basePrice as object), lte: parseInt(query.maxPrice, 10) };
      }

      const { page, limit, skip } = resolvePagination(query.page, query.limit, 20, 50);

      const sortStr = query.sort || "-updatedAt";
      const sortField = sortStr.startsWith("-") ? sortStr.substring(1) : sortStr;
      const sortOrder = sortStr.startsWith("-") ? "desc" : "asc";
      const orderBy = { [sortField]: sortOrder };

      const [activities, total] = await Promise.all([
        prisma.activity.findMany({
          where: filter,
          orderBy,
          skip,
          take: limit,
        }),
        prisma.activity.count({ where: filter }),
      ]);

      const mapped = activities.map((a) => {
        const m = mapActivityResponse(a as unknown as Record<string, unknown>);
        if (m) {
          (m as Record<string, unknown>).effectiveWeekendPrice = computeEffectiveWeekendPrice(
            (a as unknown as Record<string, unknown>).basePrice as number,
            (a as unknown as Record<string, unknown>).weekendPrice as number | undefined,
          );
        }
        return m;
      });

      return {
        activities: mapped,
        pagination: buildPaginationMeta(page, limit, total),
      };
    },
    300, // 5-minute TTL for browse results
  );
}

/**
 * Returns a public activity by slug (or ID fallback) with host info.
 * Cached in Redis (10-minute TTL) for fast subsequent reads.
 */
export async function getPublicActivity(slug: string) {
  const cacheKey = `activities:public:${slug}`;

  return cacheWrap(
    cacheKey,
    async () => {
      let activity = await prisma.activity.findFirst({
        where: { slug, status: "published", isActive: true },
      });
      if (!activity) {
        try {
          activity = await prisma.activity.findFirst({
            where: { id: slug, status: "published", isActive: true },
          });
        } catch {
          // invalid ID format → ignore
        }
      }

      if (!activity) {
        throw new NotFoundError("Activity not found.");
      }

      const enriched = await populateHostForActivity(activity as unknown as Record<string, unknown>);
      if (enriched) {
        (enriched as Record<string, unknown>).effectiveWeekendPrice = computeEffectiveWeekendPrice(
          (activity as unknown as Record<string, unknown>).basePrice as number,
          (activity as unknown as Record<string, unknown>).weekendPrice as number | undefined,
        );
      }

      return enriched;
    },
    600, // 10-minute TTL for individual activity pages
  );
}