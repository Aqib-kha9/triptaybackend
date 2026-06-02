import { Router } from "express";
import { protect } from "../middlewares/authMiddleware.js";
import {
  getWishlist,
  toggleWishlist,
  checkWishlist,
  removeWishlistItem,
} from "../controllers/wishlistController.js";

const router = Router();

// All wishlist routes require authentication
router.use(protect as any);

router.get("/", getWishlist as any);
router.post("/toggle", toggleWishlist as any);
router.post("/check", checkWishlist as any);
router.delete("/:itemType/:itemId", removeWishlistItem as any);

export default router;