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
  listAllActivities,
  getActivityDetail,
  toggleActivityStatus,
  changeActivityStatus,
  listAllUsers,
  getUserDetail,
  toggleUserStatus,
  updateUserWallet,
  deleteUser,
  listTestimonials,
  createTestimonial,
  updateTestimonial,
  deleteTestimonial,
} from "../controllers/adminController.js";
import {
  adminListDestinations,
  createDestination,
  updateDestination,
  deleteDestination,
  uploadDestinationImage,
} from "../controllers/destinationController.js";
import { adminProtect } from "../middlewares/adminMiddleware.js";

const router = Router();

// ── Public: Admin login endpoint ──
router.post("/login", adminLogin);

// ── Protected: Admin session endpoints ──
router.get("/me", adminProtect, adminMe);
router.post("/logout", adminProtect, adminLogout);

// ── Protected: KYC Administration endpoints ──
router.get("/kyc", adminProtect, listKycApplications);
router.patch("/kyc/:userId/approve", adminProtect, approveKyc);
router.patch("/kyc/:userId/reject", adminProtect, rejectKyc);

// ── Protected: Listing / Stays Administration endpoints ──
router.get("/listings", adminProtect, listAllListings);
router.get("/listings/:listingId", adminProtect, getListingDetail);
router.patch("/listings/:listingId/toggle-status", adminProtect, toggleListingStatus);
router.patch("/listings/:listingId/change-status", adminProtect, changeListingStatus);

// ── Protected: Activity Administration endpoints ──
router.get("/activities", adminProtect, listAllActivities);
router.get("/activities/:activityId", adminProtect, getActivityDetail);
router.patch("/activities/:activityId/toggle-status", adminProtect, toggleActivityStatus);
router.patch("/activities/:activityId/change-status", adminProtect, changeActivityStatus);

// ── Protected: User Management endpoints ──
router.get("/users", adminProtect, listAllUsers);
router.get("/users/:userId", adminProtect, getUserDetail);
router.patch("/users/:userId/toggle-status", adminProtect, toggleUserStatus);
router.patch("/users/:userId/wallet", adminProtect, updateUserWallet);
router.delete("/users/:userId", adminProtect, deleteUser);

// ── Protected: Destination Management endpoints ──
router.get("/destinations", adminProtect, adminListDestinations);
router.post("/destinations", adminProtect, createDestination);
router.put("/destinations/:id", adminProtect, updateDestination);
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
router.post("/testimonials", adminProtect, createTestimonial as any);
router.put("/testimonials/:id", adminProtect, updateTestimonial as any);
router.delete("/testimonials/:id", adminProtect, deleteTestimonial as any);

export default router;