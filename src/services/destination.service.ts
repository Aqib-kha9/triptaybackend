import { prisma } from "../config/db.js";
import { NotFoundError, BadRequestError, ConflictError } from "../core/errors.js";
import { generateSlug, ensureUniqueSlug } from "../utils/slug.js";
import { buildPaginationMeta } from "../utils/pagination.js";
import { cacheWrap, cacheDelPattern } from "../config/redis.js";

// ──────────────────────── Types ────────────────────────

export interface DestinationResponse {
  _id: string;
  id: string;
  name: string;
  slug: string;
  state: string;
  city: string;
  image: string;
  category: string;
  description: string;
  isActive: boolean;
  popularityScore: number;
  coordinates: {
    lat: number;
    lng: number;
  };
  createdAt: Date;
  updatedAt: Date;
  [key: string]: unknown;
}

export interface CreateDestinationInput {
  name: string;
  state: string;
  city: string;
  image: string;
  category: string;
  coordinates: { lat: number; lng: number };
  description?: string;
}

export interface UpdateDestinationInput {
  name?: string;
  state?: string;
  city?: string;
  image?: string;
  category?: string;
  coordinates?: { lat: number; lng: number };
  description?: string;
  isActive?: boolean;
  popularityScore?: number;
}

// ──────────────────────── Helpers ────────────────────────

function resolvePagination(
  pageStr?: string,
  limitStr?: string,
  defaultLimit = 12,
  maxLimit = 50,
): { page: number; limit: number; skip: number } {
  const page = Math.max(1, parseInt(pageStr || "1", 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(limitStr || String(defaultLimit), 10) || defaultLimit));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

const VALID_CATEGORIES = ["Nature", "Adventure", "Historical", "Spiritual"] as const;

function mapDestination(dest: Record<string, unknown>): DestinationResponse {
  return {
    ...dest,
    _id: dest.id as string,
    id: dest.id as string,
    coordinates: {
      lat: dest.lat as number,
      lng: dest.lng as number,
    },
  } as unknown as DestinationResponse;
}

function validateCategory(category: string): void {
  if (!VALID_CATEGORIES.includes(category as (typeof VALID_CATEGORIES)[number])) {
    throw new BadRequestError(
      `Invalid category "${category}". Must be one of: ${VALID_CATEGORIES.join(", ")}`,
    );
  }
}

function validateCoordinates(coordinates: { lat: number; lng: number }): void {
  if (typeof coordinates.lat !== "number" || typeof coordinates.lng !== "number") {
    throw new BadRequestError("Coordinates must include numeric lat and lng.");
  }
}

// ──────────────────────── Service Functions ────────────────────────

/**
 * Public: get all active destinations with optional category filtering.
 * Ordered by popularityScore desc, then createdAt desc.
 */
export async function getAllDestinations(
  pageStr?: string,
  limitStr?: string,
  category?: string,
) {
  // Build a cache key from the query parameters
  const cacheKey = `destinations:browse:${JSON.stringify({ pageStr, limitStr, category })}`;

  return cacheWrap(
    cacheKey,
    async () => {
      const { page, limit, skip } = resolvePagination(pageStr, limitStr);

      const filter: Record<string, unknown> = { isActive: true };
      if (category && VALID_CATEGORIES.includes(category as (typeof VALID_CATEGORIES)[number])) {
        filter.category = category;
      }

      const [destinations, total] = await Promise.all([
        prisma.destination.findMany({
          where: filter as any,
          orderBy: [{ popularityScore: "desc" }, { createdAt: "desc" }],
          skip,
          take: limit,
        }),
        prisma.destination.count({ where: filter as any }),
      ]);

      const mapped = destinations.map((d) =>
        mapDestination(d as unknown as Record<string, unknown>),
      );

      const pagination = buildPaginationMeta(page, limit, total);

      return { destinations: mapped, pagination };
    },
    300, // 5-minute TTL for browse results
  );
}

/**
 * Public: get a single active destination by slug.
 */
export async function getDestination(slug: string) {
  const cacheKey = `destinations:public:${slug}`;

  return cacheWrap(
    cacheKey,
    async () => {
      const destination = await prisma.destination.findFirst({
        where: { slug, isActive: true },
      });

      if (!destination) {
        throw new NotFoundError("Destination not found.");
      }

      return { destination: mapDestination(destination as unknown as Record<string, unknown>) };
    },
    600, // 10-minute TTL for individual destination pages
  );
}

/**
 * Admin: create a new destination.
 */
export async function createDestination(data: CreateDestinationInput) {
  validateCategory(data.category);
  validateCoordinates(data.coordinates);

  const baseSlug = generateSlug(data.name);
  const slug = await ensureUniqueSlug(baseSlug, async (s) => {
    const existing = await prisma.destination.findUnique({ where: { slug: s } as any });
    return !!existing;
  });

  try {
    const destination = await prisma.destination.create({
      data: {
        name: data.name,
        slug,
        state: data.state,
        city: data.city,
        image: data.image,
        category: data.category,
        lat: data.coordinates.lat,
        lng: data.coordinates.lng,
        description: data.description || "",
        popularityScore: 0,
      },
    });

    // Invalidate browse cache (new destination may appear in browse results)
    await cacheDelPattern("destinations:browse:*");

    return { destination: mapDestination(destination as unknown as Record<string, unknown>) };
  } catch (err: any) {
    if (err.code === "P2002") {
      throw new ConflictError("A destination with this name/slug already exists.");
    }
    throw err;
  }
}

/**
 * Admin: update an existing destination.
 */
export async function updateDestination(id: string, data: UpdateDestinationInput) {
  const existing = await prisma.destination.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError("Destination not found.");
  }

  if (data.category !== undefined) {
    validateCategory(data.category);
  }

  if (data.coordinates !== undefined) {
    validateCoordinates(data.coordinates);
  }

  const updateData: Record<string, unknown> = {};

  if (data.name !== undefined) {
    updateData.name = data.name;
    const baseSlug = generateSlug(data.name);
    updateData.slug = await ensureUniqueSlug(baseSlug, async (s) => {
      const found = await prisma.destination.findUnique({ where: { slug: s } as any });
      return found ? found.id !== id : false;
    });
  }

  if (data.state !== undefined) updateData.state = data.state;
  if (data.city !== undefined) updateData.city = data.city;
  if (data.image !== undefined) updateData.image = data.image;
  if (data.category !== undefined) updateData.category = data.category;
  if (data.coordinates !== undefined) {
    updateData.lat = data.coordinates.lat;
    updateData.lng = data.coordinates.lng;
  }
  if (data.description !== undefined) updateData.description = data.description;
  if (data.isActive !== undefined) updateData.isActive = data.isActive;
  if (data.popularityScore !== undefined) updateData.popularityScore = data.popularityScore;

  try {
    const updated = await prisma.destination.update({
      where: { id },
      data: updateData as any,
    });

    // Invalidate caches: browse results + this destination's public page (old & new slug)
    await cacheDelPattern("destinations:browse:*");
    await cacheDelPattern("destinations:public:*");

    return { destination: mapDestination(updated as unknown as Record<string, unknown>) };
  } catch (err: any) {
    if (err.code === "P2002") {
      throw new ConflictError("A destination with this slug already exists.");
    }
    throw err;
  }
}

/**
 * Admin: delete a destination.
 */
export async function deleteDestination(id: string) {
  const existing = await prisma.destination.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError("Destination not found.");
  }

  await prisma.destination.delete({ where: { id } });

  // Invalidate caches: browse results + this destination's public page
  await cacheDelPattern("destinations:browse:*");
  await cacheDelPattern("destinations:public:*");

  return { name: existing.name };
}

/**
 * Admin: list all destinations with optional search and category filter.
 */
export async function adminListDestinations(
  pageStr?: string,
  limitStr?: string,
  category?: string,
  includeInactive?: boolean,
) {
  const { page, limit, skip } = resolvePagination(pageStr, limitStr, 10, 100);

  const filter: Record<string, unknown> = {};
  if (!includeInactive) {
    filter.isActive = true;
  }
  if (category && VALID_CATEGORIES.includes(category as (typeof VALID_CATEGORIES)[number])) {
    filter.category = category;
  }

  const [destinations, total] = await Promise.all([
    prisma.destination.findMany({
      where: filter as any,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.destination.count({ where: filter as any }),
  ]);

  const mapped = destinations.map((d) =>
    mapDestination(d as unknown as Record<string, unknown>),
  );

  const pagination = buildPaginationMeta(page, limit, total);

  return { destinations: mapped, pagination };
}

/**
 * Admin: get a single destination by ID (including inactive).
 */
export async function adminGetDestination(id: string) {
  const destination = await prisma.destination.findUnique({ where: { id } });

  if (!destination) {
    throw new NotFoundError("Destination not found.");
  }

  return { destination: mapDestination(destination as unknown as Record<string, unknown>) };
}