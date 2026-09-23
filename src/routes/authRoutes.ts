import { Router } from "express";
import { signup, login, logout, getMe, getProfile, updateProfile, changePassword, sendOtp, verifyOtp, registerOtp, submitKyc, googleLogin, forgotPassword, resetPassword, sendPhoneUpdateOtp, verifyPhoneUpdateOtp, sendPasswordResetOtp, verifyPasswordResetOtp } from "../controllers/authController.js";
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

// Profile management (protected)
router.get("/profile", protect as any, getProfile as any);
router.patch("/profile", protect as any, validate(schemas.auth.updateProfile), updateProfile as any);
router.post("/send-phone-update-otp", protect as any, sendPhoneUpdateOtp as any);
router.post("/verify-phone-update-otp", protect as any, verifyPhoneUpdateOtp as any);
router.post("/send-password-reset-otp", protect as any, sendPasswordResetOtp as any);
router.post("/verify-password-reset-otp", protect as any, verifyPasswordResetOtp as any);

// Password management
router.patch("/change-password", protect, validate(schemas.auth.changePassword), changePassword);

// KYC submission (Protected)
router.post("/kyc", protect, validate(schemas.auth.submitKyc), submitKyc);

export default router;
