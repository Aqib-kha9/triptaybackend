import { Router } from "express";
import multer from "multer";
import type { Request, Response, NextFunction } from "express";
import {
  adminLogin,
  adminMe,
  adminLogout,
  listKycApplications,
  approveKyc,
  rejectKyc,
  listAllListings,
  getListingDetail,
  toggleListingStatus,
  changeListingStatus,
  updateListing,
  listAllActivities,
  getActivityDetail,
  toggleActivityStatus,
  changeActivityStatus,
  listAllUsers,
  getUserDetail,
  toggleUserStatus,
  updateUserWallet,
  updateUser,
  deleteUser,
  listTestimonials,
  createTestimonial,
  updateTestimonial,
  deleteTestimonial,
  getDashboardStats,
  listAllBookings,
  getBookingDetail,
  cancelBooking,
  listAllCoupons,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  getCouponStats,
  listAllPayouts,
  getCommissionSummary,
  processManualPayout,
  listAuditLogs,
  archiveAuditLogs,
} from "../controllers/adminController.js";
import {
  listAllDisputes,
  getDisputeDetail,
  updateDisputeStatus,
  refundDispute,
  releaseDispute,
  getDisputeStats,
} from "../controllers/disputeController.js";
import {
  createCampaign,
  listAllCampaigns,
  getCampaignDetail,
  updateCampaign,
  deleteCampaign,
  executeCampaign,
  cancelCampaign,
  getCampaignStats,
} from "../controllers/campaignController.js";
import {
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from "../controllers/templateController.js";
import {
  listAllReviews,
  approveReview,
  rejectReview,
  deleteReview,
  getReviewStats,
} from "../controllers/reviewController.js";
import {
  listConfigurations,
  getConfiguration,
  updateConfiguration,
  bulkUpdateConfigurations,
  deleteConfiguration,
  getGatewaySettings,
  testGatewayConnection,
} from "../controllers/configurationController.js";
import {
  adminListDestinations,
  createDestination,
  updateDestination,
  deleteDestination,
  uploadDestinationImage,
} from "../controllers/destinationController.js";
import { adminProtect } from "../middlewares/adminMiddleware.js";
import { validate } from "../validators/middleware.js";
import { schemas } from "../validators/schemas.js";

const router = Router();

// ── Public: Admin login endpoint ──
router.post("/login", validate(schemas.admin.login), adminLogin);

// ── Protected: Admin session endpoints ──
router.get("/me", adminProtect, adminMe);
router.post("/logout", adminProtect, adminLogout);

// ── Protected: KYC Administration endpoints ──
router.get("/kyc", adminProtect, listKycApplications);
router.patch("/kyc/:userId/approve", adminProtect, validate(schemas.admin.approvalNote), approveKyc);
router.patch("/kyc/:userId/reject", adminProtect, validate(schemas.admin.approvalNote), rejectKyc);

// ── Protected: Listing / Stays Administration endpoints ──
router.get("/listings", adminProtect, listAllListings);
router.get("/listings/:listingId", adminProtect, getListingDetail);
router.patch("/listings/:listingId/toggle-status", adminProtect, toggleListingStatus);
router.patch("/listings/:listingId/change-status", adminProtect, validate(schemas.admin.changeStatus), changeListingStatus);
router.put("/listings/:listingId", adminProtect, updateListing);

// ── Protected: Activity Administration endpoints ──
router.get("/activities", adminProtect, listAllActivities);
router.get("/activities/:activityId", adminProtect, getActivityDetail);
router.patch("/activities/:activityId/toggle-status", adminProtect, toggleActivityStatus);
router.patch("/activities/:activityId/change-status", adminProtect, validate(schemas.admin.changeStatus), changeActivityStatus);

// ── Protected: User Management endpoints ──
router.get("/users", adminProtect, listAllUsers);
router.get("/users/:userId", adminProtect, getUserDetail);
router.put("/users/:userId", adminProtect, updateUser);
router.patch("/users/:userId/toggle-status", adminProtect, toggleUserStatus);
router.patch("/users/:userId/wallet", adminProtect, validate(schemas.admin.updateWallet), updateUserWallet);
router.delete("/users/:userId", adminProtect, deleteUser);

// ── Protected: Destination Management endpoints ──
router.get("/destinations", adminProtect, adminListDestinations);
router.post("/destinations", adminProtect, validate(schemas.destination.create), createDestination);
router.put("/destinations/:id", adminProtect, validate(schemas.destination.update), updateDestination);
router.delete("/destinations/:id", adminProtect, deleteDestination);

// ── Destination Image Upload (Multer with memoryStorage) ──
const destinationUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Only JPEG, PNG, and WebP are allowed.`));
    }
  },
});

router.post(
  "/destinations/upload-image",
  adminProtect,
  (req: Request, res: Response, next: NextFunction) => {
    destinationUpload.single("file")(req, res, (err: any) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          return res.status(400).json({ status: "fail", message: `Upload error: ${err.message}` });
        }
        return res.status(400).json({ status: "fail", message: err.message || "File upload failed." });
      }
      next();
    });
  },
  uploadDestinationImage as any
);

// ── Protected: Testimonial Management endpoints ──
router.get("/testimonials", adminProtect, listTestimonials as any);
router.post("/testimonials", adminProtect, validate(schemas.admin.testimonialCreate), createTestimonial as any);
router.put("/testimonials/:id", adminProtect, validate(schemas.admin.testimonialUpdate), updateTestimonial as any);
router.delete("/testimonials/:id", adminProtect, deleteTestimonial as any);

// ── Protected: Dashboard Stats endpoint ──
router.get("/dashboard", adminProtect, getDashboardStats);

// ── Protected: Booking Administration endpoints ──
router.get("/bookings", adminProtect, listAllBookings);
router.get("/bookings/:bookingId", adminProtect, getBookingDetail);
router.post("/bookings/:bookingId/cancel", adminProtect, cancelBooking);

// ── Protected: Coupon Administration endpoints ──
router.get("/coupons", adminProtect, listAllCoupons);
router.post("/coupons", adminProtect, validate(schemas.coupon.create), createCoupon);
router.put("/coupons/:couponId", adminProtect, validate(schemas.coupon.update), updateCoupon);
router.delete("/coupons/:couponId", adminProtect, deleteCoupon);
router.get("/coupons/:couponId/stats", adminProtect, getCouponStats);

// ── Protected: Payout / Commission Administration endpoints ──
router.get("/payouts", adminProtect, listAllPayouts);
router.get("/commissions/summary", adminProtect, getCommissionSummary);
router.post("/payouts/process", adminProtect, validate(schemas.commission.processPayout), processManualPayout);

// ── Protected: Audit Log Administration endpoints ──
router.get("/audits", adminProtect, listAuditLogs);
router.post("/audits/archive", adminProtect, archiveAuditLogs);

// ── Protected: Dispute Resolution endpoints ──
router.get("/disputes", adminProtect, listAllDisputes);
router.get("/disputes/stats", adminProtect, getDisputeStats);
router.get("/disputes/:disputeId", adminProtect, getDisputeDetail);
router.patch("/disputes/:disputeId/status", adminProtect, validate(schemas.dispute.updateStatus), updateDisputeStatus);
router.post("/disputes/:disputeId/refund", adminProtect, refundDispute);
router.post("/disputes/:disputeId/release", adminProtect, releaseDispute);

// ── Protected: Marketing Campaign endpoints ──
router.get("/campaigns", adminProtect, listAllCampaigns);
router.get("/campaigns/stats", adminProtect, getCampaignStats);
router.post("/campaigns", adminProtect, validate(schemas.campaign.create), createCampaign);
router.get("/campaigns/:campaignId", adminProtect, getCampaignDetail);
router.patch("/campaigns/:campaignId", adminProtect, validate(schemas.campaign.update), updateCampaign);
router.delete("/campaigns/:campaignId", adminProtect, deleteCampaign);
router.post("/campaigns/:campaignId/execute", adminProtect, executeCampaign);
router.post("/campaigns/:campaignId/cancel", adminProtect, cancelCampaign);

// ── Protected: Message & Email Templates endpoints ──
router.get("/templates", adminProtect, listTemplates);
router.post("/templates", adminProtect, createTemplate);
router.put("/templates/:id", adminProtect, updateTemplate);
router.delete("/templates/:id", adminProtect, deleteTemplate);

// ── Protected: Review Moderation endpoints ──
router.get("/reviews", adminProtect, listAllReviews);
router.get("/reviews/stats", adminProtect, getReviewStats);
router.post("/reviews/:reviewId/approve", adminProtect, approveReview);
router.post("/reviews/:reviewId/reject", adminProtect, rejectReview);
router.delete("/reviews/:reviewId", adminProtect, deleteReview);

// ── Protected: Configuration Management endpoints ──
router.get("/configurations", adminProtect, listConfigurations);
router.put("/configurations", adminProtect, bulkUpdateConfigurations);
// Gateway settings routes MUST be registered before /:key to avoid path conflict
router.get("/configurations/gateway-settings", adminProtect, getGatewaySettings);
router.post("/configurations/gateway-settings/test", adminProtect, testGatewayConnection);
router.get("/configurations/:key", adminProtect, getConfiguration);
router.put("/configurations/:key", adminProtect, validate(schemas.configuration.update), updateConfiguration);
router.delete("/configurations/:key", adminProtect, deleteConfiguration);

export default router;