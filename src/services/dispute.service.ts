import { prisma } from "../config/db.js";
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
} from "../core/errors.js";
import { logger } from "../core/logger.js";
import { createAuditLog } from "./audit.service.js";
import { processRefund } from "./payment.service.js";
import { cacheDelPattern } from "../config/redis.js";

// ─── Types ───
export interface CreateDisputeInput {
  bookingId: string;
  reason: string;
  description: string;
  evidenceUrls?: string[];
}

export interface DisputeListQuery {
  page?: string;
  limit?: string;
  status?: string;
  priority?: string;
  type?: string;
}

export interface UpdateDisputeInput {
  status: string;
  resolution?: string;
  refundAmount?: number;
  adminNotes?: string;
}

function resolvePagination(pageStr?: string, limitStr?: string, defaultLimit = 20, maxLimit = 100) {
  const page = Math.max(1, parseInt(pageStr || "1", 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(limitStr || String(defaultLimit), 10) || defaultLimit));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

function generateDisputeRef(): string {
  const ts = Date.now().toString().slice(-8);
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `DSP-${ts}${rand}`;
}

// Map schema reason to dispute type
function mapReasonToType(reason: string): string {
  const map: Record<string, string> = {
    payment_issue: "payment",
    host_cancellation: "service",
    guest_cancellation: "service",
    item_not_as_described: "service",
    safety_concern: "general",
    other: "general",
  };
  return map[reason] || "general";
}

function mapReasonToSubject(reason: string): string {
  const map: Record<string, string> = {
    payment_issue: "Payment Issue",
    host_cancellation: "Host Cancellation",
    guest_cancellation: "Guest Cancellation",
    item_not_as_described: "Item Not As Described",
    safety_concern: "Safety Concern",
    other: "General Dispute",
  };
  return map[reason] || "General Dispute";
}

// ─── Create a dispute (user raises against a booking) ───
export async function createDispute(userId: string, data: CreateDisputeInput) {
  // Fetch the booking (hostId is stored directly on the booking)
  const booking = await prisma.booking.findUnique({
    where: { id: data.bookingId },
    select: {
      id: true,
      bookingRef: true,
      userId: true,
      hostId: true,
      totalAmount: true,
      status: true,
      paymentStatus: true,
    },
  });

  if (!booking) {
    throw new NotFoundError("Booking not found.");
  }

  // The host is stored directly on the booking
  const hostId = booking.hostId;

  // The user raising the dispute must be either the guest or the host
  let raisedByRole: string;
  let againstUserId: string;

  if (userId === booking.userId) {
    raisedByRole = "guest";
    againstUserId = hostId;
  } else if (userId === hostId) {
    raisedByRole = "host";
    againstUserId = booking.userId;
  } else {
    throw new ForbiddenError("You can only raise disputes for your own bookings.");
  }

  // Check if a dispute already exists for this booking by this user
  const existing = await prisma.dispute.findFirst({
    where: { bookingId: data.bookingId, raisedBy: userId, status: { in: ["open", "under_review"] } },
  });
  if (existing) {
    throw new BadRequestError("An active dispute already exists for this booking.");
  }

  const dispute = await prisma.dispute.create({
    data: {
      disputeRef: generateDisputeRef(),
      bookingId: data.bookingId,
      raisedBy: userId,
      raisedByRole,
      againstUserId,
      type: mapReasonToType(data.reason),
      subject: mapReasonToSubject(data.reason),
      description: data.description,
      evidence: data.evidenceUrls && data.evidenceUrls.length > 0 ? data.evidenceUrls : undefined,
      status: "open",
      priority: "normal",
    },
  });

  await createAuditLog({
    action: "DISPUTE_CREATE",
    actorId: userId,
    resource: "dispute",
    resourceId: dispute.id,
    category: "dispute",
    details: {
      disputeRef: dispute.disputeRef,
      bookingRef: booking.bookingRef,
      raisedByRole,
      againstUserId,
      reason: data.reason,
    },
  });

  // Invalidate admin dispute cache
  await cacheDelPattern("admin:disputes:*");

  logger.info(`Dispute ${dispute.disputeRef} created by user ${userId} for booking ${data.bookingId}`);

  return {
    id: dispute.id,
    disputeRef: dispute.disputeRef,
    bookingId: dispute.bookingId,
    raisedBy: dispute.raisedBy,
    raisedByRole: dispute.raisedByRole,
    againstUserId: dispute.againstUserId,
    type: dispute.type,
    subject: dispute.subject,
    description: dispute.description,
    evidence: dispute.evidence,
    status: dispute.status,
    priority: dispute.priority,
    createdAt: dispute.createdAt,
  };
}

// ─── List all disputes (admin) ───
export async function listAllDisputes(query: DisputeListQuery) {
  const { page, limit, skip } = resolvePagination(query.page, query.limit);

  const where: Record<string, unknown> = {};
  if (query.status) where.status = query.status;
  if (query.priority) where.priority = query.priority;
  if (query.type) where.type = query.type;

  const [disputes, total] = await Promise.all([
    prisma.dispute.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
    prisma.dispute.count({ where }),
  ]);

  // Enrich with user names
  const userIds = new Set<string>();
  disputes.forEach((d) => {
    userIds.add(d.raisedBy);
    userIds.add(d.againstUserId);
  });

  const users = await prisma.user.findMany({
    where: { id: { in: Array.from(userIds) } },
    select: { id: true, name: true, email: true },
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  // Enrich with booking refs
  const bookingIds = Array.from(new Set(disputes.map((d) => d.bookingId)));
  const bookings = await prisma.booking.findMany({
    where: { id: { in: bookingIds } },
    select: { id: true, bookingRef: true, totalAmount: true, userId: true },
  });
  const bookingMap = new Map(bookings.map((b) => [b.id, b]));

  const enriched = disputes.map((d) => {
    const raisedByUser = userMap.get(d.raisedBy);
    const againstUser = userMap.get(d.againstUserId);
    const booking = bookingMap.get(d.bookingId);
    return {
      id: d.id,
      disputeRef: d.disputeRef,
      bookingId: d.bookingId,
      bookingRef: booking?.bookingRef || "N/A",
      raisedBy: d.raisedBy,
      raisedByName: raisedByUser?.name || "Unknown",
      raisedByEmail: raisedByUser?.email || "Unknown",
      raisedByRole: d.raisedByRole,
      againstUserId: d.againstUserId,
      againstUserName: againstUser?.name || "Unknown",
      againstUserEmail: againstUser?.email || "Unknown",
      type: d.type,
      subject: d.subject,
      description: d.description,
      evidence: d.evidence,
      status: d.status,
      priority: d.priority,
      resolution: d.resolution,
      refundAmount: d.refundAmount,
      resolvedBy: d.resolvedBy,
      resolvedAt: d.resolvedAt,
      amount: booking?.totalAmount || 0,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    };
  });

  return {
    disputes: enriched,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

// ─── Get dispute detail (admin) ───
export async function getDisputeDetail(disputeId: string) {
  const dispute = await prisma.dispute.findUnique({
    where: { id: disputeId },
  });

  if (!dispute) {
    throw new NotFoundError("Dispute not found.");
  }

  // Fetch related users
  const [raisedByUser, againstUser, booking] = await Promise.all([
    prisma.user.findUnique({ where: { id: dispute.raisedBy }, select: { id: true, name: true, email: true, phone: true } }),
    prisma.user.findUnique({ where: { id: dispute.againstUserId }, select: { id: true, name: true, email: true, phone: true } }),
    prisma.booking.findUnique({
      where: { id: dispute.bookingId },
      select: { id: true, bookingRef: true, totalAmount: true, status: true, paymentStatus: true, checkIn: true, checkOut: true, activityDate: true },
    }),
  ]);

  return {
    ...dispute,
    raisedByUser,
    againstUser,
    booking,
  };
}

// ─── Update dispute status (admin) ───
export async function updateDisputeStatus(disputeId: string, data: UpdateDisputeInput, adminId: string) {
  const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });
  if (!dispute) {
    throw new NotFoundError("Dispute not found.");
  }

  if (dispute.status === "resolved" || dispute.status === "rejected") {
    throw new BadRequestError(`Dispute is already ${dispute.status} and cannot be modified.`);
  }

  const updateData: Record<string, unknown> = {
    status: data.status,
  };

  if (data.resolution) {
    updateData.resolution = data.resolution;
  }

  if (data.refundAmount !== undefined && data.refundAmount > 0) {
    updateData.refundAmount = data.refundAmount;
  }

  if (data.status === "resolved" || data.status === "rejected") {
    updateData.resolvedBy = adminId;
    updateData.resolvedAt = new Date();
  }

  const updated = await prisma.dispute.update({
    where: { id: disputeId },
    data: updateData,
  });

  await createAuditLog({
    action: "DISPUTE_UPDATE",
    actorId: adminId,
    resource: "dispute",
    resourceId: dispute.id,
    category: "dispute",
    details: {
      disputeRef: dispute.disputeRef,
      newStatus: data.status,
      resolution: data.resolution || null,
    },
  });

  // Invalidate admin dispute cache
  await cacheDelPattern("admin:disputes:*");

  logger.info(`Dispute ${dispute.disputeRef} updated to status ${data.status} by admin ${adminId}`);

  return updated;
}

// ─── Process dispute refund (admin refunds guest) ───
export async function processDisputeRefund(disputeId: string, adminId: string) {
  const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });
  if (!dispute) {
    throw new NotFoundError("Dispute not found.");
  }

  if (dispute.status === "resolved") {
    throw new BadRequestError("Dispute is already resolved.");
  }

  const booking = await prisma.booking.findUnique({
    where: { id: dispute.bookingId },
    select: { id: true, bookingRef: true, totalAmount: true, paymentStatus: true, userId: true },
  });

  if (!booking) {
    throw new NotFoundError("Associated booking not found.");
  }

  if (booking.paymentStatus !== "paid") {
    throw new BadRequestError("Can only refund paid bookings.");
  }

  const refundAmount = dispute.refundAmount > 0 ? dispute.refundAmount : booking.totalAmount;

  // Process the actual refund through payment gateway
  await processRefund(booking.id, refundAmount, `Dispute refund: ${dispute.disputeRef}`, adminId);

  // Update dispute as resolved with refund
  const updated = await prisma.dispute.update({
    where: { id: disputeId },
    data: {
      status: "resolved",
      resolution: `Guest refunded ₹${refundAmount} for dispute ${dispute.disputeRef}.`,
      refundAmount,
      resolvedBy: adminId,
      resolvedAt: new Date(),
    },
  });

  await createAuditLog({
    action: "DISPUTE_REFUND",
    actorId: adminId,
    resource: "dispute",
    resourceId: dispute.id,
    category: "dispute",
    details: {
      disputeRef: dispute.disputeRef,
      bookingRef: booking.bookingRef,
      refundAmount,
    },
  });

  await cacheDelPattern("admin:disputes:*");

  logger.info(`Dispute ${dispute.disputeRef} refunded ₹${refundAmount} to guest by admin ${adminId}`);

  return {
    dispute: updated,
    refundAmount,
  };
}

// ─── Release dispute funds to host (admin decides in favor of host) ───
export async function releaseDisputeFunds(disputeId: string, adminId: string) {
  const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });
  if (!dispute) {
    throw new NotFoundError("Dispute not found.");
  }

  if (dispute.status === "resolved") {
    throw new BadRequestError("Dispute is already resolved.");
  }

  // Update dispute as resolved in favor of host
  const updated = await prisma.dispute.update({
    where: { id: disputeId },
    data: {
      status: "resolved",
      resolution: `Funds released to host. Dispute ${dispute.disputeRef} resolved in favor of host.`,
      resolvedBy: adminId,
      resolvedAt: new Date(),
    },
  });

  await createAuditLog({
    action: "DISPUTE_RELEASE",
    actorId: adminId,
    resource: "dispute",
    resourceId: dispute.id,
    category: "dispute",
    details: {
      disputeRef: dispute.disputeRef,
      resolution: "Funds released to host",
    },
  });

  await cacheDelPattern("admin:disputes:*");

  logger.info(`Dispute ${dispute.disputeRef} funds released to host by admin ${adminId}`);

  return updated;
}

// ─── Get my disputes (user) ───
export async function getMyDisputes(userId: string, query: DisputeListQuery) {
  const { page, limit, skip } = resolvePagination(query.page, query.limit);

  const where = {
    OR: [{ raisedBy: userId }, { againstUserId: userId }],
  };

  const [disputes, total] = await Promise.all([
    prisma.dispute.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
    prisma.dispute.count({ where }),
  ]);

  return {
    disputes,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

// ─── Get dispute statistics (admin dashboard) ───
export async function getDisputeStats() {
  const [total, open, underReview, resolved, rejected, escalated, urgent] = await Promise.all([
    prisma.dispute.count(),
    prisma.dispute.count({ where: { status: "open" } }),
    prisma.dispute.count({ where: { status: "under_review" } }),
    prisma.dispute.count({ where: { status: "resolved" } }),
    prisma.dispute.count({ where: { status: "rejected" } }),
    prisma.dispute.count({ where: { status: "escalated" } }),
    prisma.dispute.count({ where: { priority: "urgent", status: { in: ["open", "under_review"] } } }),
  ]);

  return {
    total,
    open,
    underReview,
    resolved,
    rejected,
    escalated,
    urgent,
  };
}
