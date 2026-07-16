import { prisma } from "../config/db.js";
import { cacheWrap } from "../config/redis.js";
import { logger } from "../core/logger.js";

// ─── Types ───
export interface SearchQuery {
  q: string;
  type?: string; // all | listings | activities
  city?: string;
  state?: string;
  minPrice?: string;
  maxPrice?: string;
  guests?: string;
  sort?: string; // relevance | price_asc | price_desc | rating
  page?: string;
  limit?: string;
}

export interface SearchResult {
  id: string;
  type: "listing" | "activity";
  name: string;
  slug: string;
  description: string;
  summary: string;
  city: string;
  state: string;
  basePrice: number;
  weekendPrice: number | null;
  avgRating: number;
  totalReviews: number;
  media: unknown;
  isFeatured: boolean;
  propertyType?: string;
  activityType?: string;
  maxGuests: number;
  bedrooms?: number;
  durationHours?: number;
  rank: number;
}

function resolvePagination(pageStr?: string, limitStr?: string, defaultLimit = 20, maxLimit = 50) {
  const page = Math.max(1, parseInt(pageStr || "1", 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(limitStr || String(defaultLimit), 10) || defaultLimit));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

/**
 * Build a PostgreSQL tsquery string from user input.
 * Converts "luxury villa goa" → "luxury & villa & goa"
 */
function buildTsQuery(q: string): string {
  // Escape single quotes for SQL safety
  const escaped = q.replace(/'/g, "''").trim();
  if (!escaped) return "";
  // Split into words, join with & for AND matching
  const words = escaped.split(/\s+/).filter(Boolean);
  return words.join(" & ");
}

/**
 * Unified search across listings and activities using PostgreSQL full-text search.
 * Falls back to ILIKE if FTS doesn't match (for partial word matches).
 */
export async function searchAll(query: SearchQuery) {
  const cacheKey = `search:${JSON.stringify(query)}`;

  return cacheWrap(
    cacheKey,
    async () => {
      const { page, limit, offset } = resolvePagination(query.page, query.limit, 20, 50);
      const tsQuery = buildTsQuery(query.q);

      if (!tsQuery) {
        return {
          results: [],
          pagination: { page, limit, total: 0, totalPages: 0 },
        };
      }

      // Build WHERE clauses
      const listingConditions: string[] = [
        "l.status = 'published'",
        "l.\"isActive\" = true",
        `(l.search_vector @@ to_tsquery('english', $1) OR l.name ILIKE '%' || $2 || '%' OR l.description ILIKE '%' || $2 || '%' OR l.city ILIKE '%' || $2 || '%' OR l.summary ILIKE '%' || $2 || '%')`,
      ];
      const activityConditions: string[] = [
        "a.status = 'published'",
        "a.\"isActive\" = true",
        `(a.search_vector @@ to_tsquery('english', $1) OR a.name ILIKE '%' || $2 || '%' OR a.description ILIKE '%' || $2 || '%' OR a.city ILIKE '%' || $2 || '%' OR a.summary ILIKE '%' || $2 || '%')`,
      ];

      const params: unknown[] = [tsQuery, query.q];
      let paramIdx = 3;

      if (query.city) {
        listingConditions.push(`l.city ILIKE '%' || $${paramIdx} || '%'`);
        activityConditions.push(`a.city ILIKE '%' || $${paramIdx} || '%'`);
        params.push(query.city);
        paramIdx++;
      }

      if (query.state) {
        listingConditions.push(`a.state ILIKE '%' || $${paramIdx} || '%'`);
        activityConditions.push(`a.state ILIKE '%' || $${paramIdx} || '%'`);
        params.push(query.state);
        paramIdx++;
      }

      if (query.minPrice) {
        listingConditions.push(`l.\"basePrice\" >= $${paramIdx}::float`);
        activityConditions.push(`a.\"basePrice\" >= $${paramIdx}::float`);
        params.push(parseFloat(query.minPrice));
        paramIdx++;
      }

      if (query.maxPrice) {
        listingConditions.push(`l.\"basePrice\" <= $${paramIdx}::float`);
        activityConditions.push(`a.\"basePrice\" <= $${paramIdx}::float`);
        params.push(parseFloat(query.maxPrice));
        paramIdx++;
      }

      if (query.guests) {
        listingConditions.push(`l.\"maxGuests\" >= $${paramIdx}::int`);
        activityConditions.push(`a.\"maxGroupSize\" >= $${paramIdx}::int`);
        params.push(parseInt(query.guests, 10));
        paramIdx++;
      }

      const listingWhere = listingConditions.join(" AND ");
      const activityWhere = activityConditions.join(" AND ");

      // Determine which types to search
      const searchListings = !query.type || query.type === "all" || query.type === "listings";
      const searchActivities = !query.type || query.type === "all" || query.type === "activities";

      // Build UNION query
      const unions: string[] = [];

      if (searchListings) {
        unions.push(`
          SELECT
            l.id,
            'listing' AS type,
            l.name,
            l.slug,
            LEFT(l.description, 500) AS description,
            l.summary,
            l.city,
            l.state,
            l.\"basePrice\",
            l.\"weekendPrice\",
            l.\"avgRating\",
            l.\"totalReviews\",
            l.media,
            l.\"isFeatured\",
            l.\"propertyType\",
            NULL::text AS \"activityType\",
            l.\"maxGuests\",
            l.bedrooms,
            NULL::float AS \"durationHours\",
            ts_rank(l.search_vector, to_tsquery('english', $1)) AS rank
          FROM \"Listing\" l
          WHERE ${listingWhere}
        `);
      }

      if (searchActivities) {
        unions.push(`
          SELECT
            a.id,
            'activity' AS type,
            a.name,
            a.slug,
            LEFT(a.description, 500) AS description,
            a.summary,
            a.city,
            a.state,
            a.\"basePrice\",
            a.\"weekendPrice\",
            a.\"avgRating\",
            a.\"totalReviews\",
            a.media,
            a.\"isFeatured\",
            NULL::text AS \"propertyType\",
            a.\"activityType\",
            a.\"maxGroupSize\" AS \"maxGuests\",
            NULL::int AS bedrooms,
            a.\"durationHours\",
            ts_rank(a.search_vector, to_tsquery('english', $1)) AS rank
          FROM \"Activity\" a
          WHERE ${activityWhere}
        `);
      }

      if (unions.length === 0) {
        return {
          results: [],
          pagination: { page, limit, total: 0, totalPages: 0 },
        };
      }

      // Sort clause
      let orderBy = "rank DESC, \"isFeatured\" DESC, \"avgRating\" DESC";
      if (query.sort === "price_asc") orderBy = "\"basePrice\" ASC";
      else if (query.sort === "price_desc") orderBy = "\"basePrice\" DESC";
      else if (query.sort === "rating") orderBy = "\"avgRating\" DESC, \"totalReviews\" DESC";

      const unionSql = unions.join(" UNION ALL ");
      const countSql = `SELECT COUNT(*) AS total FROM (${unionSql}) AS combined`;
      const dataSql = `SELECT * FROM (${unionSql}) AS combined ORDER BY ${orderBy} LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
      params.push(limit);
      params.push(offset);

      const [countResult, dataResult] = await Promise.all([
        prisma.$queryRawUnsafe<{ total: bigint }[]>(countSql, ...params.slice(0, -2)),
        prisma.$queryRawUnsafe<SearchResult[]>(dataSql, ...params),
      ]);

      const total = Number(countResult[0]?.total || 0);

      // Serialize media JSON
      const results = dataResult.map((r) => {
        const row = r as unknown as Record<string, unknown>;
        let media = row.media;
        if (typeof media === "string") {
          try {
            media = JSON.parse(media);
          } catch {
            media = [];
          }
        }
        return {
          ...row,
          media,
          basePrice: Number(row.basePrice),
          weekendPrice: row.weekendPrice ? Number(row.weekendPrice) : null,
          avgRating: Number(row.avgRating),
          totalReviews: Number(row.totalReviews),
          maxGuests: Number(row.maxGuests),
          bedrooms: row.bedrooms ? Number(row.bedrooms) : undefined,
          durationHours: row.durationHours ? Number(row.durationHours) : undefined,
          rank: Number(row.rank),
        } as SearchResult;
      });

      return {
        results,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    },
    120, // 2-minute TTL for search results
  );
}

/**
 * Autocomplete suggestions for search bar.
 * Returns matching names from listings and activities.
 */
export async function searchSuggestions(q: string) {
  if (!q || q.trim().length < 2) {
    return { suggestions: [] };
  }

  const cacheKey = `search:suggestions:${q.trim().toLowerCase()}`;

  return cacheWrap(
    cacheKey,
    async () => {
      const escaped = q.replace(/'/g, "''").trim();
      const pattern = `%${escaped}%`;

      const [listings, activities] = await Promise.all([
        prisma.$queryRaw<{ id: string; name: string; slug: string; type: string; city: string }[]>`
          SELECT id, name, slug, 'listing' AS type, city
          FROM "Listing"
          WHERE status = 'published' AND "isActive" = true
            AND (name ILIKE ${pattern} OR city ILIKE ${pattern} OR summary ILIKE ${pattern})
          ORDER BY "isFeatured" DESC, "avgRating" DESC
          LIMIT 5
        `,
        prisma.$queryRaw<{ id: string; name: string; slug: string; type: string; city: string }[]>`
          SELECT id, name, slug, 'activity' AS type, city
          FROM "Activity"
          WHERE status = 'published' AND "isActive" = true
            AND (name ILIKE ${pattern} OR city ILIKE ${pattern} OR summary ILIKE ${pattern})
          ORDER BY "isFeatured" DESC, "avgRating" DESC
          LIMIT 5
        `,
      ]);

      const suggestions = [
        ...listings.map((l) => ({ ...l, type: "listing" as const })),
        ...activities.map((a) => ({ ...a, type: "activity" as const })),
      ];

      return { suggestions };
    },
    300, // 5-minute TTL for suggestions
  );
}

/**
 * Get popular/trending searches based on listing/activity views and ratings.
 */
export async function getTrendingSearches() {
  const cacheKey = "search:trending";

  return cacheWrap(
    cacheKey,
    async () => {
      const [listings, activities] = await Promise.all([
        prisma.listing.findMany({
          where: { status: "published", isActive: true, isFeatured: true },
          select: { id: true, name: true, slug: true, city: true, basePrice: true, avgRating: true, media: true },
          orderBy: { avgRating: "desc" },
          take: 5,
        }),
        prisma.activity.findMany({
          where: { status: "published", isActive: true, isFeatured: true },
          select: { id: true, name: true, slug: true, city: true, basePrice: true, avgRating: true, media: true },
          orderBy: { avgRating: "desc" },
          take: 5,
        }),
      ]);

      return {
        trending: [
          ...listings.map((l) => ({ ...l, type: "listing" as const })),
          ...activities.map((a) => ({ ...a, type: "activity" as const })),
        ],
      };
    },
    600, // 10-minute TTL for trending
  );
}

/**
 * Create GIN index for full-text search on Listing and Activity tables.
 * This should be run as a migration or startup script.
 */
export async function ensureSearchIndexes(): Promise<void> {
  try {
    // Create search_vector columns and GIN indexes for listings
    await prisma.$executeRawUnsafe(`
      -- Listing search vector
      ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS search_vector tsvector;
      UPDATE "Listing" SET search_vector = 
        setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(description, '')), 'C') ||
        setweight(to_tsvector('english', coalesce(city, '')), 'D')
      WHERE search_vector IS NULL;
      CREATE INDEX IF NOT EXISTS listing_search_idx ON "Listing" USING GIN (search_vector);
    `);

    // Create search_vector columns and GIN indexes for activities
    await prisma.$executeRawUnsafe(`
      -- Activity search vector
      ALTER TABLE "Activity" ADD COLUMN IF NOT EXISTS search_vector tsvector;
      UPDATE "Activity" SET search_vector = 
        setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(description, '')), 'C') ||
        setweight(to_tsvector('english', coalesce(city, '')), 'D')
      WHERE search_vector IS NULL;
      CREATE INDEX IF NOT EXISTS activity_search_idx ON "Activity" USING GIN (search_vector);
    `);

    logger.info("Search indexes ensured successfully.");
  } catch (err) {
    logger.warn("Could not ensure search indexes (may already exist):", (err as Error).message);
  }
}
