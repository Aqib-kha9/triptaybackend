import { Router } from "express";
import { protect } from "../middlewares/authMiddleware.js";
import { validate } from "../validators/middleware.js";
import { schemas } from "../validators/schemas.js";
import {
  createDispute,
  getMyDisputes,
} from "../controllers/disputeController.js";

const router = Router();

// All dispute routes require authentication
router.use(protect);

// @desc    Create a dispute (user raises against a booking)
// @route   POST /api/disputes
router.post("/", validate(schemas.dispute.create), createDispute);

// @desc    Get my disputes (user)
// @route   GET /api/disputes/mine
router.get("/mine", getMyDisputes);

export default router;
