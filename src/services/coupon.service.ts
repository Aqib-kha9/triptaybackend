import { prisma } from "../config/db.js";
import {
  BadRequestError,
  NotFoundError,
} from "../core/errors.js";
import { logger } from "../core/logger.js";
import { createAuditLog } from "./audit.service.js";

// ─── Types ───
export interface CreateCouponInput {
  code: string;
  description?: string;
  type: "percentage" | "flat";
  value: number;
  maxDiscount?: number;
  minOrderValue?: number;
  scope: "all" | "stay" | "activity";
  itemId?: string;
  usageLimit?: number;
  perUserLimit?: number;
  validFrom: string;
  validUntil: string;
  isActive?: boolean;
}

// ─── Create a coupon (admin) ───
export async function createCoupon(data: CreateCouponInput, adminId?: string) {
  const code = data.code.toUpperCase();

  // Check if coupon code already exists
  const existing = await prisma.coupon.findUnique({ where: { code } });
  if (existing) {
    throw new BadRequestError("Coupon code already exists.");
  }

  // Validate dates
  const validFrom = new Date(data.validFrom);
  const validUntil = new Date(data.validUntil);
  if (validUntil <= validFrom) {
    throw new BadRequestError("Valid until date must be after valid from date.");
  }

  // Validate value
  if (data.type === "percentage" && (data.value < 0 || data.value > 100)) {
    throw new BadRequestError("Percentage value must be between 0 and 100.");
  }
  if (data.type === "flat" && data.value < 0) {
    throw new BadRequestError("Flat discount value cannot be negative.");
  }

  const coupon = await prisma.coupon.create({
    data: {
      code,
      description: data.description || null,
      type: data.type,
      value: data.value,
      maxDiscount: data.maxDiscount || null,
      minOrderValue: data.minOrderValue || 0,
      scope: data.scope,
      itemId: data.itemId || null,
      usageLimit: data.usageLimit || 0,
      perUserLimit: data.perUserLimit || 1,
      validFrom,
      validUntil,
      isActive: data.isActive ?? true,
      createdBy: adminId || null,
    },
  });

  await createAuditLog({
    actorId: adminId,
    action: "COUPON_CREATED",
    category: "payment",
    resource: "Coupon",
    resourceId: coupon.id,
    details: { code, type: data.type, value: data.value },
  });

  logger.info(`Coupon created: ${code}`);

  return coupon;
}

// ─── Update a coupon (admin) ───
export async function updateCoupon(couponId: string, data: Partial<CreateCouponInput>, adminId?: string) {
  const coupon = await prisma.coupon.findUnique({ where: { id: couponId } });
  if (!coupon) throw new NotFoundError("Coupon not found.");

  const updateData: Record<string, unknown> = {};
  if (data.description !== undefined) updateData.description = data.description;
  if (data.value !== undefined) updateData.value = data.value;
  if (data.maxDiscount !== undefined) updateData.maxDiscount = data.maxDiscount;
  if (data.minOrderValue !== undefined) updateData.minOrderValue = data.minOrderValue;
  if (data.scope !== undefined) updateData.scope = data.scope;
  if (data.itemId !== undefined) updateData.itemId = data.itemId;
  if (data.usageLimit !== undefined) updateData.usageLimit = data.usageLimit;
  if (data.perUserLimit !== undefined) updateData.perUserLimit = data.perUserLimit;
  if (data.isActive !== undefined) updateData.isActive = data.isActive;
  if (data.validFrom) updateData.validFrom = new Date(data.validFrom);
  if (data.validUntil) updateData.validUntil = new Date(data.validUntil);

  const updated = await prisma.coupon.update({
    where: { id: couponId },
    data: updateData,
  });

  await createAuditLog({
    actorId: adminId,
    action: "COUPON_UPDATED",
    category: "payment",
    resource: "Coupon",
    resourceId: couponId,
    details: { code: coupon.code, changes: updateData },
  });

  return updated;
}

// ─── Delete a coupon (admin) ───
export async function deleteCoupon(couponId: string, adminId?: string) {
  const coupon = await prisma.coupon.findUnique({ where: { id: couponId } });
  if (!coupon) throw new NotFoundError("Coupon not found.");

  await prisma.coupon.delete({ where: { id: couponId } });

  await createAuditLog({
    actorId: adminId,
    action: "COUPON_DELETED",
    category: "payment",
    resource: "Coupon",
    resourceId: couponId,
    details: { code: coupon.code },
  });

  return { message: "Coupon deleted successfully." };
}

// ─── List all coupons (admin) ───
export async function listCoupons(params: {
  page?: number;
  limit?: number;
  isActive?: boolean;
  scope?: string;
}) {
  const page = params.page || 1;
  const limit = Math.min(params.limit || 20, 100);
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (params.isActive !== undefined) where.isActive = params.isActive;
  if (params.scope) where.scope = params.scope;

  const [coupons, total] = await Promise.all([
    prisma.coupon.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.coupon.count({ where }),
  ]);

  return {
    coupons,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

// ─── Validate a coupon (public) ───
export async function validateCoupon(
  code: string,
  orderValue: number,
  itemType: "listing" | "activity",
  itemId?: string,
  userId?: string,
) {
  const coupon = await prisma.coupon.findUnique({
    where: { code: code.toUpperCase() },
  });

  if (!coupon) {
    throw new BadRequestError("Invalid coupon code.");
  }

  if (!coupon.isActive) {
    throw new BadRequestError("This coupon is no longer active.");
  }

  const now = new Date();
  if (now < coupon.validFrom) {
    throw new BadRequestError("This coupon is not yet valid.");
  }
  if (now > coupon.validUntil) {
    throw new BadRequestError("This coupon has expired.");
  }

  if (coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit) {
    throw new BadRequestError("This coupon has reached its usage limit.");
  }

  if (orderValue < coupon.minOrderValue) {
    throw new BadRequestError(`Minimum order value for this coupon is ₹${coupon.minOrderValue}.`);
  }

  // Check scope
  if (coupon.scope !== "all") {
    if (coupon.scope === "stay" && itemType !== "listing") {
      throw new BadRequestError("This coupon is only valid for stays.");
    }
    if (coupon.scope === "activity" && itemType !== "activity") {
      throw new BadRequestError("This coupon is only valid for activities.");
    }
  }

  // Validate specific item ID
  if (coupon.itemId && coupon.itemId !== itemId) {
    throw new BadRequestError("This coupon is not valid for this specific stay or activity.");
  }

  // Check per-user usage limit
  if (userId) {
    const userUsage = await prisma.couponUsage.count({
      where: { couponId: coupon.id, userId },
    });
    if (userUsage >= coupon.perUserLimit) {
      throw new BadRequestError("You have already used this coupon the maximum number of times.");
    }
  }

  // Calculate discount
  let discountAmount = 0;
  if (coupon.type === "percentage") {
    discountAmount = (orderValue * coupon.value) / 100;
    if (coupon.maxDiscount && discountAmount > coupon.maxDiscount) {
      discountAmount = coupon.maxDiscount;
    }
  } else {
    discountAmount = coupon.value;
  }
  discountAmount = Math.min(discountAmount, orderValue);

  return {
    coupon,
    discountAmount,
    finalAmount: orderValue - discountAmount,
  };
}

// ─── Get coupon usage stats (admin) ───
export async function getCouponStats(couponId: string) {
  const coupon = await prisma.coupon.findUnique({ where: { id: couponId } });
  if (!coupon) throw new NotFoundError("Coupon not found.");

  const usages = await prisma.couponUsage.findMany({
    where: { couponId },
    include: {
      booking: {
        select: {
          bookingRef: true,
          itemName: true,
          totalAmount: true,
          status: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const totalDiscountGiven = usages.reduce((sum, u) => sum + u.discountAmount, 0);

  return {
    coupon,
    stats: {
      totalUsed: usages.length,
      totalDiscountGiven,
      usages,
    },
  };
}

export default {
  createCoupon,
  updateCoupon,
  deleteCoupon,
  listCoupons,
  validateCoupon,
  getCouponStats,
};
