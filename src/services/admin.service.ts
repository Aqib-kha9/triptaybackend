import bcrypt from "bcryptjs";
import { prisma } from "../config/db.js";
import { config } from "../core/config.js";
import type { JwtPayload } from "../utils/jwt.js";
import { signToken } from "../utils/jwt.js";
import { buildPaginationMeta } from "../utils/pagination.js";
import { logger } from "../core/logger.js";
import {
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
} from "../core/errors.js";

// ──────────────────────── Types ────────────────────────

export interface AdminLoginResult {
  token: string;
  user: Record<string, unknown>;
}

export interface KycApplication {
  _id: string;
  id: string;
  name: string;
  email: string;
  phone: string;
  panNumber: string;
  gstin: string;
  bankAccount: string;
  bankIFSC: string;
  aadharFront: string | null;
  aadharBack: string | null;
  panCardImage: string | null;
  kycStatus: string;
  status: string;
  role: string;
  submittedDate: string;
  createdAt: Date;
}

export interface AdminListQuery {
  page?: string;
  limit?: string;
  search?: string;
  status?: string;
  role?: string;
}

// ──────────────────────── Helpers ────────────────────────

function resolvePagination(
  pageStr?: string,
  limitStr?: string,
  defaultLimit = 10,
  maxLimit = 50,
): { page: number; limit: number; skip: number } {
  const page = Math.max(1, parseInt(pageStr || "1", 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(limitStr || String(defaultLimit), 10) || defaultLimit));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

function sanitizeUser(u: Record<string, unknown>): Record<string, unknown> {
  const obj = { ...u, _id: u.id };
  delete (obj as Record<string, unknown>).password;
  return obj;
}

function mapCoordinates<T extends Record<string, unknown>>(item: T): T & { coordinates: { lat: unknown; lng: unknown } } {
  const mapped = { ...item } as Record<string, unknown>;
  mapped.coordinates = { lat: mapped.lat, lng: mapped.lng };
  mapped._id = mapped.id;
  delete mapped.lat;
  delete mapped.lng;
  return mapped as T & { coordinates: { lat: unknown; lng: unknown } };
}

function sendAdminTokenCookie(res: import("express").Response, token: string): void {
  res.cookie("admin_token", token, {
    expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "lax" as const,
  });
}

function formatDateIndian(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ──────────────────────── Auth ────────────────────────

export async function adminLogin(
  email: string,
  password: string,
  res: import("express").Response,
): Promise<AdminLoginResult> {
  if (!email || !password) {
    throw new BadRequestError("Email and password are required.");
  }

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
  });

  if (!user) {
    throw new UnauthorizedError("Invalid credentials.");
  }

  if (user.role !== "Admin") {
    throw new ForbiddenError(
      "Access denied. This panel is restricted to system administrators only.",
    );
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    throw new UnauthorizedError("Invalid credentials.");
  }

  if (user.status === "Blocked") {
    throw new ForbiddenError("This administrator account has been suspended.");
  }

  const token = signToken({ id: user.id, email: user.email, role: user.role });
  sendAdminTokenCookie(res, token);

  const userObj = sanitizeUser(user as unknown as Record<string, unknown>);

  return { token, user: userObj };
}

export async function adminMe(adminId: string): Promise<Record<string, unknown>> {
  const admin = await prisma.user.findUnique({
    where: { id: adminId },
  });

  if (!admin) {
    throw new UnauthorizedError("Administrator account not found.");
  }

  return sanitizeUser(admin as unknown as Record<string, unknown>);
}

export function adminLogout(res: import("express").Response): void {
  res.cookie("admin_token", "loggedout", {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true,
  });
}

// ──────────────────────── KYC ────────────────────────

export async function listKycApplications(
  status?: string,
): Promise<KycApplication[]> {
  const filter: Record<string, unknown> = {
    role: { in: ["Guest", "Vendor", "Dual Mode"] },
    kycStatus: { not: "Not Submitted" },
  };

  if (status && ["Pending", "Approved", "Rejected"].includes(status)) {
    filter.kycStatus = status;
  }

  const users = await prisma.user.findMany({
    where: filter as any,
    orderBy: { updatedAt: "desc" },
  });

  return users.map((user: any) => ({
    _id: user.id,
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone || "—",
    panNumber: user.panNumber || "—",
    gstin: user.gstin || "—",
    bankAccount: user.bankAccount || "—",
    bankIFSC: user.bankIFSC || "—",
    aadharFront: user.aadharFront || null,
    aadharBack: user.aadharBack || null,
    panCardImage: user.panCardImage || null,
    kycStatus: user.kycStatus,
    status: user.kycStatus,
    role: user.role,
    submittedDate: user.updatedAt
      ? formatDateIndian(user.updatedAt)
      : "Unknown",
    createdAt: user.createdAt,
  }));
}

export async function approveKyc(userId: string): Promise<Record<string, unknown>> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new NotFoundError("User not found.");
  }

  if (user.kycStatus !== "Pending") {
    throw new BadRequestError(
      `Cannot approve application with status "${user.kycStatus}". Only pending applications can be approved.`,
    );
  }

  const updatedRole = user.role === "Guest" ? "Vendor" : user.role;

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      kycStatus: "Approved",
      role: updatedRole,
    },
  });

  return {
    _id: updated.id,
    id: updated.id,
    name: updated.name,
    email: updated.email,
    status: "Approved",
    kycStatus: "Approved",
    role: updated.role,
  };
}

export async function rejectKyc(userId: string): Promise<Record<string, unknown>> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new NotFoundError("User not found.");
  }

  if (user.kycStatus !== "Pending") {
    throw new BadRequestError(
      `Cannot reject application with status "${user.kycStatus}". Only pending applications can be rejected.`,
    );
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { kycStatus: "Rejected" },
  });

  return {
    _id: updated.id,
    id: updated.id,
    name: updated.name,
    email: updated.email,
    status: "Rejected",
    kycStatus: "Rejected",
  };
}

// ──────────────────────── Listings ────────────────────────

export async function listAllListings(query: AdminListQuery) {
  const { page, limit, skip } = resolvePagination(query.page, query.limit, 10, 50);
  const search = query.search || "";
  const status = query.status || "";

  const filter: Record<string, unknown> = {};

  if (status && ["draft", "published", "unlisted", "rejected"].includes(status)) {
    filter.status = status;
  }

  if (search) {
    filter.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { city: { contains: search, mode: "insensitive" } },
      { state: { contains: search, mode: "insensitive" } },
    ];
  }

  const total = await prisma.listing.count({ where: filter as any });
  const rawListings = await prisma.listing.findMany({
    where: filter as any,
    orderBy: { createdAt: "desc" },
    skip,
    take: limit,
  });

  const hostIds = Array.from(new Set(rawListings.map((l) => l.hostId)));
  const hosts = await prisma.user.findMany({
    where: { id: { in: hostIds } },
    select: { id: true, name: true, email: true, phone: true, avatar: true },
  });
  const hostMap = new Map(
    hosts.map((h) => [
      h.id,
      { _id: h.id, id: h.id, name: h.name, email: h.email, phone: h.phone, avatar: h.avatar },
    ]),
  );

  const listings = rawListings.map((l) => {
    const mapped = mapCoordinates(l as unknown as Record<string, unknown>);
    (mapped as Record<string, unknown>).host = hostMap.get(l.hostId) || null;
    return mapped;
  });

  const pagination = buildPaginationMeta(page, limit, total);

  return { listings, total, pagination };
}

export async function getListingDetail(listingId: string) {
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
  });

  if (!listing) {
    throw new NotFoundError("Listing not found.");
  }

  const host = await prisma.user.findUnique({
    where: { id: listing.hostId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      avatar: true,
      role: true,
      kycStatus: true,
    },
  });

  const mapped = mapCoordinates(listing as unknown as Record<string, unknown>);
  (mapped as Record<string, unknown>).host = host
    ? {
        _id: host.id,
        id: host.id,
        name: host.name,
        email: host.email,
        phone: host.phone,
        avatar: host.avatar,
        role: host.role,
        kycStatus: host.kycStatus,
      }
    : null;

  return { listing: mapped };
}

export async function toggleListingStatus(
  listingId: string,
  action: "suspend" | "activate",
): Promise<Record<string, unknown>> {
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
  });
  if (!listing) {
    throw new NotFoundError("Listing not found.");
  }

  let updatedIsActive = listing.isActive;
  let updatedStatus = listing.status;

  if (action === "suspend") {
    if (!listing.isActive) {
      throw new BadRequestError("Listing is already suspended.");
    }
    updatedIsActive = false;
    if (listing.status === "published") {
      updatedStatus = "unlisted";
    }
  } else {
    if (listing.isActive) {
      throw new BadRequestError("Listing is already active.");
    }
    updatedIsActive = true;
    if (listing.status === "unlisted") {
      updatedStatus = "published";
    }
  }

  const updated = await prisma.listing.update({
    where: { id: listingId },
    data: {
      isActive: updatedIsActive,
      status: updatedStatus,
    },
  });

  return {
    _id: updated.id,
    name: updated.name,
    status: updated.status,
    isActive: updated.isActive,
  };
}

export async function changeListingStatus(
  listingId: string,
  newStatus: string,
  adminNotes?: string,
): Promise<Record<string, unknown>> {
  if (!["published", "draft", "rejected"].includes(newStatus)) {
    throw new BadRequestError('Status must be "published", "draft", or "rejected".');
  }

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
  });
  if (!listing) {
    throw new NotFoundError("Listing not found.");
  }

  if (listing.status === newStatus) {
    throw new BadRequestError(`Listing is already "${newStatus}".`);
  }

  const oldStatus = listing.status;
  let updatedIsActive = listing.isActive;

  if (newStatus === "published") {
    updatedIsActive = true;
  } else if (newStatus === "rejected" || newStatus === "draft") {
    updatedIsActive = false;
  }

  const updated = await prisma.listing.update({
    where: { id: listingId },
    data: {
      status: newStatus,
      isActive: updatedIsActive,
      adminNotes: adminNotes !== undefined ? adminNotes?.trim() || null : undefined,
    },
  });

  // Create notification for the host
  try {
    const title = newStatus === "published" ? "Stay Published Successfully!" : "Stay Application Rejected";
    const description = newStatus === "published"
      ? `Your stay "${listing.name}" has been approved and published.`
      : `Your stay "${listing.name}" has been rejected. Notes: ${adminNotes || "None"}`;

    await prisma.notification.create({
      data: {
        recipientId: listing.hostId,
        type: `listing_${newStatus}`,
        title,
        description,
        link: "/vendor/stays",
      },
    });
  } catch (err) {
    console.error("Failed to create listing status change notification:", err);
  }

  return {
    _id: updated.id,
    name: updated.name,
    status: updated.status,
    isActive: updated.isActive,
    adminNotes: updated.adminNotes,
    oldStatus,
  };
}

// ──────────────────────── Activities ────────────────────────

export async function listAllActivities(query: AdminListQuery) {
  const { page, limit, skip } = resolvePagination(query.page, query.limit, 10, 50);
  const search = query.search || "";
  const status = query.status || "";

  const filter: Record<string, unknown> = {};

  if (status && ["draft", "published", "unlisted", "rejected"].includes(status)) {
    filter.status = status;
  }

  if (search) {
    filter.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { city: { contains: search, mode: "insensitive" } },
      { state: { contains: search, mode: "insensitive" } },
    ];
  }

  const total = await prisma.activity.count({ where: filter as any });
  const rawActivities = await prisma.activity.findMany({
    where: filter as any,
    orderBy: { createdAt: "desc" },
    skip,
    take: limit,
  });

  const hostIds = Array.from(new Set(rawActivities.map((a) => a.hostId)));
  const hosts = await prisma.user.findMany({
    where: { id: { in: hostIds } },
    select: { id: true, name: true, email: true, phone: true, avatar: true },
  });
  const hostMap = new Map(
    hosts.map((h) => [
      h.id,
      { _id: h.id, id: h.id, name: h.name, email: h.email, phone: h.phone, avatar: h.avatar },
    ]),
  );

  const activities = rawActivities.map((a) => {
    const mapped = mapCoordinates(a as unknown as Record<string, unknown>);
    (mapped as Record<string, unknown>).host = hostMap.get(a.hostId) || null;
    return mapped;
  });

  const pagination = buildPaginationMeta(page, limit, total);

  return { activities, total, pagination };
}

export async function getActivityDetail(activityId: string) {
  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
  });

  if (!activity) {
    throw new NotFoundError("Activity not found.");
  }

  const host = await prisma.user.findUnique({
    where: { id: activity.hostId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      avatar: true,
      role: true,
      kycStatus: true,
    },
  });

  const mapped = mapCoordinates(activity as unknown as Record<string, unknown>);
  (mapped as Record<string, unknown>).host = host
    ? {
        _id: host.id,
        id: host.id,
        name: host.name,
        email: host.email,
        phone: host.phone,
        avatar: host.avatar,
        role: host.role,
        kycStatus: host.kycStatus,
      }
    : null;

  return { activity: mapped };
}

export async function toggleActivityStatus(
  activityId: string,
  action: "suspend" | "activate",
): Promise<Record<string, unknown>> {
  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
  });
  if (!activity) {
    throw new NotFoundError("Activity not found.");
  }

  let updatedIsActive = activity.isActive;
  let updatedStatus = activity.status;

  if (action === "suspend") {
    if (!activity.isActive) {
      throw new BadRequestError("Activity is already suspended.");
    }
    updatedIsActive = false;
    if (activity.status === "published") {
      updatedStatus = "unlisted";
    }
  } else {
    if (activity.isActive) {
      throw new BadRequestError("Activity is already active.");
    }
    updatedIsActive = true;
    if (activity.status === "unlisted") {
      updatedStatus = "published";
    }
  }

  const updated = await prisma.activity.update({
    where: { id: activityId },
    data: {
      isActive: updatedIsActive,
      status: updatedStatus,
    },
  });

  return {
    _id: updated.id,
    name: updated.name,
    status: updated.status,
    isActive: updated.isActive,
  };
}

export async function changeActivityStatus(
  activityId: string,
  newStatus: string,
  adminNotes?: string,
): Promise<Record<string, unknown>> {
  if (!["published", "draft", "rejected"].includes(newStatus)) {
    throw new BadRequestError('Status must be "published", "draft", or "rejected".');
  }

  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
  });
  if (!activity) {
    throw new NotFoundError("Activity not found.");
  }

  if (activity.status === newStatus) {
    throw new BadRequestError(`Activity is already "${newStatus}".`);
  }

  const oldStatus = activity.status;
  let updatedIsActive = activity.isActive;

  if (newStatus === "published") {
    updatedIsActive = true;
  } else if (newStatus === "rejected" || newStatus === "draft") {
    updatedIsActive = false;
  }

  const updated = await prisma.activity.update({
    where: { id: activityId },
    data: {
      status: newStatus,
      isActive: updatedIsActive,
      adminNotes: adminNotes !== undefined ? adminNotes?.trim() || null : undefined,
    },
  });

  // Create notification for the host
  try {
    const title = newStatus === "published" ? "Activity Published Successfully!" : "Activity Application Rejected";
    const description = newStatus === "published"
      ? `Your activity "${activity.name}" has been approved and published.`
      : `Your activity "${activity.name}" has been rejected. Notes: ${adminNotes || "None"}`;

    await prisma.notification.create({
      data: {
        recipientId: activity.hostId,
        type: `activity_${newStatus}`,
        title,
        description,
        link: "/vendor/activities",
      },
    });
  } catch (err) {
    console.error("Failed to create activity status change notification:", err);
  }

  return {
    _id: updated.id,
    name: updated.name,
    status: updated.status,
    isActive: updated.isActive,
    adminNotes: updated.adminNotes,
    oldStatus,
  };
}

// ──────────────────────── Users ────────────────────────

export async function listAllUsers(query: AdminListQuery) {
  const { page, limit, skip } = resolvePagination(query.page, query.limit, 10, 50);
  const search = query.search || "";
  const role = query.role || "";

  const filter: Record<string, unknown> = { role: { not: "Admin" } };

  if (role && ["Guest", "Vendor", "Dual Mode"].includes(role)) {
    filter.role = role;
  }

  if (search.trim()) {
    filter.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { phone: { contains: search, mode: "insensitive" } },
    ];
  }

  const total = await prisma.user.count({ where: filter as any });
  const rawUsers = await prisma.user.findMany({
    where: filter as any,
    orderBy: { createdAt: "desc" },
    skip,
    take: limit,
  });

  const users = rawUsers.map((user) =>
    sanitizeUser(user as unknown as Record<string, unknown>),
  );

  const pagination = buildPaginationMeta(page, limit, total);

  return { users, total, pagination };
}

export async function getUserDetail(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    throw new NotFoundError("User not found.");
  }

  return { user: sanitizeUser(user as unknown as Record<string, unknown>) };
}

export async function toggleUserStatus(
  userId: string,
): Promise<Record<string, unknown>> {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    throw new NotFoundError("User not found.");
  }

  if (user.role === "Admin") {
    throw new ForbiddenError("Cannot modify admin accounts.");
  }

  const oldStatus = user.status;
  const newStatus = oldStatus === "Active" ? "Blocked" : "Active";

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { status: newStatus },
  });

  return {
    userId: updated.id,
    status: updated.status,
    oldStatus,
  };
}

export async function updateUserWallet(
  userId: string,
  amount: number,
  reason?: string,
): Promise<Record<string, unknown>> {
  if (typeof amount !== "number" || isNaN(amount)) {
    throw new BadRequestError("A valid numeric amount is required.");
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    throw new NotFoundError("User not found.");
  }

  const oldBalance = user.walletBalance;
  const newBalance = Math.max(0, user.walletBalance + amount);

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { walletBalance: newBalance },
  });

  return {
    userId: updated.id,
    walletBalance: updated.walletBalance,
    oldBalance,
    amount,
    reason: reason || (amount >= 0 ? "Admin credit" : "Admin debit"),
  };
}

export async function deleteUser(userId: string): Promise<{ name: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    throw new NotFoundError("User not found.");
  }

  if (user.role === "Admin") {
    throw new ForbiddenError("Cannot delete admin accounts.");
  }

  await prisma.user.delete({ where: { id: userId } });

  return { name: user.name };
}

// ──────────────────────── Testimonials ────────────────────────

export async function listTestimonials() {
  const testimonials = await prisma.testimonial.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "desc" }],
  });

  return testimonials.map((t) => ({ ...t, _id: t.id }));
}

export async function createTestimonial(data: {
  name: string;
  role: string;
  text: string;
  image?: string;
  order?: number;
  isActive?: boolean;
}) {
  const testimonial = await prisma.testimonial.create({
    data: {
      name: data.name,
      role: data.role,
      text: data.text,
      image: data.image || "",
      order: data.order !== undefined ? Number(data.order) : 0,
      isActive: data.isActive ?? true,
    },
  });

  return { ...testimonial, _id: testimonial.id };
}

export async function updateTestimonial(
  id: string,
  data: {
    name?: string;
    role?: string;
    text?: string;
    image?: string;
    order?: number;
    isActive?: boolean;
  },
) {
  const testimonial = await prisma.testimonial.findUnique({ where: { id } });
  if (!testimonial) {
    throw new NotFoundError("Testimonial not found.");
  }

  const updated = await prisma.testimonial.update({
    where: { id },
    data: {
      name: data.name !== undefined ? data.name : undefined,
      role: data.role !== undefined ? data.role : undefined,
      text: data.text !== undefined ? data.text : undefined,
      image: data.image !== undefined ? data.image : undefined,
      order: data.order !== undefined ? Number(data.order) : undefined,
      isActive: data.isActive !== undefined ? data.isActive : undefined,
    },
  });

  return { ...updated, _id: updated.id };
}

export async function deleteTestimonial(id: string): Promise<void> {
  const testimonial = await prisma.testimonial.findUnique({ where: { id } });
  if (!testimonial) {
    throw new NotFoundError("Testimonial not found.");
  }

  await prisma.testimonial.delete({ where: { id } });
}

export async function getPublicTestimonials() {
  const testimonials = await prisma.testimonial.findMany({
    where: { isActive: true },
    orderBy: [{ order: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      role: true,
      text: true,
      image: true,
      order: true,
    },
  });

  return testimonials.map((t) => ({ ...t, _id: t.id }));
}

// ──────────────────────── Dashboard Stats ────────────────────────

export async function getDashboardStats() {
  const [
    totalUsers,
    totalListings,
    totalActivities,
    totalBookings,
    pendingKyc,
    publishedListings,
    publishedActivities,
    activeBookings,
    totalRevenue,
    pendingPayouts,
    activeCoupons,
  ] = await Promise.all([
    prisma.user.count({ where: { role: { not: "Admin" } } }),
    prisma.listing.count(),
    prisma.activity.count(),
    prisma.booking.count(),
    prisma.user.count({ where: { kycStatus: "pending" } }),
    prisma.listing.count({ where: { status: "published" } }),
    prisma.activity.count({ where: { status: "published" } }),
    prisma.booking.count({ where: { status: { in: ["pending", "confirmed"] } } }),
    prisma.payment.aggregate({ where: { status: "captured" }, _sum: { amount: true } }),
    prisma.payout.count({ where: { status: "pending" } }),
    prisma.coupon.count({ where: { isActive: true, validUntil: { gte: new Date() } } }),
  ]);

  // Recent bookings (last 5) — fetch user separately since Booking has no relation
  const recentBookingsRaw = await prisma.booking.findMany({
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      bookingRef: true,
      status: true,
      totalAmount: true,
      createdAt: true,
      userId: true,
      itemName: true,
    },
  });

  // Fetch associated users for recent bookings
  const recentBookingUserIds = [...new Set(recentBookingsRaw.map((b) => b.userId))];
  const recentBookingUsers = await prisma.user.findMany({
    where: { id: { in: recentBookingUserIds } },
    select: { id: true, name: true, email: true },
  });
  const userMap = new Map(recentBookingUsers.map((u) => [u.id, u]));

  const recentBookings = recentBookingsRaw.map((b) => ({
    ...b,
    _id: b.id,
    userName: userMap.get(b.userId)?.name,
    userEmail: userMap.get(b.userId)?.email,
  }));

  // Recent users (last 5)
  const recentUsers = await prisma.user.findMany({
    where: { role: { not: "Admin" } },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
    },
  });

  return {
    counts: {
      users: totalUsers,
      listings: totalListings,
      activities: totalActivities,
      bookings: totalBookings,
      pendingKyc,
      publishedListings,
      publishedActivities,
      activeBookings,
      pendingPayouts,
      activeCoupons,
    },
    revenue: totalRevenue._sum.amount || 0,
    recentBookings,
    recentUsers: recentUsers.map((u) => ({ ...u, _id: u.id })),
  };
}

// ──────────────────────── Bookings (Admin) ────────────────────────

export async function listAllBookings(query: AdminListQuery) {
  const { page, limit, skip } = resolvePagination(query.page, query.limit, 10, 50);
  const search = query.search || "";
  const status = query.status || "";

  const filter: Record<string, unknown> = {};

  if (status && ["pending", "confirmed", "cancelled", "completed", "rejected"].includes(status)) {
    filter.status = status;
  }

  if (search.trim()) {
    filter.OR = [
      { bookingRef: { contains: search, mode: "insensitive" } },
      { user: { name: { contains: search, mode: "insensitive" } } },
      { user: { email: { contains: search, mode: "insensitive" } } },
    ];
  }

  const [bookings, total] = await Promise.all([
    prisma.booking.findMany({
      where: filter as any,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.booking.count({ where: filter as any }),
  ]);

  // Fetch associated users separately (Booking has no relation to User)
  const userIds = [...new Set(bookings.map((b) => b.userId))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, email: true, avatar: true },
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  const mapped = bookings.map((b) => ({
    ...b,
    _id: b.id,
    userName: userMap.get(b.userId)?.name,
    userEmail: userMap.get(b.userId)?.email,
    userAvatar: userMap.get(b.userId)?.avatar,
  }));

  return {
    bookings: mapped,
    total,
    pagination: buildPaginationMeta(page, limit, total),
  };
}

export async function getBookingDetail(bookingId: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
  });

  if (!booking) {
    throw new NotFoundError("Booking not found.");
  }

  // Fetch associated user and payments separately
  const [user, payments] = await Promise.all([
    prisma.user.findUnique({
      where: { id: booking.userId },
      select: { id: true, name: true, email: true, phone: true, avatar: true },
    }),
    prisma.payment.findMany({ where: { bookingId } }),
  ]);

  return {
    booking: {
      ...booking,
      _id: booking.id,
      user,
      payments,
    },
  };
}

// ──────────────────────── Coupons (Admin) ────────────────────────

export async function listAllCoupons(query: AdminListQuery) {
  const { page, limit, skip } = resolvePagination(query.page, query.limit, 10, 50);
  const search = query.search || "";

  const filter: Record<string, unknown> = {};
  if (search.trim()) {
    filter.OR = [
      { code: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
    ];
  }

  const [coupons, total] = await Promise.all([
    prisma.coupon.findMany({
      where: filter as any,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.coupon.count({ where: filter as any }),
  ]);

  return {
    coupons: coupons.map((c) => ({ ...c, _id: c.id })),
    total,
    pagination: buildPaginationMeta(page, limit, total),
  };
}

// ──────────────────────── Payouts (Admin) ────────────────────────

export async function listAllPayouts(query: AdminListQuery) {
  const { page, limit, skip } = resolvePagination(query.page, query.limit, 10, 50);
  const status = query.status || "";

  const filter: Record<string, unknown> = {};
  if (status && ["pending", "processing", "paid", "failed"].includes(status)) {
    filter.status = status;
  }

  const [payouts, total] = await Promise.all([
    prisma.payout.findMany({
      where: filter as any,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.payout.count({ where: filter as any }),
  ]);

  // Fetch associated hosts separately (Payout has no relation to User)
  const hostIds = [...new Set(payouts.map((p) => p.hostId))];
  const hosts = await prisma.user.findMany({
    where: { id: { in: hostIds } },
    select: { id: true, name: true, email: true },
  });
  const hostMap = new Map(hosts.map((h) => [h.id, h]));

  return {
    payouts: payouts.map((p) => ({
      ...p,
      _id: p.id,
      hostName: hostMap.get(p.hostId)?.name,
      hostEmail: hostMap.get(p.hostId)?.email,
    })),
    total,
    pagination: buildPaginationMeta(page, limit, total),
  };
}

// ──────────────────────── Audit Logs (Admin) ────────────────────────

export async function listAuditLogs(query: AdminListQuery & { action?: string; category?: string }) {
  const { page, limit, skip } = resolvePagination(query.page, query.limit, 20, 100);
  const search = query.search || "";
  const action = query.action || "";
  const category = query.category || "";

  const filter: Record<string, unknown> = {};
  if (action) filter.action = action;
  if (category) filter.category = category;
  if (search.trim()) {
    filter.OR = [
      { resource: { contains: search, mode: "insensitive" } },
      { actorEmail: { contains: search, mode: "insensitive" } },
      { action: { contains: search, mode: "insensitive" } },
    ];
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where: filter as any,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.auditLog.count({ where: filter as any }),
  ]);

  return {
    logs: logs.map((l) => ({ ...l, _id: l.id })),
    total,
    pagination: buildPaginationMeta(page, limit, total),
  };
}

// ──────────────────────── Admin: Update Listing ────────────────────────

export async function updateListing(
  listingId: string,
  data: { title?: string; price?: number; status?: string },
): Promise<Record<string, unknown>> {
  const listing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!listing) {
    throw new NotFoundError("Listing not found.");
  }

  const updateData: Record<string, unknown> = {};
  if (data.title !== undefined) updateData.name = data.title;
  if (data.price !== undefined) updateData.basePrice = data.price;
  if (data.status !== undefined) {
    if (!["published", "draft", "rejected", "unlisted"].includes(data.status)) {
      throw new BadRequestError('Status must be "published", "draft", "rejected", or "unlisted".');
    }
    updateData.status = data.status;
    updateData.isActive = data.status === "published";
  }

  const updated = await prisma.listing.update({
    where: { id: listingId },
    data: updateData as any,
  });

  return {
    _id: updated.id,
    name: updated.name,
    basePrice: updated.basePrice,
    status: updated.status,
    isActive: updated.isActive,
  };
}

// ──────────────────────── Admin: Update User ────────────────────────

export async function updateUser(
  userId: string,
  data: { name?: string; email?: string; phone?: string; kycStatus?: string },
): Promise<Record<string, unknown>> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new NotFoundError("User not found.");
  }
  if (user.role === "Admin") {
    throw new ForbiddenError("Cannot modify admin accounts.");
  }

  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.email !== undefined) updateData.email = data.email;
  if (data.phone !== undefined) updateData.phone = data.phone;
  if (data.kycStatus !== undefined) {
    if (!["unverified", "pending", "verified", "rejected"].includes(data.kycStatus)) {
      throw new BadRequestError('KYC status must be "unverified", "pending", "verified", or "rejected".');
    }
    updateData.kycStatus = data.kycStatus;
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: updateData as any,
  });

  return sanitizeUser(updated as unknown as Record<string, unknown>);
}

// ──────────────────────── Admin: Cancel Booking ────────────────────────

export async function adminCancelBooking(
  bookingId: string,
  adminId: string,
): Promise<Record<string, unknown>> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) {
    throw new NotFoundError("Booking not found.");
  }

  if (booking.status === "Cancelled") {
    throw new BadRequestError("Booking is already cancelled.");
  }

  const oldStatus = booking.status;

  const updated = await prisma.booking.update({
    where: { id: bookingId },
    data: {
      status: "Cancelled",
      cancelledAt: new Date(),
    },
  });

  // If booking was confirmed/paid, refund to user wallet
  if (oldStatus === "Confirmed" || oldStatus === "Completed") {
    await prisma.user.update({
      where: { id: booking.userId },
      data: { walletBalance: { increment: booking.totalAmount } },
    });
  }

  // Create audit log
  await prisma.auditLog.create({
    data: {
      actorId: adminId,
      actorEmail: "admin@triptay.com",
      actorRole: "Admin",
      action: "admin.cancel_booking",
      category: "booking",
      resource: "booking",
      resourceId: bookingId,
      method: "POST",
      path: `/api/admin/bookings/${bookingId}/cancel`,
      statusCode: 200,
      details: {
        bookingId,
        oldStatus,
        newStatus: "Cancelled",
        refundAmount: (oldStatus === "Confirmed" || oldStatus === "Completed") ? booking.totalAmount : 0,
      },
    },
  });

  return {
    _id: updated.id,
    status: updated.status,
    oldStatus,
    refundAmount: (oldStatus === "Confirmed" || oldStatus === "Completed") ? booking.totalAmount : 0,
  };
}