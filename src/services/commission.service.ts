import { prisma } from "../config/db.js";
import { config } from "../core/config.js";
import {
  BadRequestError,
  NotFoundError,
} from "../core/errors.js";
import { logger } from "../core/logger.js";
import { createAuditLog } from "./audit.service.js";
import { sendTemplatedEmail } from "./email.service.js";
import { sendPushToUser } from "./push.service.js";

// ─── Generate a unique payout reference ───
function generatePayoutRef(): string {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `PO${year}${month}${random}`;
}

// ─── Generate invoice number ───
function generateInvoiceNumber(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const seq = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  return `INV-${year}${month}-${seq}`;
}

// ─── Get host's pending payouts ───
export async function getHostPendingPayouts(hostId: string) {
  // Get all completed bookings with pending commission/payout
  const completedBookings = await prisma.booking.findMany({
    where: {
      hostId,
      status: "completed",
      paymentStatus: "paid",
      payoutStatus: "pending",
    },
    orderBy: { completedAt: "asc" },
  });

  const commissions = await prisma.commission.findMany({
    where: {
      hostId,
      status: "pending",
    },
  });

  const totalAmount = commissions.reduce((sum, c) => sum + c.hostPayoutAmount, 0);
  const totalCommission = commissions.reduce((sum, c) => sum + c.commissionAmount, 0);
  const netAmount = totalAmount;

  return {
    bookings: completedBookings,
    commissions,
    totalAmount,
    totalCommission,
    netAmount,
    count: completedBookings.length,
  };
}

// ─── Process a payout to a host (admin) ───
export async function processPayout(
  hostId: string,
  bookingIds: string[],
  adminId: string,
) {
  // Validate host exists
  const host = await prisma.user.findUnique({ where: { id: hostId } });
  if (!host) throw new NotFoundError("Host not found.");

  // Validate bank details
  if (!host.bankAccount || !host.bankIFSC) {
    throw new BadRequestError("Host has not provided bank details. Please ask the host to complete KYC.");
  }

  // Get all pending commissions for these bookings
  const commissions = await prisma.commission.findMany({
    where: {
      hostId,
      bookingId: { in: bookingIds },
      status: "pending",
    },
  });

  if (commissions.length === 0) {
    throw new BadRequestError("No pending payouts found for the selected bookings.");
  }

  const totalAmount = commissions.reduce((sum, c) => sum + c.hostPayoutAmount, 0);
  const totalCommission = commissions.reduce((sum, c) => sum + c.commissionAmount, 0);
  const netAmount = totalAmount;

  // Check minimum payout amount
  if (netAmount < config.commission.minPayoutAmount) {
    throw new BadRequestError(`Minimum payout amount is ₹${config.commission.minPayoutAmount}.`);
  }

  // Create payout record
  const payoutRef = generatePayoutRef();
  const invoiceNumber = generateInvoiceNumber();

  const payout = await prisma.payout.create({
    data: {
      payoutRef,
      hostId,
      amount: totalAmount,
      commissionAmount: totalCommission,
      netAmount,
      status: "processed",
      method: "bank_transfer",
      bookingIds,
      invoiceNumber,
      processedBy: adminId,
      processedAt: new Date(),
      metadata: {
        hostName: host.name,
        hostEmail: host.email,
        bankAccount: host.bankAccount,
        bankIFSC: host.bankIFSC,
      },
    },
  });

  // Update commissions
  await prisma.commission.updateMany({
    where: {
      hostId,
      bookingId: { in: bookingIds },
      status: "pending",
    },
    data: {
      status: "processed",
      payoutId: payout.id,
    },
  });

  // Update bookings
  await prisma.booking.updateMany({
    where: { id: { in: bookingIds } },
    data: {
      payoutStatus: "processed",
      payoutId: payout.id,
      payoutDate: new Date(),
    },
  });

  // Send notification to host
  await sendTemplatedEmail(host.email, "payoutProcessed", {
    hostName: host.name,
    payoutRef,
    amount: totalAmount,
    commission: totalCommission,
    netAmount,
    processedDate: new Date().toLocaleDateString(),
  });

  await sendPushToUser(hostId, {
    title: "Payout Processed!",
    body: `Your payout of ₹${netAmount} has been processed.`,
    data: { payoutId: payout.id, type: "payout" },
  });

  await createAuditLog({
    actorId: adminId,
    action: "PAYOUT_PROCESSED",
    category: "payment",
    resource: "Payout",
    resourceId: payout.id,
    details: {
      payoutRef,
      hostId,
      hostEmail: host.email,
      amount: totalAmount,
      commission: totalCommission,
      netAmount,
      bookingIds,
    },
  });

  logger.info(`Payout processed: ${payoutRef} for host ${host.email} - ₹${netAmount}`);

  return payout;
}

// ─── Get host's payout history ───
export async function getHostPayouts(
  hostId: string,
  params: { page?: number; limit?: number; status?: string } = {},
) {
  const page = params.page || 1;
  const limit = Math.min(params.limit || 20, 100);
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = { hostId };
  if (params.status) where.status = params.status;

  const [payouts, total] = await Promise.all([
    prisma.payout.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.payout.count({ where }),
  ]);

  return {
    payouts,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

// ─── Get all payouts (admin) ───
export async function getAllPayouts(
  params: { page?: number; limit?: number; status?: string; hostId?: string } = {},
) {
  const page = params.page || 1;
  const limit = Math.min(params.limit || 20, 100);
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (params.status) where.status = params.status;
  if (params.hostId) where.hostId = params.hostId;

  const [payouts, total] = await Promise.all([
    prisma.payout.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.payout.count({ where }),
  ]);

  // Enrich with host info
  const hostIds = [...new Set(payouts.map((p) => p.hostId))];
  const hosts = await prisma.user.findMany({
    where: { id: { in: hostIds } },
    select: { id: true, name: true, email: true, bankAccount: true, bankIFSC: true },
  });
  const hostMap = new Map(hosts.map((h) => [h.id, h]));

  const enrichedPayouts = payouts.map((p) => ({
    ...p,
    host: hostMap.get(p.hostId) || null,
  }));

  return {
    payouts: enrichedPayouts,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

// ─── Get commission summary (admin) ───
export async function getCommissionSummary(params: {
  startDate?: Date;
  endDate?: Date;
}) {
  const where: Record<string, unknown> = {};
  if (params.startDate || params.endDate) {
    where.createdAt = {};
    if (params.startDate) (where.createdAt as any).gte = params.startDate;
    if (params.endDate) (where.createdAt as any).lte = params.endDate;
  }

  const commissions = await prisma.commission.findMany({ where });

  const totalCommission = commissions.reduce((sum, c) => sum + c.commissionAmount, 0);
  const totalHostPayout = commissions.reduce((sum, c) => sum + c.hostPayoutAmount, 0);
  const pendingCommission = commissions
    .filter((c) => c.status === "pending")
    .reduce((sum, c) => sum + c.commissionAmount, 0);
  const processedCommission = commissions
    .filter((c) => c.status === "processed")
    .reduce((sum, c) => sum + c.commissionAmount, 0);

  // Get host-wise breakdown
  const hostMap = new Map<string, { hostId: string; commission: number; payout: number; pending: number }>();
  for (const c of commissions) {
    if (!hostMap.has(c.hostId)) {
      hostMap.set(c.hostId, { hostId: c.hostId, commission: 0, payout: 0, pending: 0 });
    }
    const entry = hostMap.get(c.hostId)!;
    entry.commission += c.commissionAmount;
    entry.payout += c.hostPayoutAmount;
    if (c.status === "pending") entry.pending += c.hostPayoutAmount;
  }

  // Get host details
  const hostIds = Array.from(hostMap.keys());
  const hosts = await prisma.user.findMany({
    where: { id: { in: hostIds } },
    select: { id: true, name: true, email: true },
  });
  const hostInfoMap = new Map(hosts.map((h) => [h.id, h]));

  const hostBreakdown = Array.from(hostMap.values()).map((h) => ({
    ...h,
    host: hostInfoMap.get(h.hostId) || null,
  }));

  return {
    summary: {
      totalCommission,
      totalHostPayout,
      pendingCommission,
      processedCommission,
      totalTransactions: commissions.length,
    },
    hostBreakdown,
  };
}

// ─── Get host ledger (for a specific host) ───
export async function getHostLedger(
  hostId: string,
  params: { page?: number; limit?: number; startDate?: Date; endDate?: Date } = {},
) {
  const page = params.page || 1;
  const limit = Math.min(params.limit || 50, 200);
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = { hostId };
  if (params.startDate || params.endDate) {
    where.createdAt = {};
    if (params.startDate) (where.createdAt as any).gte = params.startDate;
    if (params.endDate) (where.createdAt as any).lte = params.endDate;
  }

  const [commissions, total, aggregations, pendingAggregations] = await Promise.all([
    prisma.commission.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        booking: {
          select: {
            bookingRef: true,
            itemName: true,
            totalAmount: true,
            status: true,
            paymentStatus: true,
            completedAt: true,
          },
        },
      },
    }),
    prisma.commission.count({ where }),
    prisma.commission.aggregate({
      where: { hostId },
      _sum: {
        commissionAmount: true,
        hostPayoutAmount: true,
      },
    }),
    prisma.commission.aggregate({
      where: { hostId, status: "pending" },
      _sum: {
        hostPayoutAmount: true,
      },
    }),
  ]);

  const totalCommission = aggregations._sum.commissionAmount || 0;
  const totalPayout = aggregations._sum.hostPayoutAmount || 0;
  const pendingPayout = pendingAggregations._sum.hostPayoutAmount || 0;

  return {
    ledger: commissions,
    summary: {
      totalCommission,
      totalPayout,
      pendingPayout,
      count: total,
    },
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export default {
  getHostPendingPayouts,
  processPayout,
  getHostPayouts,
  getAllPayouts,
  getCommissionSummary,
  getHostLedger,
};
