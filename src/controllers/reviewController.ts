import type { Response, NextFunction } from "express";
import * as reviewService from "../services/review.service.js";

// ─── Create a review (user) ───
export const createReview = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { bookingId, rating, title, comment } = req.body;
    const review = await reviewService.createReview(req.user.id, { bookingId, rating, title, comment });
    res.status(201).json({ status: "success", message: "Review submitted successfully. It will be visible after approval.", data: { review } });
  } catch (error) {
    next(error);
  }
};

// ─── Get my reviews (user) ───
export const getMyReviews = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await reviewService.getMyReviews(req.user.id, req.query);
    res.status(200).json({ status: "success", results: result.reviews.length, data: result, pagination: result.pagination });
  } catch (error) {
    next(error);
  }
};

// ─── Update my review (user) ───
export const updateMyReview = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { reviewId } = req.params;
    const { rating, title, comment } = req.body;
    const review = await reviewService.updateMyReview(reviewId, req.user.id, { rating, title, comment });
    res.status(200).json({ status: "success", message: "Review updated successfully.", data: { review } });
  } catch (error) {
    next(error);
  }
};

// ─── Delete my review (user) ───
export const deleteMyReview = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { reviewId } = req.params;
    const result = await reviewService.deleteMyReview(reviewId, req.user.id);
    res.status(200).json({ status: "success", message: "Review deleted successfully.", data: result });
  } catch (error) {
    next(error);
  }
};

// ─── Get public reviews for an item ───
export const getItemReviews = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { itemType, itemId } = req.params;
    const result = await reviewService.getItemReviews(itemType, itemId, req.query);
    res.status(200).json({ status: "success", results: result.reviews.length, data: result, pagination: result.pagination });
  } catch (error) {
    next(error);
  }
};

// ─── Get rating summary for an item ───
export const getItemRatingSummary = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { itemType, itemId } = req.params;
    const summary = await reviewService.getItemRatingSummary(itemType, itemId);
    res.status(200).json({ status: "success", data: summary });
  } catch (error) {
    next(error);
  }
};

// ─── Host replies to a review ───
export const replyToReview = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { reviewId } = req.params;
    const { reply } = req.body;
    const review = await reviewService.replyToReview(reviewId, req.user.id, reply);
    res.status(200).json({ status: "success", message: "Reply added successfully.", data: { review } });
  } catch (error) {
    next(error);
  }
};

// ─── ADMIN: List all reviews ───
export const listAllReviews = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await reviewService.listAllReviews(req.query);
    res.status(200).json({ status: "success", results: result.reviews.length, data: result, pagination: result.pagination });
  } catch (error) {
    next(error);
  }
};

// ─── ADMIN: Approve a review ───
export const approveReview = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { reviewId } = req.params;
    const review = await reviewService.setReviewApproval(reviewId, true, req.admin.id);
    res.status(200).json({ status: "success", message: "Review approved successfully.", data: { review } });
  } catch (error) {
    next(error);
  }
};

// ─── ADMIN: Reject a review ───
export const rejectReview = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { reviewId } = req.params;
    const review = await reviewService.setReviewApproval(reviewId, false, req.admin.id);
    res.status(200).json({ status: "success", message: "Review rejected successfully.", data: { review } });
  } catch (error) {
    next(error);
  }
};

// ─── ADMIN: Delete a review ───
export const deleteReview = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { reviewId } = req.params;
    const result = await reviewService.deleteReview(reviewId, req.admin.id);
    res.status(200).json({ status: "success", message: "Review deleted successfully.", data: result });
  } catch (error) {
    next(error);
  }
};

// ─── ADMIN: Get review statistics ───
export const getReviewStats = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const stats = await reviewService.getReviewStats();
    res.status(200).json({ status: "success", data: stats });
  } catch (error) {
    next(error);
  }
};
