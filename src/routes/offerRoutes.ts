import { Router } from "express";
import { offerController } from "../controllers/offerController.js";
import { protect, restrictTo } from "../middlewares/authMiddleware.js";

const router = Router();

// Public routes
router.get("/", offerController.getActiveOffers);

// Admin routes
router.get("/all", protect, restrictTo("Admin"), offerController.getAllOffers);
router.post("/", protect, restrictTo("Admin"), offerController.createOffer);
router.put("/:id", protect, restrictTo("Admin"), offerController.updateOffer);
router.delete("/:id", protect, restrictTo("Admin"), offerController.deleteOffer);

export default router;
