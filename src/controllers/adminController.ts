import type { Response, NextFunction } from "express";
import * as adminService from "../services/admin.service.js";
import * as couponService from "../services/coupon.service.js";
import * as commissionService from "../services/commission.service.js";
import * as auditService from "../services/audit.service.js";

// ──────────────────────── Auth ────────────────────────

// @desc    Admin login
// @route   POST /api/admin/login
// @access  Public
export const adminLogin = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password } = req.body;
    const result = await adminService.adminLogin(email, password, res);

    res.status(200).json({
      status: "success",
      token: result.token,
      data: {
        user: result.user,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get current admin
// @route   GET /api/admin/me
// @access  Private (Admin)
export const adminMe = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = await adminService.adminMe(req.user.id);

    res.status(200).json({
      status: "success",
      data: { user },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Admin logout
// @route   POST /api/admin/logout
// @access  Private (Admin)
export const adminLogout = async (_req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    adminService.adminLogout(res);

    res.status(200).json({
      status: "success",
      message: "Logged out successfully.",
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── KYC ────────────────────────

// @desc    List KYC applications
// @route   GET /api/admin/kyc
// @access  Private (Admin)
export const listKycApplications = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { status } = req.query;
    const applications = await adminService.listKycApplications(status);

    res.status(200).json({
      status: "success",
      results: applications.length,
      data: { applications },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Approve KYC application
// @route   PATCH /api/admin/kyc/:userId/approve
// @access  Private (Admin)
export const approveKyc = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await adminService.approveKyc(req.params.userId);

    res.status(200).json({
      status: "success",
      message: "KYC application approved successfully.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Reject KYC application
// @route   PATCH /api/admin/kyc/:userId/reject
// @access  Private (Admin)
export const rejectKyc = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await adminService.rejectKyc(req.params.userId);

    res.status(200).json({
      status: "success",
      message: "KYC application rejected.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── Listings ────────────────────────

// @desc    List all listings (admin)
// @route   GET /api/admin/listings
// @access  Private (Admin)
export const listAllListings = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, limit, search, status } = req.query;
    const result = await adminService.listAllListings({ page, limit, search, status });

    res.status(200).json({
      status: "success",
      results: result.listings.length,
      total: result.total,
      pagination: result.pagination,
      data: {
        listings: result.listings,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get listing detail (admin)
// @route   GET /api/admin/listings/:id
// @access  Private (Admin)
export const getListingDetail = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const listingId = req.params.listingId || req.params.id;
    const result = await adminService.getListingDetail(listingId);

    res.status(200).json({
      status: "success",
      data: {
        listing: result.listing,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Toggle listing status (suspend/activate)
// @route   PATCH /api/admin/listings/:id/toggle
// @access  Private (Admin)
export const toggleListingStatus = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { action } = req.body;
    const result = await adminService.toggleListingStatus(req.params.id, action);

    res.status(200).json({
      status: "success",
      message: action === "suspend" ? "Listing suspended." : "Listing activated.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Change listing status (published/draft/rejected)
// @route   PATCH /api/admin/listings/:id/status
// @access  Private (Admin)
export const changeListingStatus = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { status: newStatus, adminNotes } = req.body;
    const listingId = req.params.listingId || req.params.id;
    const result = await adminService.changeListingStatus(listingId, newStatus, adminNotes);

    const statusMessages: Record<string, string> = {
      published: "Listing published successfully.",
      draft: "Listing moved to draft.",
      rejected: "Listing rejected.",
    };

    res.status(200).json({
      status: "success",
      message: statusMessages[newStatus] || "Listing status updated.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── Activities ────────────────────────

// @desc    List all activities (admin)
// @route   GET /api/admin/activities
// @access  Private (Admin)
export const listAllActivities = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, limit, search, status } = req.query;
    const result = await adminService.listAllActivities({ page, limit, search, status });

    res.status(200).json({
      status: "success",
      results: result.activities.length,
      total: result.total,
      pagination: result.pagination,
      data: {
        activities: result.activities,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get activity detail (admin)
// @route   GET /api/admin/activities/:id
// @access  Private (Admin)
export const getActivityDetail = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await adminService.getActivityDetail(req.params.activityId || req.params.id);

    res.status(200).json({
      status: "success",
      data: {
        activity: result.activity,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Toggle activity status (suspend/activate)
// @route   PATCH /api/admin/activities/:id/toggle
// @access  Private (Admin)
export const toggleActivityStatus = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { action } = req.body;
    const result = await adminService.toggleActivityStatus(req.params.id, action);

    res.status(200).json({
      status: "success",
      message: action === "suspend" ? "Activity suspended." : "Activity activated.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Change activity status (published/draft/rejected)
// @route   PATCH /api/admin/activities/:id/status
// @access  Private (Admin)
export const changeActivityStatus = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { status: newStatus, adminNotes } = req.body;
    const activityId = req.params.activityId || req.params.id;
    const result = await adminService.changeActivityStatus(activityId, newStatus, adminNotes);

    const statusMessages: Record<string, string> = {
      published: "Activity published successfully.",
      draft: "Activity moved to draft.",
      rejected: "Activity rejected.",
    };

    res.status(200).json({
      status: "success",
      message: statusMessages[newStatus] || "Activity status updated.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── Users ────────────────────────

// @desc    List all users (admin)
// @route   GET /api/admin/users
// @access  Private (Admin)
export const listAllUsers = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, limit, search, role } = req.query;
    const result = await adminService.listAllUsers({ page, limit, search, role });

    res.status(200).json({
      status: "success",
      results: result.users.length,
      total: result.total,
      pagination: result.pagination,
      data: {
        users: result.users,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get user detail (admin)
// @route   GET /api/admin/users/:id
// @access  Private (Admin)
export const getUserDetail = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await adminService.getUserDetail(req.params.id);

    res.status(200).json({
      status: "success",
      data: {
        user: result.user,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Toggle user status (block/unblock)
// @route   PATCH /api/admin/users/:id/toggle
// @access  Private (Admin)
export const toggleUserStatus = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await adminService.toggleUserStatus(req.params.id);

    res.status(200).json({
      status: "success",
      message: `User ${result.status === "Blocked" ? "blocked" : "unblocked"} successfully.`,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update user wallet balance
// @route   PATCH /api/admin/users/:id/wallet
// @access  Private (Admin)
export const updateUserWallet = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { amount, reason } = req.body;
    const result = await adminService.updateUserWallet(req.params.id, amount, reason);

    res.status(200).json({
      status: "success",
      message: `Wallet updated by ${amount >= 0 ? "+" : ""}${amount}.`,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete user
// @route   DELETE /api/admin/users/:id
// @access  Private (Admin)
export const deleteUser = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await adminService.deleteUser(req.params.id);

    res.status(200).json({
      status: "success",
      message: `User "${result.name}" deleted successfully.`,
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── Testimonials ────────────────────────

// @desc    List all testimonials (admin)
// @route   GET /api/admin/testimonials
// @access  Private (Admin)
export const listTestimonials = async (_req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const testimonials = await adminService.listTestimonials();

    res.status(200).json({
      status: "success",
      results: testimonials.length,
      data: { testimonials },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create testimonial
// @route   POST /api/admin/testimonials
// @access  Private (Admin)
export const createTestimonial = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const testimonial = await adminService.createTestimonial(req.body);

    res.status(201).json({
      status: "success",
      message: "Testimonial created successfully.",
      data: { testimonial },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update testimonial
// @route   PATCH /api/admin/testimonials/:id
// @access  Private (Admin)
export const updateTestimonial = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const testimonial = await adminService.updateTestimonial(req.params.id, req.body);

    res.status(200).json({
      status: "success",
      message: "Testimonial updated successfully.",
      data: { testimonial },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete testimonial
// @route   DELETE /api/admin/testimonials/:id
// @access  Private (Admin)
export const deleteTestimonial = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    await adminService.deleteTestimonial(req.params.id);

    res.status(200).json({
      status: "success",
      message: "Testimonial deleted successfully.",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get public testimonials
// @route   GET /api/testimonials
// @access  Public
export const getPublicTestimonials = async (_req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const testimonials = await adminService.getPublicTestimonials();

    res.status(200).json({
      status: "success",
      results: testimonials.length,
      data: { testimonials },
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── Dashboard Stats ────────────────────────

// @desc    Get dashboard statistics
// @route   GET /api/admin/dashboard
// @access  Private (Admin)
export const getDashboardStats = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const stats = await adminService.getDashboardStats();

    res.status(200).json({
      status: "success",
      data: stats,
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── Bookings (Admin) ────────────────────────

// @desc    List all bookings (admin)
// @route   GET /api/admin/bookings
// @access  Private (Admin)
export const listAllBookings = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await adminService.listAllBookings(req.query);

    res.status(200).json({
      status: "success",
      results: result.bookings.length,
      data: { bookings: result.bookings },
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get booking detail (admin)
// @route   GET /api/admin/bookings/:bookingId
// @access  Private (Admin)
export const getBookingDetail = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await adminService.getBookingDetail(req.params.bookingId);

    res.status(200).json({
      status: "success",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── Coupons (Admin) ────────────────────────

// @desc    List all coupons (admin)
// @route   GET /api/admin/coupons
// @access  Private (Admin)
export const listAllCoupons = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await adminService.listAllCoupons(req.query);

    res.status(200).json({
      status: "success",
      results: result.coupons.length,
      data: { coupons: result.coupons },
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create coupon (admin)
// @route   POST /api/admin/coupons
// @access  Private (Admin)
export const createCoupon = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const coupon = await couponService.createCoupon(req.body, req.user?.id);

    res.status(201).json({
      status: "success",
      message: "Coupon created successfully.",
      data: { coupon },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update coupon (admin)
// @route   PATCH /api/admin/coupons/:couponId
// @access  Private (Admin)
export const updateCoupon = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const coupon = await couponService.updateCoupon(req.params.couponId, req.body, req.user?.id);

    res.status(200).json({
      status: "success",
      message: "Coupon updated successfully.",
      data: { coupon },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete coupon (admin)
// @route   DELETE /api/admin/coupons/:couponId
// @access  Private (Admin)
export const deleteCoupon = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    await couponService.deleteCoupon(req.params.couponId, req.user?.id);

    res.status(200).json({
      status: "success",
      message: "Coupon deleted successfully.",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get coupon stats (admin)
// @route   GET /api/admin/coupons/:couponId/stats
// @access  Private (Admin)
export const getCouponStats = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const stats = await couponService.getCouponStats(req.params.couponId);

    res.status(200).json({
      status: "success",
      data: stats,
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── Payouts (Admin) ────────────────────────

// @desc    List all payouts (admin)
// @route   GET /api/admin/payouts
// @access  Private (Admin)
export const listAllPayouts = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await adminService.listAllPayouts(req.query);

    res.status(200).json({
      status: "success",
      results: result.payouts.length,
      data: { payouts: result.payouts },
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get commission summary (admin)
// @route   GET /api/admin/commissions/summary
// @access  Private (Admin)
export const getCommissionSummary = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const summary = await commissionService.getCommissionSummary({
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });

    res.status(200).json({
      status: "success",
      data: summary,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Process manual payout (admin)
// @route   POST /api/admin/payouts/process
// @access  Private (Admin)
export const processManualPayout = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { hostId, bookingIds, method } = req.body;
    const result = await commissionService.processPayout(
      hostId,
      bookingIds,
      req.user?.id,
    );

    res.status(200).json({
      status: "success",
      message: "Payout processed successfully.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── Audit Logs (Admin) ────────────────────────

// @desc    List audit logs (admin)
// @route   GET /api/admin/audits
// @access  Private (Admin)
export const listAuditLogs = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await adminService.listAuditLogs(req.query);

    res.status(200).json({
      status: "success",
      results: result.logs.length,
      data: { logs: result.logs },
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Archive old audit logs (admin)
// @route   POST /api/admin/audits/archive
// @access  Private (Admin)
export const archiveAuditLogs = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const daysOld = req.body.daysOld ? Number(req.body.daysOld) : 90;
    const archived = await auditService.archiveOldAuditLogs(daysOld);

    res.status(200).json({
      status: "success",
      message: `Archived ${archived} audit logs older than ${daysOld} days.`,
      data: { archived },
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// @desc    Admin: Update listing details (title, price, status)
// @route   PUT /api/admin/listings/:listingId
// @access  Private (Admin)
export const updateListing = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { listingId } = req.params;
    const { title, price, status } = req.body;
    const result = await adminService.updateListing(listingId, { title, price, status });

    res.status(200).json({
      status: "success",
      message: "Listing updated successfully.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// @desc    Admin: Update user details (name, email, phone, kycStatus)
// @route   PUT /api/admin/users/:userId
// @access  Private (Admin)
export const updateUser = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { userId } = req.params;
    const { name, email, phone, kycStatus } = req.body;
    const result = await adminService.updateUser(userId, { name, email, phone, kycStatus });

    res.status(200).json({
      status: "success",
      message: "User updated successfully.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// @desc    Admin: Cancel a booking and refund to user wallet
// @route   POST /api/admin/bookings/:bookingId/cancel
// @access  Private (Admin)
export const cancelBooking = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { bookingId } = req.params;
    const result = await adminService.adminCancelBooking(bookingId, req.user?.id);

    res.status(200).json({
      status: "success",
      message: "Booking cancelled successfully.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};