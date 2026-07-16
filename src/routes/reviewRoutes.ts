import { Router } from "express";
import { protect } from "../middlewares/authMiddleware.js";
import { validate } from "../validators/middleware.js";
import { schemas } from "../validators/schemas.js";
import {
  createReview,
  getMyReviews,
  updateMyReview,
  deleteMyReview,
  getItemReviews,
  getItemRatingSummary,
  replyToReview,
} from "../controllers/reviewController.js";

const router = Router();

// ─── Public routes (no auth) ───

// @desc    Get public reviews for an item
// @route   GET /api/reviews/:itemType/:itemId
router.get("/:itemType/:itemId", getItemReviews);

// @desc    Get rating summary for an item
// @route   GET /api/reviews/:itemType/:itemId/summary
router.get("/:itemType/:itemId/summary", getItemRatingSummary);

// ─── Protected routes (require auth) ───
router.use(protect);

// @desc    Create a review
// @route   POST /api/reviews
router.post("/", validate(schemas.review.create), createReview);

// @desc    Get my reviews
// @route   GET /api/reviews/mine
router.get("/mine", getMyReviews);

// @desc    Update my review
// @route   PATCH /api/reviews/:reviewId
router.patch("/:reviewId", validate(schemas.review.update), updateMyReview);

// @desc    Delete my review
// @route   DELETE /api/reviews/:reviewId
router.delete("/:reviewId", deleteMyReview);

// @desc    Host replies to a review
// @route   POST /api/reviews/:reviewId/reply
router.post("/:reviewId/reply", validate(schemas.review.reply), replyToReview);

export default router;
