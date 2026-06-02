import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { User } from "../models/User.js";
import { Listing } from "../models/Listing.js";
import { Activity } from "../models/Activity.js";

// ──────────────────────── Helper ────────────────────────

const signToken = (id: string, email: string, role: string): string => {
  return jwt.sign(
    { id, email, role },
    process.env.JWT_SECRET || "super_secret_triptay_key_2026",
    { expiresIn: "7d" }
  );
};

const sendTokenResponse = (user: any, statusCode: number, res: Response) => {
  const token = signToken(user._id || user.id, user.email, user.role);

  const cookieOptions = {
    expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
  };

  res.cookie("admin_token", token, cookieOptions);

  const userObj = user.toObject ? user.toObject() : { ...user };
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

    // Find user by email, explicitly include password for comparison
    const user = await User.findOne({ email: email.toLowerCase().trim() }).select(
      "+password"
    );

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
    const isMatch = await user.comparePassword(password);
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
    const admin = await User.findById(req.user._id || req.user.id).select("-password");
    if (!admin) {
      res
        .status(401)
        .json({ status: "fail", message: "Administrator account not found." });
      return;
    }

    res.status(200).json({
      status: "success",
      data: { user: admin },
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
    const query: any = {
      role: { $in: ["Vendor", "Dual Mode"] },
      kycStatus: { $nin: ["Not Submitted"] },
    };

    if (status && ["Pending", "Approved", "Rejected"].includes(status as string)) {
      query.kycStatus = status as string;
    }

    const users = await User.find(query)
      .select("-password -__v")
      .sort({ updatedAt: -1 })
      .lean();

    // Transform to match the admin panel's expected shape
    const applications = users.map((user: any) => ({
      _id: user._id,
      id: user._id,
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

    const user = await User.findById(userId);
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

    user.kycStatus = "Approved";
    // Ensure they have Vendor role for dashboard access
    if (user.role === "Guest") {
      user.role = "Vendor";
    }
    await user.save();

    const userObj = user.toObject();
    delete (userObj as any).password;

    res.status(200).json({
      status: "success",
      message: `${user.name}'s KYC has been approved.`,
      data: {
        application: {
          _id: user._id,
          id: user._id,
          name: user.name,
          email: user.email,
          status: "Approved",
          kycStatus: "Approved",
          role: user.role,
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

    const user = await User.findById(userId);
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

    user.kycStatus = "Rejected";
    await user.save();

    const userObj = user.toObject();
    delete (userObj as any).password;

    res.status(200).json({
      status: "success",
      message: `${user.name}'s KYC has been rejected.`,
      data: {
        application: {
          _id: user._id,
          id: user._id,
          name: user.name,
          email: user.email,
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
    const query: any = {};

    if (status && ["draft", "published", "unlisted", "rejected"].includes(status)) {
      query.status = status;
    }

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.$or = [
        { name: { $regex: escaped, $options: "i" } },
        { city: { $regex: escaped, $options: "i" } },
        { state: { $regex: escaped, $options: "i" } },
      ];
    }

    const total = await Listing.countDocuments(query);
    const listings = await Listing.find(query)
      .populate("host", "name email phone avatar")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

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

    const listing = await Listing.findById(listingId)
      .populate("host", "name email phone avatar role kycStatus")
      .lean();

    if (!listing) {
      res.status(404).json({ status: "fail", message: "Listing not found." });
      return;
    }

    res.status(200).json({
      status: "success",
      data: { listing },
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

    const listing = await Listing.findById(listingId);
    if (!listing) {
      res.status(404).json({ status: "fail", message: "Listing not found." });
      return;
    }

    if (action === "suspend") {
      if (!listing.isActive) {
        res.status(400).json({
          status: "fail",
          message: "Listing is already suspended.",
        });
        return;
      }
      listing.isActive = false;
      if (listing.status === "published") {
        listing.status = "unlisted";
      }
    } else {
      if (listing.isActive) {
        res.status(400).json({
          status: "fail",
          message: "Listing is already active.",
        });
        return;
      }
      listing.isActive = true;
      // Restore status if it was unlisted due to suspension (only if no other reason)
      if (listing.status === "unlisted") {
        listing.status = "published";
      }
    }

    await listing.save();

    res.status(200).json({
      status: "success",
      message:
        action === "suspend"
          ? `"${listing.name}" has been suspended.`
          : `"${listing.name}" has been activated.`,
      data: {
        listing: {
          _id: listing._id,
          name: listing.name,
          status: listing.status,
          isActive: listing.isActive,
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

    const listing = await Listing.findById(listingId);
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
    listing.status = newStatus;

    // Auto-adjust isActive based on status change
    if (newStatus === "published") {
      listing.isActive = true;
    } else if (newStatus === "rejected" || newStatus === "draft") {
      listing.isActive = false;
    }

    if (adminNotes !== undefined) {
      listing.adminNotes = adminNotes?.trim() || undefined;
    }

    await listing.save();

    const statusLabels: Record<string, string> = {
      published: "Published",
      draft: "Moved to Draft",
      rejected: "Rejected",
    };

    res.status(200).json({
      status: "success",
      message: `"${listing.name}" status changed from ${oldStatus} → ${newStatus}.`,
      data: {
        listing: {
          _id: listing._id,
          name: listing.name,
          status: listing.status,
          isActive: listing.isActive,
          adminNotes: listing.adminNotes,
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
    const query: any = {};

    if (status && ["draft", "published", "unlisted", "rejected"].includes(status)) {
      query.status = status;
    }

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.$or = [
        { name: { $regex: escaped, $options: "i" } },
        { city: { $regex: escaped, $options: "i" } },
        { state: { $regex: escaped, $options: "i" } },
      ];
    }

    const total = await Activity.countDocuments(query);
    const activities = await Activity.find(query)
      .populate("host", "name email phone avatar")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

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

    const activity = await Activity.findById(activityId)
      .populate("host", "name email phone avatar role kycStatus")
      .lean();

    if (!activity) {
      res.status(404).json({ status: "fail", message: "Activity not found." });
      return;
    }

    res.status(200).json({
      status: "success",
      data: { activity },
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

    const activity = await Activity.findById(activityId);
    if (!activity) {
      res.status(404).json({ status: "fail", message: "Activity not found." });
      return;
    }

    if (action === "suspend") {
      if (!activity.isActive) {
        res.status(400).json({
          status: "fail",
          message: "Activity is already suspended.",
        });
        return;
      }
      activity.isActive = false;
      if (activity.status === "published") {
        activity.status = "unlisted";
      }
    } else {
      if (activity.isActive) {
        res.status(400).json({
          status: "fail",
          message: "Activity is already active.",
        });
        return;
      }
      activity.isActive = true;
      // Restore status if it was unlisted due to suspension (only if no other reason)
      if (activity.status === "unlisted") {
        activity.status = "published";
      }
    }

    await activity.save();

    res.status(200).json({
      status: "success",
      message:
        action === "suspend"
          ? `"${activity.name}" has been suspended.`
          : `"${activity.name}" has been activated.`,
      data: {
        activity: {
          _id: activity._id,
          name: activity.name,
          status: activity.status,
          isActive: activity.isActive,
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

    const activity = await Activity.findById(activityId);
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
    activity.status = newStatus;

    // Auto-adjust isActive based on status change
    if (newStatus === "published") {
      activity.isActive = true;
    } else if (newStatus === "rejected" || newStatus === "draft") {
      activity.isActive = false;
    }

    if (adminNotes !== undefined) {
      activity.adminNotes = adminNotes?.trim() || undefined;
    }

    await activity.save();

    const statusLabels: Record<string, string> = {
      published: "Published",
      draft: "Moved to Draft",
      rejected: "Rejected",
    };

    res.status(200).json({
      status: "success",
      message: `"${activity.name}" status changed from ${oldStatus} → ${newStatus}.`,
      data: {
        activity: {
          _id: activity._id,
          name: activity.name,
          status: activity.status,
          isActive: activity.isActive,
          adminNotes: activity.adminNotes,
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
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { page = 1, limit = 10, search = "", role = "" } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string, 10) || 10));

    const filter: any = { role: { $ne: "Admin" } };

    if (role && ["Guest", "Vendor", "Dual Mode"].includes(role as string)) {
      filter.role = role;
    }

    if ((search as string).trim()) {
      const term = (search as string).trim();
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { name: { $regex: escaped, $options: "i" } },
        { email: { $regex: escaped, $options: "i" } },
        { phone: { $regex: escaped, $options: "i" } },
      ];
    }

    const total = await User.countDocuments(filter);
    const totalPages = Math.ceil(total / limitNum);
    const skip = (pageNum - 1) * limitNum;

    const users = await User.find(filter)
      .select("-password")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

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
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId).select("-password").lean();

    if (!user) {
      res.status(404).json({ success: false, message: "User not found." });
      return;
    }

    res.status(200).json({
      success: true,
      data: { user },
    });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/admin/users/:userId/toggle-status — block / activate user
export const toggleUserStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);

    if (!user) {
      res.status(404).json({ success: false, message: "User not found." });
      return;
    }

    if (user.role === "Admin") {
      res.status(403).json({ success: false, message: "Cannot modify admin accounts." });
      return;
    }

    const oldStatus = user.status;
    user.status = oldStatus === "Active" ? "Blocked" : "Active";
    await user.save();

    res.status(200).json({
      success: true,
      message: `User ${user.status === "Blocked" ? "blocked" : "activated"} successfully.`,
      data: {
        userId: user._id,
        status: user.status,
        oldStatus,
      },
    });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/admin/users/:userId/wallet — update wallet balance (award coins)
export const updateUserWallet = async (
  req: Request,
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

    const user = await User.findById(userId);

    if (!user) {
      res.status(404).json({ success: false, message: "User not found." });
      return;
    }

    const oldBalance = user.walletBalance;
    user.walletBalance = Math.max(0, user.walletBalance + amount);
    await user.save();

    res.status(200).json({
      success: true,
      message: `Wallet ${amount >= 0 ? "credited" : "debited"} successfully.`,
      data: {
        userId: user._id,
        walletBalance: user.walletBalance,
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
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);

    if (!user) {
      res.status(404).json({ success: false, message: "User not found." });
      return;
    }

    if (user.role === "Admin") {
      res.status(403).json({ success: false, message: "Cannot delete admin accounts." });
      return;
    }

    await User.findByIdAndDelete(userId);

    res.status(200).json({
      success: true,
      message: `User "${user.name}" has been permanently deleted.`,
    });
  } catch (error) {
    next(error);
  }
};