import { prisma } from "../config/db.js";
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
} from "../core/errors.js";
import { logger } from "../core/logger.js";
import { cacheWrap, cacheDelPattern } from "../config/redis.js";

// ─── Types ───
export interface CreateReviewInput {
  bookingId: string;
  rating: number;
  title?: string;
  comment?: string;
}

export interface ReviewListQuery {
  page?: string;
  limit?: string;
  rating?: string;
  sort?: string; // newest | highest | lowest
}

export interface AdminReviewListQuery extends ReviewListQuery {
  itemType?: string;
  isApproved?: string;
}

function resolvePagination(pageStr?: string, limitStr?: string, defaultLimit = 20, maxLimit = 100) {
  const page = Math.max(1, parseInt(pageStr || "1", 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(limitStr || String(defaultLimit), 10) || defaultLimit));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

// ─── Fetch user info for a list of reviews ───
async function enrichReviewsWithUser(reviews: Record<string, unknown>[]) {
  const userIds = [...new Set(reviews.map((r) => r.userId as string).filter(Boolean))];
  if (userIds.length === 0) return reviews;

  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, avatar: true },
  });

  const userMap = new Map(users.map((u) => [u.id, u]));

  return reviews.map((r) => ({
    ...r,
    user: userMap.get(r.userId as string) || null,
  }));
}

// ─── Map a review row to a response object ───
function mapReview(r: Record<string, unknown>) {
  const user = r.user as Record<string, unknown> | undefined;
  return {
    id: r.id,
    userId: r.userId,
    itemId: r.itemId,
    itemType: r.itemType,
    bookingId: r.bookingId,
    rating: r.rating,
    title: r.title,
    comment: r.comment,
    isApproved: r.isApproved,
    hostReply: r.hostReply,
    hostRepliedAt: r.hostRepliedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    user: user
      ? {
          id: user.id,
          name: user.name,
          avatar: user.avatar,
        }
      : null,
  };
}

// ─── Create a review (user reviews an item after a completed booking) ───
export async function createReview(userId: string, data: CreateReviewInput) {
  // 1. Validate the booking exists, belongs to the user, and is completed
  const booking = await prisma.booking.findUnique({
    where: { id: data.bookingId },
    select: {
      id: true,
      userId: true,
      itemId: true,
      itemType: true,
      itemName: true,
      status: true,
      hostId: true,
    },
  });

  if (!booking) {
    throw new NotFoundError("Booking not found.");
  }

  if (booking.userId !== userId) {
    throw new ForbiddenError("You can only review items from your own bookings.");
  }

  if (booking.status !== "completed") {
    throw new BadRequestError("You can only review after the booking is completed.");
  }

  // 2. Check if the user has already reviewed this item
  const existing = await prisma.review.findUnique({
    where: {
      userId_itemId_itemType: {
        userId,
        itemId: booking.itemId,
        itemType: booking.itemType,
      },
    },
  });

  if (existing) {
    throw new BadRequestError("You have already reviewed this item. You can edit your review instead.");
  }

  // 3. Create the review
  const review = await prisma.review.create({
    data: {
      userId,
      itemId: booking.itemId,
      itemType: booking.itemType,
      bookingId: booking.id,
      rating: data.rating,
      title: data.title || booking.itemName || null,
      comment: data.comment || null,
      isApproved: true, // Auto-approve by default for immediate feedback
    },
  });

  // 4. Fetch user info
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, avatar: true },
  });

  // 5. Invalidate caches
  await cacheDelPattern(`reviews:${booking.itemType}:${booking.itemId}:*`);
  await cacheDelPattern(`reviews:public:${booking.itemType}:${booking.itemId}:*`);
  await cacheDelPattern(`reviews:summary:${booking.itemType}:${booking.itemId}`);

  logger.info(`Review created by user ${userId} for ${booking.itemType} ${booking.itemId} (rating: ${data.rating})`);

  const reviewWithUser = { ...review, user };
  return mapReview(reviewWithUser as unknown as Record<string, unknown>);
}

// ─── Get my reviews (user) ───
export async function getMyReviews(userId: string, query: ReviewListQuery) {
  const { page, limit, skip } = resolvePagination(query.page, query.limit);

  const where: Record<string, unknown> = { userId };

  if (query.rating) {
    const rating = parseInt(query.rating, 10);
    if (!isNaN(rating) && rating >= 1 && rating <= 5) {
      where.rating = rating;
    }
  }

  let orderBy: Record<string, string> = { createdAt: "desc" };
  if (query.sort === "highest") {
    orderBy = { rating: "desc" };
  } else if (query.sort === "lowest") {
    orderBy = { rating: "asc" };
  }

  const [reviews, total] = await Promise.all([
    prisma.review.findMany({
      where,
      skip,
      take: limit,
      orderBy,
    }),
    prisma.review.count({ where }),
  ]);

  const enriched = await enrichReviewsWithUser(reviews as unknown as Record<string, unknown>[]);

  return {
    reviews: enriched.map((r) => mapReview(r)),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

// ─── Update my review (user can edit within a window) ───
export async function updateMyReview(reviewId: string, userId: string, data: Partial<CreateReviewInput>) {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
  });

  if (!review) {
    throw new NotFoundError("Review not found.");
  }

  if (review.userId !== userId) {
    throw new ForbiddenError("You can only edit your own reviews.");
  }

  const updateData: Record<string, unknown> = {};
  if (data.rating !== undefined) updateData.rating = data.rating;
  if (data.title !== undefined) updateData.title = data.title || null;
  if (data.comment !== undefined) updateData.comment = data.comment || null;

  // Editing resets approval status
  updateData.isApproved = false;

  const updated = await prisma.review.update({
    where: { id: reviewId },
    data: updateData,
  });

  // Invalidate caches
  await cacheDelPattern(`reviews:${review.itemType}:${review.itemId}:*`);
  await cacheDelPattern(`reviews:public:${review.itemType}:${review.itemId}:*`);
  await cacheDelPattern(`reviews:summary:${review.itemType}:${review.itemId}`);

  logger.info(`Review ${reviewId} updated by user ${userId}.`);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, avatar: true },
  });

  const reviewWithUser = { ...updated, user };
  return mapReview(reviewWithUser as unknown as Record<string, unknown>);
}

// ─── Delete my review (user) ───
export async function deleteMyReview(reviewId: string, userId: string) {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
  });

  if (!review) {
    throw new NotFoundError("Review not found.");
  }

  if (review.userId !== userId) {
    throw new ForbiddenError("You can only delete your own reviews.");
  }

  await prisma.review.delete({ where: { id: reviewId } });

  // Invalidate caches
  await cacheDelPattern(`reviews:${review.itemType}:${review.itemId}:*`);
  await cacheDelPattern(`reviews:public:${review.itemType}:${review.itemId}:*`);
  await cacheDelPattern(`reviews:summary:${review.itemType}:${review.itemId}`);

  logger.info(`Review ${reviewId} deleted by user ${userId}.`);

  return { id: reviewId };
}

// ─── Get public reviews for an item (only approved) ───
export async function getItemReviews(itemType: string, itemId: string, query: ReviewListQuery) {
  const cacheKey = `reviews:public:${itemType}:${itemId}:${query.page || 1}:${query.limit || 20}:${query.sort || "newest"}:${query.rating || "all"}`;

  return cacheWrap(
    cacheKey,
    async () => {
      const { page, limit, skip } = resolvePagination(query.page, query.limit);

      const where: Record<string, unknown> = {
        itemId,
        itemType,
        isApproved: true,
      };

      if (query.rating) {
        const rating = parseInt(query.rating, 10);
        if (!isNaN(rating) && rating >= 1 && rating <= 5) {
          where.rating = rating;
        }
      }

      let orderBy: Record<string, string> = { createdAt: "desc" };
      if (query.sort === "highest") {
        orderBy = { rating: "desc" };
      } else if (query.sort === "lowest") {
        orderBy = { rating: "asc" };
      }

      const [reviews, total] = await Promise.all([
        prisma.review.findMany({
          where,
          skip,
          take: limit,
          orderBy,
        }),
        prisma.review.count({ where }),
      ]);

      const enriched = await enrichReviewsWithUser(reviews as unknown as Record<string, unknown>[]);

      return {
        reviews: enriched.map((r) => mapReview(r)),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    },
    300, // 5 min cache
  );
}

// ─── Get rating summary for an item ───
export async function getItemRatingSummary(itemType: string, itemId: string) {
  const cacheKey = `reviews:summary:${itemType}:${itemId}`;

  return cacheWrap(
    cacheKey,
    async () => {
      const reviews = await prisma.review.findMany({
        where: { itemId, itemType, isApproved: true },
        select: { rating: true },
      });

      const total = reviews.length;
      const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
      const avgRating = total > 0 ? Math.round((sum / total) * 10) / 10 : 0;

      const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      for (const r of reviews) {
        distribution[r.rating] = (distribution[r.rating] || 0) + 1;
      }

      return {
        totalReviews: total,
        avgRating,
        distribution,
      };
    },
    600, // 10 min cache
  );
}

// ─── Host replies to a review ───
export async function replyToReview(reviewId: string, hostId: string, reply: string) {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
  });

  if (!review) {
    throw new NotFoundError("Review not found.");
  }

  // Verify the host owns the item
  let ownsItem = false;
  if (review.itemType === "listing") {
    const listing = await prisma.listing.findUnique({
      where: { id: review.itemId },
      select: { hostId: true },
    });
    ownsItem = listing?.hostId === hostId;
  } else if (review.itemType === "activity") {
    const activity = await prisma.activity.findUnique({
      where: { id: review.itemId },
      select: { hostId: true },
    });
    ownsItem = activity?.hostId === hostId;
  }

  if (!ownsItem) {
    throw new ForbiddenError("Only the host of this item can reply to reviews.");
  }

  if (review.hostReply) {
    throw new BadRequestError("A reply has already been added to this review.");
  }

  const updated = await prisma.review.update({
    where: { id: reviewId },
    data: {
      hostReply: reply,
      hostRepliedAt: new Date(),
    },
  });

  // Invalidate caches
  await cacheDelPattern(`reviews:public:${review.itemType}:${review.itemId}:*`);
  await cacheDelPattern(`reviews:summary:${review.itemType}:${review.itemId}`);

  logger.info(`Host ${hostId} replied to review ${reviewId}.`);

  const user = await prisma.user.findUnique({
    where: { id: review.userId },
    select: { id: true, name: true, avatar: true },
  });

  const reviewWithUser = { ...updated, user };
  return mapReview(reviewWithUser as unknown as Record<string, unknown>);
}

// ─── ADMIN: List all reviews ───
export async function listAllReviews(query: AdminReviewListQuery) {
  const { page, limit, skip } = resolvePagination(query.page, query.limit);

  const where: Record<string, unknown> = {};

  if (query.itemType) {
    where.itemType = query.itemType;
  }

  if (query.isApproved !== undefined) {
    where.isApproved = query.isApproved === "true";
  }

  if (query.rating) {
    const rating = parseInt(query.rating, 10);
    if (!isNaN(rating) && rating >= 1 && rating <= 5) {
      where.rating = rating;
    }
  }

  let orderBy: Record<string, string> = { createdAt: "desc" };
  if (query.sort === "highest") {
    orderBy = { rating: "desc" };
  } else if (query.sort === "lowest") {
    orderBy = { rating: "asc" };
  }

  const [reviews, total] = await Promise.all([
    prisma.review.findMany({
      where,
      skip,
      take: limit,
      orderBy,
    }),
    prisma.review.count({ where }),
  ]);

  const enriched = await enrichReviewsWithUser(reviews as unknown as Record<string, unknown>[]);

  return {
    reviews: enriched.map((r) => mapReview(r)),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

// ─── ADMIN: Approve / reject a review ───
export async function setReviewApproval(reviewId: string, isApproved: boolean, adminId: string) {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
  });

  if (!review) {
    throw new NotFoundError("Review not found.");
  }

  const updated = await prisma.review.update({
    where: { id: reviewId },
    data: { isApproved },
  });

  // Invalidate caches
  await cacheDelPattern(`reviews:public:${review.itemType}:${review.itemId}:*`);
  await cacheDelPattern(`reviews:summary:${review.itemType}:${review.itemId}`);

  logger.info(`Review ${reviewId} ${isApproved ? "approved" : "rejected"} by admin ${adminId}.`);

  const user = await prisma.user.findUnique({
    where: { id: review.userId },
    select: { id: true, name: true, avatar: true },
  });

  const reviewWithUser = { ...updated, user };
  return mapReview(reviewWithUser as unknown as Record<string, unknown>);
}

// ─── ADMIN: Delete a review ───
export async function deleteReview(reviewId: string, adminId: string) {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
  });

  if (!review) {
    throw new NotFoundError("Review not found.");
  }

  await prisma.review.delete({ where: { id: reviewId } });

  // Invalidate caches
  await cacheDelPattern(`reviews:public:${review.itemType}:${review.itemId}:*`);
  await cacheDelPattern(`reviews:summary:${review.itemType}:${review.itemId}`);

  logger.info(`Review ${reviewId} deleted by admin ${adminId}.`);

  return { id: reviewId };
}

// ─── ADMIN: Get review statistics ───
export async function getReviewStats() {
  const [total, approved, pending, totalRating] = await Promise.all([
    prisma.review.count(),
    prisma.review.count({ where: { isApproved: true } }),
    prisma.review.count({ where: { isApproved: false } }),
    prisma.review.aggregate({ _avg: { rating: true }, _sum: { rating: true } }),
  ]);

  const distribution = await prisma.review.groupBy({
    by: ["rating"],
    _count: { rating: true },
    orderBy: { rating: "desc" },
  });

  const distMap: Record<number, number> = {};
  for (const d of distribution) {
    distMap[d.rating] = d._count.rating;
  }

  return {
    totalReviews: total,
    approvedReviews: approved,
    pendingReviews: pending,
    avgRating: totalRating._avg.rating ? Math.round(totalRating._avg.rating * 10) / 10 : 0,
    distribution: distMap,
  };
}
