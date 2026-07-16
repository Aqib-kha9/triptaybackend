import { Router } from "express";
import { protect } from "../middlewares/authMiddleware.js";
import {
  getWishlist,
  toggleWishlist,
  checkWishlist,
  removeWishlistItem,
} from "../controllers/wishlistController.js";
import { validate } from "../validators/middleware.js";
import { schemas } from "../validators/schemas.js";

const router = Router();

// All wishlist routes require authentication
router.use(protect as any);

router.get("/", getWishlist as any);
router.post("/toggle", validate(schemas.wishlist.toggle), toggleWishlist as any);
router.post("/check", validate(schemas.wishlist.check), checkWishlist as any);
router.delete("/:itemType/:itemId", removeWishlistItem as any);

export default router;