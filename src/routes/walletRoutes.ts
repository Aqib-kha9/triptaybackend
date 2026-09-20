import { Router } from "express";
import { walletController } from "../controllers/walletController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = Router();

// All wallet routes require authentication
router.use(protect);

router.get("/history", walletController.getHistory);
router.post("/create-order", walletController.createOrder);
router.post("/verify", walletController.verifyPayment);

export default router;
