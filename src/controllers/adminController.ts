import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { prisma } from "../config/db.js";

// ──────────────────────── Helper ────────────────────────

const signToken = (id: string, email: string, role: string): string => {
  return jwt.sign(
    { id, email, role },
    process.env.JWT_SECRET || "super_secret_triptay_key_2026",
    { expiresIn: "7d" }
  );
};

const sendTokenResponse = (user: any, statusCode: number, res: Response) => {
  const token = signToken(user.id, user.email, user.role);

  const cookieOptions = {
    expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
  };

  res.cookie("admin_token", token, cookieOptions);

  const userObj = { ...user, _id: user.id };
  delete userObj.password;

  res.status(statusCode).json({
    status: "success",
    token,
    data: { user: userObj },
  });
};

// ──────────────────────── Controllers ────────────────────────

/**
 * @desc    Admin-only login — rejects non-admin users
 * @route   POST /api/admin/login
 * @access  Public
 */
export const adminLogin = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res
        .status(400)
        .json({ status: "fail", message: "Email and password are required." });
      return;
    }

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() }
    });

    if (!user) {
      res
        .status(401)
        .json({ status: "fail", message: "Invalid credentials." });
      return;
    }

    // ── CRITICAL: ONLY allow Admin role ──
    if (user.role !== "Admin") {
      res
        .status(403)
        .json({
          status: "fail",
          message: "Access denied. This panel is restricted to system administrators only.",
        });
      return;
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      res
        .status(401)
        .json({ status: "fail", message: "Invalid credentials." });
      return;
    }

    // Check if admin account is blocked (should never happen but safety first)
    if (user.status === "Blocked") {
      res
        .status(403)
        .json({ status: "fail", message: "This administrator account has been suspended." });
      return;
    }

    sendTokenResponse(user, 200, res);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get current admin profile
 * @route   GET /api/admin/me
 * @access  Private (Admin only)
 */
export const adminMe = async (
  req: any,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      res
        .status(401)
        .json({ status: "fail", message: "Admin session not active." });
      return;
    }

    // Reload from DB to get fresh data
    const admin = await prisma.user.findUnique({
      where: { id: req.user.id }
    });
    if (!admin) {
      res
        .status(401)
        .json({ status: "fail", message: "Administrator account not found." });
      return;
    }

    const adminObj = { ...admin, _id: admin.id };
    delete (adminObj as any).password;

    res.status(200).json({
      status: "success",
      data: { user: adminObj },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Admin logout — clear token
 * @route   POST /api/admin/logout
 * @access  Public
 */
export const adminLogout = async (
  _req: Request,
  res: Response
): Promise<void> => {
  res.cookie("admin_token", "loggedout", {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true,
  });

  res.status(200).json({
    status: "success",
    message: "Administrator logged out successfully.",
  });
};

// ──────────────────────── KYC Administration ────────────────────────

/**
 * @desc    List all KYC applications (filterable by status)
 * @route   GET /api/admin/kyc?status=Pending|Approved|Rejected
 * @access  Private (Admin only)
 */
export const listKycApplications = async (
  req: any,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { status } = req.query;

    // Build query: only vendor/dual-mode users who submitted KYC
    const filter: any = {
      role: { in: ["Vendor", "Dual Mode"] },
      kycStatus: { not: "Not Submitted" },
    };

    if (status && ["Pending", "Approved", "Rejected"].includes(status as string)) {
      filter.kycStatus = status as string;
    }

    const users = await prisma.user.findMany({
      where: filter,
      orderBy: { updatedAt: "desc" },
    });

    // Transform to match the admin panel's expected shape
    const applications = users.map((user: any) => ({
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
      status: user.kycStatus, // alias for frontend compatibility
      role: user.role,
      submittedDate: user.updatedAt
        ? new Date(user.updatedAt).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })
        : "Unknown",
      createdAt: user.createdAt,
    }));

    res.status(200).json({
      status: "success",
      results: applications.length,
      data: { applications },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Approve a user's KYC application
 * @route   PATCH /api/admin/kyc/:userId/approve
 * @access  Private (Admin only)
 */
export const approveKyc = async (
  req: any,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId }
    });
    if (!user) {
      res.status(404).json({ status: "fail", message: "User not found." });
      return;
    }

    if (user.kycStatus !== "Pending") {
      res.status(400).json({
        status: "fail",
        message: `Cannot approve application with status "${user.kycStatus}". Only pending applications can be approved.`,
      });
      return;
    }

    const updatedRole = user.role === "Guest" ? "Vendor" : user.role;

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        kycStatus: "Approved",
        role: updatedRole,
      }
    });

    res.status(200).json({
      status: "success",
      message: `${updated.name}'s KYC has been approved.`,
      data: {
        application: {
          _id: updated.id,
          id: updated.id,
          name: updated.name,
          email: updated.email,
          status: "Approved",
          kycStatus: "Approved",
          role: updated.role,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Reject a user's KYC application
 * @route   PATCH /api/admin/kyc/:userId/reject
 * @access  Private (Admin only)
 */
export const rejectKyc = async (
  req: any,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId }
    });
    if (!user) {
      res.status(404).json({ status: "fail", message: "User not found." });
      return;
    }

    if (user.kycStatus !== "Pending") {
      res.status(400).json({
        status: "fail",
        message: `Cannot reject application with status "${user.kycStatus}". Only pending applications can be rejected.`,
      });
      return;
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { kycStatus: "Rejected" }
    });

    res.status(200).json({
      status: "success",
      message: `${updated.name}'s KYC has been rejected.`,
      data: {
        application: {
          _id: updated.id,
          id: updated.id,
          name: updated.name,
          email: updated.email,
          status: "Rejected",
          kycStatus: "Rejected",
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── Listing / Stays Administration ────────────────────────

/**
 * @desc    List ALL listings for admin with pagination, search & status filter
 * @route   GET /api/admin/listings?page=1&limit=10&search=&status=
 * @access  Private (Admin only)
 */
export const listAllListings = async (
  req: any,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 10));
    const search = (req.query.search as string) || "";
    const status = (req.query.status as string) || "";

    // Build query
    const filter: any = {};

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

    const total = await prisma.listing.count({ where: filter });
    const rawListings = await prisma.listing.findMany({
      where: filter,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    });

    // Populate host manually
    const hostIds = Array.from(new Set(rawListings.map(l => l.hostId)));
    const hosts = await prisma.user.findMany({
      where: { id: { in: hostIds } },
      select: { id: true, name: true, email: true, phone: true, avatar: true }
    });
    const hostMap = new Map(hosts.map(h => [h.id, { _id: h.id, id: h.id, name: h.name, email: h.email, phone: h.phone, avatar: h.avatar }]));

    const listings = rawListings.map(l => {
      const mapped = {
        ...l,
        _id: l.id,
        host: hostMap.get(l.hostId) || null,
        coordinates: { lat: l.lat, lng: l.lng }
      };
      delete (mapped as any).lat;
      delete (mapped as any).lng;
      return mapped;
    });

    const totalPages = Math.ceil(total / limit);

    res.status(200).json({
      status: "success",
      results: listings.length,
      total,
      page,
      totalPages,
      data: { listings },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get a single listing detail for admin review
 * @route   GET /api/admin/listings/:listingId
 * @access  Private (Admin only)
 */
export const getListingDetail = async (
  req: any,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { listingId } = req.params;

    const listing = await prisma.listing.findUnique({
      where: { id: listingId }
    });

    if (!listing) {
      res.status(404).json({ status: "fail", message: "Listing not found." });
      return;
    }

    const host = await prisma.user.findUnique({
      where: { id: listing.hostId },
      select: { id: true, name: true, email: true, phone: true, avatar: true, role: true, kycStatus: true }
    });

    const mapped = {
      ...listing,
      _id: listing.id,
      host: host ? { _id: host.id, id: host.id, name: host.name, email: host.email, phone: host.phone, avatar: host.avatar, role: host.role, kycStatus: host.kycStatus } : null,
      coordinates: { lat: listing.lat, lng: listing.lng }
    };
    delete (mapped as any).lat;
    delete (mapped as any).lng;

    res.status(200).json({
      status: "success",
      data: { listing: mapped },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Admin toggle — suspend / activate a listing
 * @route   PATCH /api/admin/listings/:listingId/toggle-status
 * @body    { action: "suspend" | "activate" }
 * @access  Private (Admin only)
 */
export const toggleListingStatus = async (
  req: any,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { listingId } = req.params;
    const { action } = req.body;

    if (!action || !["suspend", "activate"].includes(action)) {
      res.status(400).json({
        status: "fail",
        message: 'Action must be "suspend" or "activate".',
      });
      return;
    }

    const listing = await prisma.listing.findUnique({
      where: { id: listingId }
    });
    if (!listing) {
      res.status(404).json({ status: "fail", message: "Listing not found." });
      return;
    }

    let updatedIsActive = listing.isActive;
    let updatedStatus = listing.status;

    if (action === "suspend") {
      if (!listing.isActive) {
        res.status(400).json({
          status: "fail",
          message: "Listing is already suspended.",
        });
        return;
      }
      updatedIsActive = false;
      if (listing.status === "published") {
        updatedStatus = "unlisted";
      }
    } else {
      if (listing.isActive) {
        res.status(400).json({
          status: "fail",
          message: "Listing is already active.",
        });
        return;
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
      }
    });

    res.status(200).json({
      status: "success",
      message:
        action === "suspend"
          ? `"${updated.name}" has been suspended.`
          : `"${updated.name}" has been activated.`,
      data: {
        listing: {
          _id: updated.id,
          name: updated.name,
          status: updated.status,
          isActive: updated.isActive,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Admin changes listing publication status (draft / published / rejected)
 * @route   PATCH /api/admin/listings/:listingId/change-status
 * @body    { status: "published" | "draft" | "rejected", adminNotes?: string }
 * @access  Private (Admin only)
 */
export const changeListingStatus = async (
  req: any,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { listingId } = req.params;
    const { status: newStatus, adminNotes } = req.body;

    if (!newStatus || !["published", "draft", "rejected"].includes(newStatus)) {
      res.status(400).json({
        status: "fail",
        message: 'Status must be "published", "draft", or "rejected".',
      });
      return;
    }

    const listing = await prisma.listing.findUnique({
      where: { id: listingId }
    });
    if (!listing) {
      res.status(404).json({ status: "fail", message: "Listing not found." });
      return;
    }

    if (listing.status === newStatus) {
      res.status(400).json({
        status: "fail",
        message: `Listing is already "${newStatus}".`,
      });
      return;
    }

    const oldStatus = listing.status;
    let updatedIsActive = listing.isActive;

    // Auto-adjust isActive based on status change
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
      }
    });

    res.status(200).json({
      status: "success",
      message: `"${updated.name}" status changed from ${oldStatus} → ${newStatus}.`,
      data: {
        listing: {
          _id: updated.id,
          name: updated.name,
          status: updated.status,
          isActive: updated.isActive,
          adminNotes: updated.adminNotes,
          oldStatus,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════
//  ACTIVITY ADMINISTRATION
// ═══════════════════════════════════════════════════════════════

/**
 * @desc    List all activities for admin overview with search, pagination & status filter
 * @route   GET /api/admin/activities
 * @access  Private (Admin only)
 */
export const listAllActivities = async (
  req: any,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 10));
    const search = (req.query.search as string) || "";
    const status = (req.query.status as string) || "";

    // Build query
    const filter: any = {};

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

    const total = await prisma.activity.count({ where: filter });
    const rawActivities = await prisma.activity.findMany({
      where: filter,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    });

    // Populate host manually
    const hostIds = Array.from(new Set(rawActivities.map(a => a.hostId)));
    const hosts = await prisma.user.findMany({
      where: { id: { in: hostIds } },
      select: { id: true, name: true, email: true, phone: true, avatar: true }
    });
    const hostMap = new Map(hosts.map(h => [h.id, { _id: h.id, id: h.id, name: h.name, email: h.email, phone: h.phone, avatar: h.avatar }]));

    const activities = rawActivities.map(a => {
      const mapped = {
        ...a,
        _id: a.id,
        host: hostMap.get(a.hostId) || null,
        coordinates: { lat: a.lat, lng: a.lng }
      };
      delete (mapped as any).lat;
      delete (mapped as any).lng;
      return mapped;
    });

    const totalPages = Math.ceil(total / limit);

    res.status(200).json({
      status: "success",
      results: activities.length,
      total,
      page,
      totalPages,
      data: { activities },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get a single activity detail for admin review
 * @route   GET /api/admin/activities/:activityId
 * @access  Private (Admin only)
 */
export const getActivityDetail = async (
  req: any,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { activityId } = req.params;

    const activity = await prisma.activity.findUnique({
      where: { id: activityId }
    });

    if (!activity) {
      res.status(404).json({ status: "fail", message: "Activity not found." });
      return;
    }

    const host = await prisma.user.findUnique({
      where: { id: activity.hostId },
      select: { id: true, name: true, email: true, phone: true, avatar: true, role: true, kycStatus: true }
    });

    const mapped = {
      ...activity,
      _id: activity.id,
      host: host ? { _id: host.id, id: host.id, name: host.name, email: host.email, phone: host.phone, avatar: host.avatar, role: host.role, kycStatus: host.kycStatus } : null,
      coordinates: { lat: activity.lat, lng: activity.lng }
    };
    delete (mapped as any).lat;
    delete (mapped as any).lng;

    res.status(200).json({
      status: "success",
      data: { activity: mapped },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Admin toggle — suspend / activate an activity
 * @route   PATCH /api/admin/activities/:activityId/toggle-status
 * @body    { action: "suspend" | "activate" }
 * @access  Private (Admin only)
 */
export const toggleActivityStatus = async (
  req: any,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { activityId } = req.params;
    const { action } = req.body;

    if (!action || !["suspend", "activate"].includes(action)) {
      res.status(400).json({
        status: "fail",
        message: 'Action must be "suspend" or "activate".',
      });
      return;
    }

    const activity = await prisma.activity.findUnique({
      where: { id: activityId }
    });
    if (!activity) {
      res.status(404).json({ status: "fail", message: "Activity not found." });
      return;
    }

    let updatedIsActive = activity.isActive;
    let updatedStatus = activity.status;

    if (action === "suspend") {
      if (!activity.isActive) {
        res.status(400).json({
          status: "fail",
          message: "Activity is already suspended.",
        });
        return;
      }
      updatedIsActive = false;
      if (activity.status === "published") {
        updatedStatus = "unlisted";
      }
    } else {
      if (activity.isActive) {
        res.status(400).json({
          status: "fail",
          message: "Activity is already active.",
        });
        return;
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
      }
    });

    res.status(200).json({
      status: "success",
      message:
        action === "suspend"
          ? `"${updated.name}" has been suspended.`
          : `"${updated.name}" has been activated.`,
      data: {
        activity: {
          _id: updated.id,
          name: updated.name,
          status: updated.status,
          isActive: updated.isActive,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Admin changes activity publication status (draft / published / rejected)
 * @route   PATCH /api/admin/activities/:activityId/change-status
 * @body    { status: "published" | "draft" | "rejected", adminNotes?: string }
 * @access  Private (Admin only)
 */
export const changeActivityStatus = async (
  req: any,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { activityId } = req.params;
    const { status: newStatus, adminNotes } = req.body;

    if (!newStatus || !["published", "draft", "rejected"].includes(newStatus)) {
      res.status(400).json({
        status: "fail",
        message: 'Status must be "published", "draft", or "rejected".',
      });
      return;
    }

    const activity = await prisma.activity.findUnique({
      where: { id: activityId }
    });
    if (!activity) {
      res.status(404).json({ status: "fail", message: "Activity not found." });
      return;
    }

    if (activity.status === newStatus) {
      res.status(400).json({
        status: "fail",
        message: `Activity is already "${newStatus}".`,
      });
      return;
    }

    const oldStatus = activity.status;
    let updatedIsActive = activity.isActive;

    // Auto-adjust isActive based on status change
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
      }
    });

    res.status(200).json({
      status: "success",
      message: `"${updated.name}" status changed from ${oldStatus} → ${newStatus}.`,
      data: {
        activity: {
          _id: updated.id,
          name: updated.name,
          status: updated.status,
          isActive: updated.isActive,
          adminNotes: updated.adminNotes,
          oldStatus,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────────────────────────────
// User Management Controllers
// ──────────────────────────────────────────────

// GET /api/admin/users — list all users with role filter, search, pagination
export const listAllUsers = async (
  req: any,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { page = 1, limit = 10, search = "", role = "" } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string, 10) || 10));

    const filter: any = { role: { not: "Admin" } };

    if (role && ["Guest", "Vendor", "Dual Mode"].includes(role as string)) {
      filter.role = role;
    }

    if ((search as string).trim()) {
      filter.OR = [
        { name: { contains: search as string, mode: "insensitive" } },
        { email: { contains: search as string, mode: "insensitive" } },
        { phone: { contains: search as string, mode: "insensitive" } },
      ];
    }

    const total = await prisma.user.count({ where: filter });
    const totalPages = Math.ceil(total / limitNum);
    const skip = (pageNum - 1) * limitNum;

    const rawUsers = await prisma.user.findMany({
      where: filter,
      orderBy: { createdAt: "desc" },
      skip,
      take: limitNum,
    });

    const users = rawUsers.map((user) => {
      const u = { ...user, _id: user.id };
      delete (u as any).password;
      return u;
    });

    res.status(200).json({
      success: true,
      page: pageNum,
      totalPages,
      total,
      results: users.length,
      data: { users },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/admin/users/:userId — get single user detail
export const getUserDetail = async (
  req: any,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      res.status(404).json({ success: false, message: "User not found." });
      return;
    }

    const u = { ...user, _id: user.id };
    delete (u as any).password;

    res.status(200).json({
      success: true,
      data: { user: u },
    });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/admin/users/:userId/toggle-status — block / activate user
export const toggleUserStatus = async (
  req: any,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      res.status(404).json({ success: false, message: "User not found." });
      return;
    }

    if (user.role === "Admin") {
      res.status(403).json({ success: false, message: "Cannot modify admin accounts." });
      return;
    }

    const oldStatus = user.status;
    const newStatus = oldStatus === "Active" ? "Blocked" : "Active";

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { status: newStatus }
    });

    res.status(200).json({
      success: true,
      message: `User ${updated.status === "Blocked" ? "blocked" : "activated"} successfully.`,
      data: {
        userId: updated.id,
        status: updated.status,
        oldStatus,
      },
    });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/admin/users/:userId/wallet — update wallet balance (award coins)
export const updateUserWallet = async (
  req: any,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { userId } = req.params;
    const { amount, reason } = req.body;

    if (typeof amount !== "number" || isNaN(amount)) {
      res.status(400).json({ success: false, message: "A valid numeric amount is required." });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      res.status(404).json({ success: false, message: "User not found." });
      return;
    }

    const oldBalance = user.walletBalance;
    const newBalance = Math.max(0, user.walletBalance + amount);

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { walletBalance: newBalance }
    });

    res.status(200).json({
      success: true,
      message: `Wallet ${amount >= 0 ? "credited" : "debited"} successfully.`,
      data: {
        userId: updated.id,
        walletBalance: updated.walletBalance,
        oldBalance,
        amount,
        reason: reason || (amount >= 0 ? "Admin credit" : "Admin debit"),
      },
    });
  } catch (error) {
    next(error);
  }
};

// ── Delete User ──
export const deleteUser = async (
  req: any,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      res.status(404).json({ success: false, message: "User not found." });
      return;
    }

    if (user.role === "Admin") {
      res.status(403).json({ success: false, message: "Cannot delete admin accounts." });
      return;
    }

    await prisma.user.delete({
      where: { id: userId }
    });

    res.status(200).json({
      success: true,
      message: `User "${user.name}" has been permanently deleted.`,
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── Testimonial Controllers ────────────────────────

/**
 * @desc    Admin — List all testimonials (including inactive)
 * @route   GET /api/admin/testimonials
 * @access  Admin only
 */
export const listTestimonials = async (
  _req: any,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const testimonials = await prisma.testimonial.findMany({
      orderBy: [
        { order: "asc" },
        { createdAt: "desc" }
      ]
    });

    const mapped = testimonials.map(t => ({ ...t, _id: t.id }));

    res.status(200).json({
      status: "success",
      results: mapped.length,
      data: { testimonials: mapped },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Admin — Create a new testimonial
 * @route   POST /api/admin/testimonials
 * @access  Admin only
 */
export const createTestimonial = async (
  req: any,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { name, role, text, image, order, isActive } = req.body;
    const testimonial = await prisma.testimonial.create({
      data: {
        name,
        role,
        text,
        image: image || "",
        order: order !== undefined ? Number(order) : 0,
        isActive: isActive ?? true,
      }
    });

    const mapped = { ...testimonial, _id: testimonial.id };

    res.status(201).json({
      status: "success",
      data: { testimonial: mapped },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Admin — Update a testimonial
 * @route   PUT /api/admin/testimonials/:id
 * @access  Admin only
 */
export const updateTestimonial = async (
  req: any,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, role, text, image, order, isActive } = req.body;

    const testimonial = await prisma.testimonial.findUnique({
      where: { id }
    });
    if (!testimonial) {
      res.status(404).json({ status: "fail", message: "Testimonial not found." });
      return;
    }

    const updated = await prisma.testimonial.update({
      where: { id },
      data: {
        name: name !== undefined ? name : undefined,
        role: role !== undefined ? role : undefined,
        text: text !== undefined ? text : undefined,
        image: image !== undefined ? image : undefined,
        order: order !== undefined ? Number(order) : undefined,
        isActive: isActive !== undefined ? isActive : undefined,
      }
    });

    const mapped = { ...updated, _id: updated.id };

    res.status(200).json({
      status: "success",
      data: { testimonial: mapped },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Admin — Delete a testimonial
 * @route   DELETE /api/admin/testimonials/:id
 * @access  Admin only
 */
export const deleteTestimonial = async (
  req: any,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    const testimonial = await prisma.testimonial.findUnique({
      where: { id }
    });
    if (!testimonial) {
      res.status(404).json({ status: "fail", message: "Testimonial not found." });
      return;
    }

    await prisma.testimonial.delete({
      where: { id }
    });

    res.status(200).json({
      status: "success",
      message: "Testimonial deleted successfully.",
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Public — Get active testimonials (sorted by order)
 * @route   GET /api/testimonials
 * @access  Public
 */
export const getPublicTestimonials = async (
  _req: any,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const testimonials = await prisma.testimonial.findMany({
      where: { isActive: true },
      orderBy: [
        { order: "asc" },
        { createdAt: "desc" }
      ],
      select: {
        id: true,
        name: true,
        role: true,
        text: true,
        image: true,
        order: true,
      }
    });

    const mapped = testimonials.map(t => ({ ...t, _id: t.id }));

    res.status(200).json({
      status: "success",
      results: mapped.length,
      data: { testimonials: mapped },
    });
  } catch (error) {
    next(error);
  }
};