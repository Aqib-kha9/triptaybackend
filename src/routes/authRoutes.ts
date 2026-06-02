import { Router } from "express";
import { signup, login, logout, getMe, getProfile, updateProfile, changePassword, sendOtp, verifyOtp, registerOtp, submitKyc, googleLogin } from "../controllers/authController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = Router();

// Public Authentication endpoints
router.post("/signup", signup);
router.post("/login", login);
router.post("/logout", logout);

// OTP dynamic authentication endpoints
router.post("/send-otp", sendOtp);
router.post("/verify-otp", verifyOtp);
router.post("/register-otp", registerOtp);
router.post("/google-login", googleLogin);

// Protected Authentication endpoints
router.get("/me", protect, getMe);

// Profile management (Protected)
router.get("/profile", protect, getProfile);
router.patch("/profile", protect, updateProfile);
router.patch("/change-password", protect, changePassword);

// KYC submission (Protected)
router.post("/kyc", protect, submitKyc);

export default router;
