import { Router } from "express";
import { signup, login, logout, getMe, getProfile, updateProfile, changePassword, sendOtp, verifyOtp, registerOtp, submitKyc, googleLogin, forgotPassword, resetPassword } from "../controllers/authController.js";
import { protect } from "../middlewares/authMiddleware.js";
import { validate } from "../validators/middleware.js";
import { schemas } from "../validators/schemas.js";

const router = Router();

// Public Authentication endpoints
router.post("/signup", validate(schemas.auth.signup), signup);
router.post("/login", validate(schemas.auth.login), login);
router.post("/logout", logout);

// Password reset (Public)
router.post("/forgot-password", validate(schemas.passwordReset.forgot), forgotPassword);
router.post("/reset-password", validate(schemas.passwordReset.reset), resetPassword);

// OTP dynamic authentication endpoints
router.post("/send-otp", validate(schemas.auth.sendOtp), sendOtp);
router.post("/verify-otp", validate(schemas.auth.verifyOtp), verifyOtp);
router.post("/register-otp", validate(schemas.auth.registerOtp), registerOtp);
router.post("/google-login", validate(schemas.auth.googleLogin), googleLogin);

// Protected Authentication endpoints
router.get("/me", protect, getMe);

// Profile management (Protected)
router.get("/profile", protect, getProfile);
router.patch("/profile", protect, validate(schemas.auth.updateProfile), updateProfile);
router.patch("/change-password", protect, validate(schemas.auth.changePassword), changePassword);

// KYC submission (Protected)
router.post("/kyc", protect, validate(schemas.auth.submitKyc), submitKyc);

export default router;
