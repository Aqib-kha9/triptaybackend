import { prisma } from "../config/db.js";
import { config } from "../core/config.js";
import {
  BadRequestError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
} from "../core/errors.js";
import { logger } from "../core/logger.js";
import { sendTemplatedEmail } from "./email.service.js";
import { sendPushToUser } from "./push.service.js";
import { createAuditLog } from "./audit.service.js";
import { getCancellationPolicySettings } from "./configuration.service.js";

// ─── Types ───
export interface CreateBookingInput {
  itemId: string;
  itemType: "listing" | "activity";
  checkIn?: string; // ISO date string (for listings)
  checkOut?: string; // ISO date string (for listings)
  activityDate?: string; // ISO date string (for activities)
  startTime?: string; // for activities
  guests: number;
  adults?: number;
  children?: number;
  guestName?: string;
  guestEmail?: string;
  guestPhone?: string;
  specialRequests?: string;
  couponCode?: string;
  bookingType?: "instant" | "request";
}

export interface BookingPricing {
  baseAmount: number;
  cleaningFee: number;
  securityDeposit: number;
  extraGuestCharges: number;
  taxAmount: number;
  platformFee: number;
  discountAmount: number;
  commissionAmount: number;
  hostPayoutAmount: number;
  totalAmount: number;
  nights: number;
}

// ─── Generate a unique booking reference ───
function generateBookingRef(): string {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `TRP${year}${month}${day}${random}`;
}

// ─── Map a raw Prisma booking to the frontend BookingItem shape ───
// The Prisma model stores the human-readable reference as `bookingRef` and uses
// lowercase status values, but the frontend `BookingItem` type expects
// `bookingId` and capitalized statuses. This helper bridges that gap so the
// success page (and other consumers) can display the booking reference.
async function mapBookingToFrontend(booking: any, currentUserId?: string) {
  if (!booking) return booking;

  const statusMap: Record<string, string> = {
    pending: "Pending",
    confirmed: "Confirmed",
    paid: "Paid",
    completed: "Completed",
    cancelled: "Cancelled",
    rejected: "Rejected",
    expired: "Expired",
  };

  let location = "";
  if (booking.itemId) {
    if (booking.itemType === "listing") {
      const item = await prisma.listing.findUnique({
        where: { id: booking.itemId },
        select: { city: true, state: true },
      });
      if (item) {
        location = `${item.city}, ${item.state}`;
      }
    } else if (booking.itemType === "activity") {
      const item = await prisma.activity.findUnique({
        where: { id: booking.itemId },
        select: { city: true, state: true },
      });
      if (item) {
        location = `${item.city}, ${item.state}`;
      }
    }
  }

  // Generate a fallback OTP on-the-fly for older bookings if confirmed/paid
  let checkInOtp = booking.checkInOtp;
  if (!checkInOtp && (booking.status === "confirmed" || booking.status === "paid")) {
    checkInOtp = Math.floor(1000 + Math.random() * 9000).toString();
    prisma.booking.update({
      where: { id: booking.id },
      data: { checkInOtp }
    }).catch(err => console.error("Failed to auto-generate fallback OTP:", err));
  }

  // Only expose OTP to the guest who booked the stay/activity
  const showOtp = currentUserId && booking.userId === currentUserId;
  const filteredOtp = showOtp ? checkInOtp : null;

  return {
    ...booking,
    // Expose the human-readable reference under the field the frontend expects
    bookingId: booking.bookingRef ?? booking.bookingId,
    // Normalize status casing for the frontend
    status: statusMap[booking.status] ?? booking.status,
    // Provide a `location` field for the frontend (derived from itemSlug if needed)
    location: location || booking.location || "",
    checkInOtp: filteredOtp,
  };
}

// ─── Calculate nights between two dates ───
function calculateNights(checkIn: Date, checkOut: Date): number {
  const diff = checkOut.getTime() - checkIn.getTime();
  return Math.max(1, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

// ─── Check if a date is a weekend ───
function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6; // Sunday or Saturday
}

// ─── Calculate pricing for a booking ───
export async function calculateBookingPricing(
  item: any,
  itemType: "listing" | "activity",
  checkIn: Date | null,
  checkOut: Date | null,
  guests: number,
  couponCode?: string,
): Promise<BookingPricing> {
  let baseAmount = 0;
  let nights = 1;
  let cleaningFee = 0;
  let securityDeposit = 0;
  let extraGuestCharges = 0;
  let taxAmount = 0;

  if (itemType === "listing") {
    if (!checkIn || !checkOut) {
      throw new BadRequestError("Check-in and check-out dates are required for stays.");
    }
    nights = calculateNights(checkIn, checkOut);

    // Calculate base price considering weekend pricing
    let totalBase = 0;
    const weekendPrice = item.weekendPrice || item.basePrice;
    for (let i = 0; i < nights; i++) {
      const currentDate = new Date(checkIn);
      currentDate.setDate(currentDate.getDate() + i);
      totalBase += isWeekend(currentDate) ? weekendPrice : item.basePrice;
    }
    baseAmount = totalBase;
    cleaningFee = item.cleaningFee || 0;
    securityDeposit = item.securityDeposit || 0;

    // Extra guest charges
    const maxGuests = item.maxGuests || 1;
    if (guests > maxGuests && item.extraGuestPrice) {
      extraGuestCharges = (guests - maxGuests) * item.extraGuestPrice * nights;
    }

    // Taxes
    taxAmount = (baseAmount + cleaningFee) * (item.taxes || 0) / 100;
  } else {
    // Activity pricing
    baseAmount = item.basePrice * guests;
    securityDeposit = item.securityDeposit || 0;
    taxAmount = baseAmount * (item.taxes || 0) / 100;
    nights = 0;
  }

  // Load platform fee and commission rates from Configurations dynamically
  const platformFeeConfig = await prisma.configuration.findUnique({
    where: { key: "platform_fee_rate" },
  });
  const platformFeeRate = platformFeeConfig ? parseFloat(platformFeeConfig.value) : 5; // 5% default

  const commissionConfig = await prisma.configuration.findUnique({
    where: { key: "commission_rate" },
  });
  const commissionRate = commissionConfig ? parseFloat(commissionConfig.value) : 10; // 10% default

  const platformFee = Math.round(baseAmount * platformFeeRate / 100);

  const subtotal = baseAmount + cleaningFee + extraGuestCharges + taxAmount + securityDeposit + platformFee;

  // Apply coupon discount
  let discountAmount = 0;
  let couponId: string | undefined;
  if (couponCode) {
    const coupon = await validateCoupon(couponCode, subtotal, itemType);
    if (coupon) {
      discountAmount = calculateDiscount(coupon, subtotal);
      couponId = coupon.id;
    }
  }

  const totalAfterDiscount = subtotal - discountAmount;

  // Calculate commission (charged to host/vendor)
  const commissionAmount = (totalAfterDiscount * commissionRate) / 100;
  const hostPayoutAmount = totalAfterDiscount - commissionAmount - securityDeposit;

  return {
    baseAmount,
    cleaningFee,
    securityDeposit,
    extraGuestCharges,
    taxAmount,
    platformFee,
    discountAmount,
    commissionAmount,
    hostPayoutAmount,
    totalAmount: totalAfterDiscount,
    nights,
  };
}

// ─── Validate coupon ───
async function validateCoupon(code: string, orderValue: number, itemType: string) {
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
  if (now < coupon.validFrom || now > coupon.validUntil) {
    throw new BadRequestError("This coupon has expired or is not yet valid.");
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

  return coupon;
}

// ─── Calculate discount amount ───
function calculateDiscount(coupon: any, orderValue: number): number {
  let discount = 0;
  if (coupon.type === "percentage") {
    discount = (orderValue * coupon.value) / 100;
    if (coupon.maxDiscount && discount > coupon.maxDiscount) {
      discount = coupon.maxDiscount;
    }
  } else {
    discount = coupon.value;
  }
  return Math.min(discount, orderValue);
}

// ─── Check availability for dates ───
async function checkDateAvailability(itemId: string, itemType: string, dates: string[]): Promise<boolean> {
  const availability = await prisma.availability.findUnique({
    where: { itemId_itemType: { itemId, itemType } },
  });

  if (!availability) return true;

  const blockedSet = new Set(availability.blockedDates);
  return !dates.some((date) => blockedSet.has(date));
}

// ─── Check for overlapping bookings ───
async function checkBookingConflict(
  itemId: string,
  itemType: string,
  checkIn: Date,
  checkOut: Date,
): Promise<boolean> {
  const now = new Date();

  // A booking blocks dates only if it is:
  //   - "confirmed" (always blocks), OR
  //   - "pending" AND still within its payment window (expiresAt is null or in the future)
  // Stale pending bookings (expiresAt < now) are treated as expired so their dates
  // are immediately available for other guests — exactly like Airbnb / Amazon where
  // an abandoned checkout releases the inventory hold.
  const conflicting = await prisma.booking.findFirst({
    where: {
      itemId,
      itemType,
      status: { in: ["pending", "confirmed"] },
      OR: [
        // Confirmed bookings always block
        { status: "confirmed" },
        // Pending bookings block only if not yet expired
        {
          status: "pending",
          AND: [
            { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
          ],
        },
      ],
      // Date overlap check (applies to both branches above)
      checkIn: { lt: checkOut },
      checkOut: { gt: checkIn },
    },
  });

  return !!conflicting;
}

// ─── Create a booking ───
export async function createBooking(userId: string, data: CreateBookingInput) {
  // Fetch the item (listing or activity)
  let item: any;
  if (data.itemType === "listing") {
    item = await prisma.listing.findUnique({ where: { id: data.itemId } });
  } else {
    item = await prisma.activity.findUnique({ where: { id: data.itemId } });
  }

  if (!item) {
    throw new NotFoundError(`${data.itemType === "listing" ? "Listing" : "Activity"} not found.`);
  }

  if (item.status !== "published") {
    throw new BadRequestError("This item is not available for booking.");
  }

  // Prevent booking your own item
  if (item.hostId === userId) {
    throw new BadRequestError("You cannot book your own property.");
  }

  // Validate dates
  let checkIn: Date | null = null;
  let checkOut: Date | null = null;
  let activityDate: Date | null = null;
  let datesToCheck: string[] = [];

  if (data.itemType === "listing") {
    if (!data.checkIn || !data.checkOut) {
      throw new BadRequestError("Check-in and check-out dates are required for stays.");
    }
    checkIn = new Date(data.checkIn);
    checkOut = new Date(data.checkOut);

    if (checkIn <= new Date()) {
      throw new BadRequestError("Check-in date must be in the future.");
    }
    if (checkOut <= checkIn) {
      throw new BadRequestError("Check-out date must be after check-in.");
    }

    // Check min/max stay
    const nights = calculateNights(checkIn, checkOut);
    if (item.minStay && nights < item.minStay) {
      throw new BadRequestError(`Minimum stay is ${item.minStay} nights.`);
    }
    if (item.maxStay && item.maxStay > 0 && nights > item.maxStay) {
      throw new BadRequestError(`Maximum stay is ${item.maxStay} nights.`);
    }

    // Check advance notice
    if (item.advanceNoticeHours > 0) {
      const hoursUntilCheckIn = (checkIn.getTime() - Date.now()) / (1000 * 60 * 60);
      if (hoursUntilCheckIn < item.advanceNoticeHours) {
        throw new BadRequestError(`This property requires ${item.advanceNoticeHours} hours advance notice.`);
      }
    }

    // Check max guests
    if (data.guests > item.maxGuests) {
      throw new BadRequestError(`Maximum ${item.maxGuests} guests allowed.`);
    }

    // Build date range for availability check
    for (let d = new Date(checkIn); d < checkOut; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split("T")[0];
      if (dateStr) datesToCheck.push(dateStr);
    }

    // Check availability
    const isAvailable = await checkDateAvailability(data.itemId, data.itemType, datesToCheck);
    if (!isAvailable) {
      throw new ConflictError("Some of the selected dates are not available.");
    }

    // Check for conflicting bookings
    const hasConflict = await checkBookingConflict(data.itemId, data.itemType, checkIn, checkOut);
    if (hasConflict) {
      throw new ConflictError("These dates overlap with an existing booking.");
    }
  } else {
    if (!data.activityDate) {
      throw new BadRequestError("Activity date is required.");
    }
    activityDate = new Date(data.activityDate);

    if (activityDate <= new Date()) {
      throw new BadRequestError("Activity date must be in the future.");
    }

    // Check max group size
    if (data.guests > item.maxGroupSize) {
      throw new BadRequestError(`Maximum ${item.maxGroupSize} participants allowed.`);
    }

    // Check advance notice
    if (item.advanceNoticeHours > 0) {
      const hoursUntilActivity = (activityDate.getTime() - Date.now()) / (1000 * 60 * 60);
      if (hoursUntilActivity < item.advanceNoticeHours) {
        throw new BadRequestError(`This activity requires ${item.advanceNoticeHours} hours advance notice.`);
      }
    }

    const activityDateStr = activityDate.toISOString().split("T")[0];
    if (activityDateStr) datesToCheck = [activityDateStr];
    const isAvailable = await checkDateAvailability(data.itemId, data.itemType, datesToCheck);
    if (!isAvailable) {
      throw new ConflictError("This date is not available.");
    }
  }

  // Calculate pricing
  const pricing = await calculateBookingPricing(
    item,
    data.itemType,
    checkIn,
    checkOut,
    data.guests,
    data.couponCode,
  );

  // Determine booking type
  const bookingType = data.bookingType || (item.instantBook ? "instant" : "request");
  const status = bookingType === "instant" ? "pending" : "pending";

  // Set expiry (24 hours for request, 15 minutes for instant payment)
  const expiresAt = new Date(Date.now() + (bookingType === "instant" ? 15 : 24) * 60 * 60 * 1000);

  // Get user info for guest details
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError("User not found.");

  // Create the booking
  const booking = await prisma.booking.create({
    data: {
      bookingRef: generateBookingRef(),
      userId,
      hostId: item.hostId,
      itemId: data.itemId,
      itemType: data.itemType,
      itemName: item.name,
      itemSlug: item.slug,
      itemImage: (item.media as any[])?.[0]?.url || null,
      checkIn,
      checkOut,
      nights: pricing.nights,
      activityDate,
      startTime: data.startTime || null,
      guests: data.guests,
      adults: data.adults || data.guests,
      children: data.children || 0,
      baseAmount: pricing.baseAmount,
      cleaningFee: pricing.cleaningFee,
      securityDeposit: pricing.securityDeposit,
      extraGuestCharges: pricing.extraGuestCharges,
      taxAmount: pricing.taxAmount,
      platformFee: pricing.platformFee,
      discountAmount: pricing.discountAmount,
      commissionAmount: pricing.commissionAmount,
      hostPayoutAmount: pricing.hostPayoutAmount,
      totalAmount: pricing.totalAmount,
      status,
      paymentStatus: "pending",
      bookingType,
      checkInOtp: Math.floor(1000 + Math.random() * 9000).toString(),
      guestName: data.guestName || user.name,
      guestEmail: data.guestEmail || user.email,
      guestPhone: data.guestPhone || user.phone,
      specialRequests: data.specialRequests || null,
      couponCode: data.couponCode?.toUpperCase() || null,
      couponId: pricing.discountAmount > 0 ? (await prisma.coupon.findUnique({ where: { code: data.couponCode!.toUpperCase() } }))?.id : null,
      expiresAt,
    },
  });

  // Record coupon usage if applicable
  if (pricing.discountAmount > 0 && data.couponCode) {
    const coupon = await prisma.coupon.findUnique({ where: { code: data.couponCode.toUpperCase() } });
    if (coupon) {
      await prisma.couponUsage.create({
        data: {
          couponId: coupon.id,
          couponCode: coupon.code,
          userId,
          bookingId: booking.id,
          discountAmount: pricing.discountAmount,
        },
      });
      await prisma.coupon.update({
        where: { id: coupon.id },
        data: { usedCount: { increment: 1 } },
      });
    }
  }

  // Create commission record
  await prisma.commission.create({
    data: {
      bookingId: booking.id,
      hostId: item.hostId,
      rate: config.commission.defaultRate,
      baseAmount: pricing.totalAmount,
      commissionAmount: pricing.commissionAmount,
      hostPayoutAmount: pricing.hostPayoutAmount,
      status: "pending",
    },
  });

  // Send notifications
  await sendBookingNotifications(booking, item, user, "created");

  // Audit log
  await createAuditLog({
    actorId: userId,
    actorEmail: user.email,
    actorRole: user.role,
    action: "BOOKING_CREATED",
    category: "booking",
    resource: "Booking",
    resourceId: booking.id,
    details: { bookingRef: booking.bookingRef, itemId: data.itemId, totalAmount: pricing.totalAmount },
  });

  logger.info(`Booking created: ${booking.bookingRef} by ${user.email}`);

  return booking;
}

// ─── Send booking notifications ───
async function sendBookingNotifications(booking: any, item: any, user: any, event: string) {
  const host = await prisma.user.findUnique({ where: { id: item.hostId } });

  if (event === "created") {
    // Notify guest
    if (booking.guestEmail) {
      await sendTemplatedEmail(booking.guestEmail, "bookingConfirmation", {
        guestName: booking.guestName,
        itemName: booking.itemName,
        bookingRef: booking.bookingRef,
        checkIn: booking.checkIn?.toLocaleDateString(),
        checkOut: booking.checkOut?.toLocaleDateString(),
        guests: booking.guests,
        totalAmount: booking.totalAmount,
      });
    }

    // Notify host
    if (host) {
      await sendTemplatedEmail(host.email, "hostBookingNotification", {
        hostName: host.name,
        itemName: booking.itemName,
        bookingRef: booking.bookingRef,
        guestName: booking.guestName,
        checkIn: booking.checkIn?.toLocaleDateString(),
        checkOut: booking.checkOut?.toLocaleDateString(),
        guests: booking.guests,
        hostPayout: booking.hostPayoutAmount,
      });

      await sendPushToUser(host.id, {
        title: "New Booking Received!",
        body: `${booking.guestName} booked ${booking.itemName}`,
        data: { bookingId: booking.id, type: "booking" },
      });
    }
  }
}

// ─── Get user's bookings ───
export async function getMyBookings(
  userId: string,
  params: { status?: string; page?: number; limit?: number; role?: "guest" | "host" } = {},
) {
  const page = params.page || 1;
  const limit = Math.min(params.limit || 20, 100);
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (params.role === "host") {
    where.hostId = userId;
  } else {
    where.userId = userId;
  }
  if (params.status) where.status = params.status;

  const [bookings, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.booking.count({ where }),
  ]);

  const mappedBookings = await Promise.all(bookings.map((b) => mapBookingToFrontend(b, userId)));

  return {
    bookings: mappedBookings,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

// ─── Get a single booking ───
export async function getBooking(bookingId: string, userId: string) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new NotFoundError("Booking not found.");

  // Check access
  if (booking.userId !== userId && booking.hostId !== userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user?.role !== "Admin") {
      throw new ForbiddenError("You don't have access to this booking.");
    }
  }

  return await mapBookingToFrontend(booking, userId);
}

// ─── Cancellation preview (refund calculation before user confirms) ───
// Returns the refund amount, policy, penalty, and timing details so the
// frontend can show a confirmation modal (like Airbnb / OYO / Amazon).
export async function getCancelPreview(bookingId: string, userId: string) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new NotFoundError("Booking not found.");

  // Check access — both guest and host can preview
  if (booking.userId !== userId && booking.hostId !== userId) {
    throw new ForbiddenError("You don't have access to this booking.");
  }

  if (booking.status === "cancelled" || booking.status === "completed" || booking.status === "expired") {
    throw new BadRequestError("This booking cannot be cancelled.");
  }

  // Fetch the item to get the cancellation policy
  let item: any;
  if (booking.itemType === "listing") {
    item = await prisma.listing.findUnique({ where: { id: booking.itemId } });
  } else {
    item = await prisma.activity.findUnique({ where: { id: booking.itemId } });
  }

  // ── Resolve the effective cancellation policy ──
  // Admin sets a global default + a toggle to allow vendor overrides.
  // If vendor override is disabled, the admin's global default is used
  // regardless of what the vendor set on the listing/activity.
  const cancelConfig = await getCancellationPolicySettings();
  let policy: string;
  if (cancelConfig.vendorOverrideEnabled) {
    policy = item?.cancellationPolicy || cancelConfig.defaultPolicy;
  } else {
    policy = cancelConfig.defaultPolicy;
  }
  const policyDetails = item?.cancellationDetails || null;
  const now = new Date();
  const checkDate = booking.checkIn || booking.activityDate || now;
  const hoursUntilCheck = Math.max(0, (checkDate.getTime() - now.getTime()) / (1000 * 60 * 60));
  const daysUntilCheck = Math.floor(hoursUntilCheck / 24);

  // Calculate refund based on cancellation policy (configurable time windows)
  let refundAmount = 0;
  let refundPercentage = 0;
  let penaltyAmount = 0;
  let policyText = "";

  if (policy === "Flexible") {
    if (hoursUntilCheck > cancelConfig.flexibleFullRefundHours) {
      refundAmount = booking.totalAmount;
      refundPercentage = 100;
      policyText = `Full refund — cancelled more than ${cancelConfig.flexibleFullRefundHours} hours before check-in.`;
    } else {
      refundAmount = booking.totalAmount * 0.5;
      refundPercentage = 50;
      policyText = `50% refund — cancelled within ${cancelConfig.flexibleFullRefundHours} hours of check-in.`;
    }
  } else if (policy === "Moderate") {
    if (hoursUntilCheck > cancelConfig.moderateFullRefundHours) {
      refundAmount = booking.totalAmount;
      refundPercentage = 100;
      policyText = `Full refund — cancelled more than ${Math.round(cancelConfig.moderateFullRefundHours / 24)} days before check-in.`;
    } else if (hoursUntilCheck > cancelConfig.moderatePartialRefundHours) {
      refundAmount = booking.totalAmount * 0.5;
      refundPercentage = 50;
      policyText = `50% refund — cancelled between ${cancelConfig.moderatePartialRefundHours} hours and ${Math.round(cancelConfig.moderateFullRefundHours / 24)} days before check-in.`;
    } else {
      refundAmount = 0;
      refundPercentage = 0;
      policyText = `No refund — cancelled within ${cancelConfig.moderatePartialRefundHours} hours of check-in.`;
    }
  } else if (policy === "Strict") {
    if (hoursUntilCheck > cancelConfig.strictPartialRefundHours) {
      refundAmount = booking.totalAmount * 0.5;
      refundPercentage = 50;
      policyText = `50% refund — cancelled more than ${Math.round(cancelConfig.strictPartialRefundHours / 24)} days before check-in.`;
    } else {
      refundAmount = 0;
      refundPercentage = 0;
      policyText = `No refund — cancelled within ${Math.round(cancelConfig.strictPartialRefundHours / 24)} days of check-in.`;
    }
  } else {
    // Non-refundable
    refundAmount = 0;
    refundPercentage = 0;
    policyText = "This booking is non-refundable.";
  }

  penaltyAmount = booking.totalAmount - refundAmount;

  // Determine if the booking was paid (refund applies) or pending (no charge)
  const isPaid = booking.paymentStatus === "paid" || booking.paymentStatus === "partially_paid";

  return {
    bookingId: booking.id,
    bookingRef: booking.bookingRef,
    itemName: booking.itemName,
    status: booking.status,
    paymentStatus: booking.paymentStatus,
    totalAmount: booking.totalAmount,
    refundAmount: isPaid ? Math.round(refundAmount * 100) / 100 : 0,
    refundPercentage: isPaid ? refundPercentage : 0,
    penaltyAmount: isPaid ? Math.round(penaltyAmount * 100) / 100 : booking.totalAmount,
    cancellationPolicy: policy,
    policyDetails: policyDetails,
    policyText,
    daysUntilCheck,
    hoursUntilCheck: Math.round(hoursUntilCheck * 10) / 10,
    checkIn: booking.checkIn?.toISOString() || booking.activityDate?.toISOString() || null,
    isPaid,
    canCancel: true,
  };
}

// ─── Release coupon usage (for cancellation, expiry, rejection) ───
async function releaseCouponUsage(bookingId: string) {
  try {
    const usage = await prisma.couponUsage.findFirst({
      where: { bookingId },
    });
    if (usage) {
      await prisma.coupon.update({
        where: { id: usage.couponId },
        data: { usedCount: { decrement: 1 } },
      });
      await prisma.couponUsage.delete({
        where: { id: usage.id },
      });
      logger.info(`Released coupon usage: ${usage.couponCode} for booking ID ${bookingId}`);
    }
  } catch (err) {
    logger.error(`Failed to release coupon usage for booking ID ${bookingId}:`, err);
  }
}

// ─── Cancel a booking ───
export async function cancelBooking(
  bookingId: string,
  userId: string,
  reason?: string,
) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new NotFoundError("Booking not found.");

  // Check access
  if (booking.userId !== userId && booking.hostId !== userId) {
    throw new ForbiddenError("You don't have access to this booking.");
  }

  if (booking.status === "cancelled" || booking.status === "completed") {
    throw new BadRequestError("This booking cannot be cancelled.");
  }

  // Determine who cancelled
  const cancelledBy = booking.userId === userId ? "guest" : "host";

  // Calculate refund based on cancellation policy
  let refundAmount = 0;
  let item: any;
  if (booking.itemType === "listing") {
    item = await prisma.listing.findUnique({ where: { id: booking.itemId } });
  } else {
    item = await prisma.activity.findUnique({ where: { id: booking.itemId } });
  }

  // ── Resolve the effective cancellation policy (admin-configurable) ──
  const cancelConfig = await getCancellationPolicySettings();
  let policy: string;
  if (cancelConfig.vendorOverrideEnabled) {
    policy = item?.cancellationPolicy || cancelConfig.defaultPolicy;
  } else {
    policy = cancelConfig.defaultPolicy;
  }
  const now = new Date();
  const checkDate = booking.checkIn || booking.activityDate || now;
  const hoursUntilCheck = (checkDate.getTime() - now.getTime()) / (1000 * 60 * 60);

  if (policy === "Flexible") {
    // Full refund if cancelled > flexibleFullRefundHours before, else 50%
    refundAmount = hoursUntilCheck > cancelConfig.flexibleFullRefundHours
      ? booking.totalAmount
      : booking.totalAmount * 0.5;
  } else if (policy === "Moderate") {
    // Full refund if > moderateFullRefundHours, 50% if > moderatePartialRefundHours
    if (hoursUntilCheck > cancelConfig.moderateFullRefundHours) refundAmount = booking.totalAmount;
    else if (hoursUntilCheck > cancelConfig.moderatePartialRefundHours) refundAmount = booking.totalAmount * 0.5;
    else refundAmount = 0;
  } else if (policy === "Strict") {
    // 50% refund if > strictPartialRefundHours before
    refundAmount = hoursUntilCheck > cancelConfig.strictPartialRefundHours
      ? booking.totalAmount * 0.5
      : 0;
  } else {
    // Non-refundable
    refundAmount = 0;
  }

  // Update booking
  const updated = await prisma.booking.update({
    where: { id: bookingId },
    data: {
      status: "cancelled",
      cancellationReason: reason || null,
      cancelledBy,
      cancelledAt: now,
      refundAmount,
      paymentStatus:
        refundAmount > 0 && booking.paymentStatus === "paid"
          ? "refunded"
          : booking.paymentStatus === "paid"
            ? "failed"
            : booking.paymentStatus,
    },
  });

  // Reverse commission
  await prisma.commission.updateMany({
    where: { bookingId },
    data: { status: "reversed" },
  });

  // Release coupon usage if applicable
  await releaseCouponUsage(bookingId);

  // ── Process actual refund via payment gateway (like Airbnb / OYO) ──
  // Only refund if the booking was actually paid and there's a refund due.
  let refundResult: { refundId: string | null; amount: number } | null = null;
  if (booking.paymentStatus === "paid" && refundAmount > 0 && booking.gatewayPaymentId) {
    try {
      const { processRefund } = await import("./payment.service.js");
      refundResult = await processRefund(
        bookingId,
        refundAmount,
        reason || `Cancellation by ${cancelledBy}`,
        userId,
      );
      logger.info(`Refund processed for ${booking.bookingRef}: ₹${refundAmount}`);
    } catch (err) {
      // Log the refund failure but don't fail the cancellation — the booking
      // is still cancelled; admin can manually process the refund later.
      logger.error(`Refund failed for ${booking.bookingRef}: ${err}`);
      await createAuditLog({
        actorId: userId,
        action: "REFUND_FAILED",
        category: "payment",
        resource: "Booking",
        resourceId: bookingId,
        details: {
          bookingRef: booking.bookingRef,
          refundAmount,
          error: err instanceof Error ? err.message : "Unknown refund error",
        },
      });
    }
  }

  // Send cancellation notifications
  if (booking.guestEmail) {
    await sendTemplatedEmail(booking.guestEmail, "bookingCancellation", {
      guestName: booking.guestName,
      itemName: booking.itemName,
      bookingRef: booking.bookingRef,
      refundAmount,
    });
  }

  const host = await prisma.user.findUnique({ where: { id: booking.hostId } });
  if (host) {
    await sendPushToUser(host.id, {
      title: "Booking Cancelled",
      body: `Booking ${booking.bookingRef} has been cancelled.`,
      data: { bookingId, type: "booking" },
    });
  }

  await createAuditLog({
    actorId: userId,
    action: "BOOKING_CANCELLED",
    category: "booking",
    resource: "Booking",
    resourceId: bookingId,
    details: {
      bookingRef: booking.bookingRef,
      refundAmount,
      cancelledBy,
      refundId: refundResult?.refundId || null,
      policy,
      vendorOverrideEnabled: cancelConfig.vendorOverrideEnabled,
    },
  });

  logger.info(`Booking cancelled: ${booking.bookingRef} by ${cancelledBy} (refund: ₹${refundAmount})`);

  return updated;
}

// ─── Expire a pending booking (payment failure / abandonment) ───
// This releases the blocked dates so other guests can book them.
// Used by:
//   - Payment verification failure (Razorpay / PayU)
//   - Frontend when user abandons / dismisses the payment modal
//   - Cron job for stale pending bookings past their expiry window
export async function expireBooking(bookingId: string, userId?: string, reason?: string) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new NotFoundError("Booking not found.");

  // Only pending bookings can be expired
  if (booking.status !== "pending") {
    // Already in a terminal/active state — nothing to release
    return booking;
  }

  // Access check: only the booking owner (or system, when userId omitted) may expire
  if (userId && booking.userId !== userId) {
    throw new ForbiddenError("You can only expire your own pending booking.");
  }

  const updated = await prisma.booking.update({
    where: { id: bookingId },
    data: {
      status: "expired",
      paymentStatus: booking.paymentStatus === "pending" ? "failed" : booking.paymentStatus,
      cancellationReason: reason || "Payment failed or booking expired",
      cancelledAt: new Date(),
    },
  });

  // Reverse any commission recorded for this booking
  await prisma.commission.updateMany({
    where: { bookingId },
    data: { status: "reversed" },
  }).catch(() => { /* commission may not exist yet */ });

  // Release coupon usage if applicable
  await releaseCouponUsage(bookingId);

  // Notify the guest that their pending booking was released
  if (booking.guestEmail) {
    await sendTemplatedEmail(booking.guestEmail, "bookingCancellation", {
      guestName: booking.guestName,
      itemName: booking.itemName,
      bookingRef: booking.bookingRef,
      refundAmount: 0,
    }).catch(() => { /* best-effort email */ });
  }

  await createAuditLog({
    actorId: userId || "system",
    action: "BOOKING_EXPIRED",
    category: "booking",
    resource: "Booking",
    resourceId: bookingId,
    details: {
      bookingRef: booking.bookingRef,
      reason: reason || "payment_failed_or_expired",
    },
  });

  logger.info(`Booking expired: ${booking.bookingRef} (reason: ${reason || "payment_failed_or_expired"})`);

  return updated;
}

// ─── Confirm a booking (host action for request bookings) ───
export async function confirmBooking(bookingId: string, hostId: string) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new NotFoundError("Booking not found.");

  if (booking.hostId !== hostId) {
    throw new ForbiddenError("Only the host can confirm this booking.");
  }

  if (booking.status !== "pending") {
    throw new BadRequestError("Only pending bookings can be confirmed.");
  }

  const updated = await prisma.booking.update({
    where: { id: bookingId },
    data: {
      status: "confirmed",
      confirmedAt: new Date(),
    },
  });

  // Notify guest
  if (booking.guestEmail) {
    await sendTemplatedEmail(booking.guestEmail, "bookingConfirmation", {
      guestName: booking.guestName,
      itemName: booking.itemName,
      bookingRef: booking.bookingRef,
      checkIn: booking.checkIn?.toLocaleDateString(),
      checkOut: booking.checkOut?.toLocaleDateString(),
      guests: booking.guests,
      totalAmount: booking.totalAmount,
    });
  }

  await sendPushToUser(booking.userId, {
    title: "Booking Confirmed!",
    body: `Your booking for ${booking.itemName} has been confirmed.`,
    data: { bookingId, type: "booking" },
  });

  await createAuditLog({
    actorId: hostId,
    action: "BOOKING_CONFIRMED",
    category: "booking",
    resource: "Booking",
    resourceId: bookingId,
    details: { bookingRef: booking.bookingRef },
  });

  return updated;
}

// ─── Reject a booking (host action) ───
export async function rejectBooking(bookingId: string, hostId: string, reason?: string) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new NotFoundError("Booking not found.");

  if (booking.hostId !== hostId) {
    throw new ForbiddenError("Only the host can reject this booking.");
  }

  if (booking.status !== "pending") {
    throw new BadRequestError("Only pending bookings can be rejected.");
  }

  const updated = await prisma.booking.update({
    where: { id: bookingId },
    data: {
      status: "rejected",
      cancellationReason: reason || null,
      cancelledAt: new Date(),
    },
  });

  // Reverse commission
  await prisma.commission.updateMany({
    where: { bookingId },
    data: { status: "reversed" },
  });

  // Release coupon usage if applicable
  await releaseCouponUsage(bookingId);

  await sendPushToUser(booking.userId, {
    title: "Booking Rejected",
    body: `Your booking for ${booking.itemName} was rejected by the host.`,
    data: { bookingId, type: "booking" },
  });

  await createAuditLog({
    actorId: hostId,
    action: "BOOKING_REJECTED",
    category: "booking",
    resource: "Booking",
    resourceId: bookingId,
    details: { bookingRef: booking.bookingRef, reason },
  });

  return updated;
}

// ─── Complete a booking (admin or system) ───
export async function completeBooking(bookingId: string, actorId?: string) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new NotFoundError("Booking not found.");

  if (booking.status !== "confirmed") {
    throw new BadRequestError("Only confirmed bookings can be completed.");
  }

  const updated = await prisma.booking.update({
    where: { id: bookingId },
    data: {
      status: "completed",
      completedAt: new Date(),
    },
  });

  await createAuditLog({
    actorId,
    action: "BOOKING_COMPLETED",
    category: "booking",
    resource: "Booking",
    resourceId: bookingId,
    details: { bookingRef: booking.bookingRef },
  });

  return updated;
}

// ─── Get booking pricing preview (before creating) ───
export async function getBookingPreview(data: {
  itemId: string;
  itemType: "listing" | "activity";
  checkIn?: string;
  checkOut?: string;
  guests: number;
  couponCode?: string;
}) {
  let item: any;
  if (data.itemType === "listing") {
    item = await prisma.listing.findUnique({ where: { id: data.itemId } });
  } else {
    item = await prisma.activity.findUnique({ where: { id: data.itemId } });
  }

  if (!item) throw new NotFoundError("Item not found.");

  const checkIn = data.checkIn ? new Date(data.checkIn) : null;
  const checkOut = data.checkOut ? new Date(data.checkOut) : null;

  const pricing = await calculateBookingPricing(item, data.itemType, checkIn, checkOut, data.guests, data.couponCode);

  return {
    item: {
      id: item.id,
      name: item.name,
      slug: item.slug,
    },
    pricing,
  };
}

// ─── Verify Check-In via OTP ───
export async function verifyCheckIn(bookingId: string, hostId: string, otp: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId }
  });

  if (!booking) {
    throw new NotFoundError("Booking not found.");
  }

  if (booking.hostId !== hostId) {
    throw new ForbiddenError("You do not have permission to verify check-in for this booking.");
  }

  // Allow check-in only for confirmed or paid bookings
  const lowerStatus = booking.status.toLowerCase();
  if (lowerStatus !== "confirmed" && lowerStatus !== "paid") {
    throw new BadRequestError(`Cannot check-in booking with status '${booking.status}'.`);
  }

  if (booking.checkInOtp !== otp) {
    throw new BadRequestError("Invalid check-in OTP. Please double-check with the guest.");
  }

  // Update booking status to completed and checkInStatus to checked_in
  const updatedBooking = await prisma.booking.update({
    where: { id: booking.id },
    data: {
      status: "completed",
      checkInStatus: "checked_in",
      completedAt: new Date(),
    }
  });

  // Log audit
  await createAuditLog({
    actorId: hostId,
    actorRole: "Host",
    action: "BOOKING_VERIFY_CHECKIN",
    category: "booking",
    resource: "Booking",
    resourceId: booking.id,
    details: { bookingRef: booking.bookingRef },
  });

  return await mapBookingToFrontend(updatedBooking, booking.userId);
}

export default {
  createBooking,
  getMyBookings,
  getBooking,
  cancelBooking,
  confirmBooking,
  rejectBooking,
  completeBooking,
  getBookingPreview,
  calculateBookingPricing,
  verifyCheckIn,
};
