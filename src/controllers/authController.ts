import type { Request, Response, NextFunction } from "express";
import * as authService from "../services/auth.service.js";
import { sendTokenCookie, clearTokenCookie } from "../utils/jwt.js";
import { logger } from "../core/logger.js";

// ──────────────────────── Controllers ────────────────────────

// @desc    Register a new standard Guest
// @route   POST /api/auth/signup
// @access  Public
export const signup = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { name, email, password, phone, role } = req.body;

    if (!name || !email || !password) {
      res.status(400).json({ status: "fail", message: "Please supply name, email, and password." });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    const result = await authService.signup({ name, email: cleanEmail, password, phone, role });

    sendTokenCookie(res, result.token);

    res.status(210).json({
      status: "success",
      token: result.token,
      data: {
        user: { ...result.user, _id: result.user.id },
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Login for standard Guest, Vendor, or Superadmin
// @route   POST /api/auth/login
// @access  Public
export const login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ status: "fail", message: "Please supply an email and password." });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    const ip = req.ip || req.socket.remoteAddress || undefined;
    const result = await authService.login(cleanEmail, password, ip);

    sendTokenCookie(res, result.token);

    res.status(200).json({
      status: "success",
      token: result.token,
      data: {
        user: { ...result.user, _id: result.user.id },
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Clear authorization cookies & logout
// @route   POST /api/auth/logout
// @access  Public
export const logout = async (_req: Request, res: Response): Promise<void> => {
  clearTokenCookie(res);

  res.status(200).json({
    status: "success",
    message: "Session ended. Logged out successfully.",
  });
};

// @desc    Retrieve profile session of current active user
// @route   GET /api/auth/me
// @access  Private
export const getMe = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ status: "fail", message: "User session not active." });
      return;
    }

    const user = await authService.getMe(req.user.id);

    res.status(200).json({
      status: "success",
      data: {
        user: { ...user, _id: user.id },
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Generate and send OTP code
// @route   POST /api/auth/send-otp
// @access  Public
export const sendOtp = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { identifier, purpose } = req.body;
    if (!identifier) {
      res.status(400).json({ status: "fail", message: "Please supply an email or phone number." });
      return;
    }

    const cleanId = identifier.trim().toLowerCase();
    const result = await authService.sendOtp(cleanId, purpose || "login");

    res.status(200).json({
      status: "success",
      message: result.message,
      devCode: result.code,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Verify OTP code and either login or signal registration
// @route   POST /api/auth/verify-otp
// @access  Public
export const verifyOtp = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { identifier, code, purpose } = req.body;
    if (!identifier || !code) {
      res.status(400).json({ status: "fail", message: "Please supply identifier and OTP code." });
      return;
    }

    const cleanId = identifier.trim().toLowerCase();
    const result = await authService.verifyOtp(cleanId, code, purpose || "login");

    if (result.exists && result.user && result.token) {
      sendTokenCookie(res, result.token);
      res.status(200).json({
        status: "success",
        token: result.token,
        data: {
          user: { ...result.user, _id: result.user.id },
        },
      });
    } else {
      res.status(200).json({
        status: "success",
        action: "register",
        message: "OTP verified. Proceed to register user.",
      });
    }
  } catch (error) {
    next(error);
  }
};

// @desc    Register a new user from verified OTP session
// @route   POST /api/auth/register-otp
// @access  Public
export const registerOtp = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { name, identifier, role } = req.body;
    if (!name || !identifier) {
      res.status(400).json({ status: "fail", message: "Please supply name and identifier." });
      return;
    }

    const cleanId = identifier.trim().toLowerCase();
    const result = await authService.registerOtpDirect({ name, email: cleanId, role });

    sendTokenCookie(res, result.token);

    res.status(210).json({
      status: "success",
      token: result.token,
      data: {
        user: { ...result.user, _id: result.user.id },
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Submit KYC documents for vendor onboarding
// @route   POST /api/auth/kyc
// @access  Private
export const submitKyc = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { panNumber, gstin, bankAccount, bankIFSC, aadharFront, aadharBack, panCardImage } = req.body;

    if (!panNumber || !gstin || !bankAccount || !bankIFSC) {
      res.status(400).json({
        status: "fail",
        message: "Please supply all KYC fields: panNumber, gstin, bankAccount, bankIFSC.",
      });
      return;
    }

    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ status: "fail", message: "User not authenticated." });
      return;
    }

    const user = await authService.submitKyc(userId, {
      panNumber,
      bankAccount,
      bankIFSC,
      gstin,
      aadharFront,
      aadharBack,
      panCardImage,
    });

    res.status(200).json({
      status: "success",
      message: "KYC documents submitted successfully. Pending admin approval.",
      data: {
        user: { ...user, _id: user.id },
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Google direct authentication without OTP
// @route   POST /api/auth/google-login
// @access  Public
export const googleLogin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, name } = req.body;
    if (!email || !name) {
      res.status(400).json({ status: "fail", message: "Please supply Google email and name." });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    const result = await authService.googleLogin(cleanEmail, name);

    sendTokenCookie(res, result.token);

    res.status(200).json({
      status: "success",
      token: result.token,
      data: {
        user: { ...result.user, _id: result.user.id },
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get full vendor profile including sensitive fields
// @route   GET /api/auth/profile
// @access  Private
export const getProfile = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ status: "fail", message: "User session not active." });
      return;
    }

    const user = await authService.getProfile(req.user.id);

    res.status(200).json({
      status: "success",
      data: {
        user: {
          _id: user.id,
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone || "",
          avatar: user.avatar || "",
          website: user.website || "",
          role: user.role,
          status: user.status,
          kycStatus: user.kycStatus,
          balanceCoins: user.walletBalance,
          panNumber: user.panNumber || "",
          gstin: user.gstin || "",
          bankAccount: user.bankAccount || "",
          bankIFSC: user.bankIFSC || "",
          aadharFront: user.aadharFront || "",
          aadharBack: user.aadharBack || "",
          panCardImage: user.panCardImage || "",
          gender: user.gender || "",
          bio: user.bio || "",
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update vendor profile fields
// @route   PATCH /api/auth/profile
// @access  Private
export const updateProfile = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ status: "fail", message: "User session not active." });
      return;
    }

    const userId = req.user.id;
    const allowedFields = [
      "name", "email", "phone", "avatar", "website",
      "gstin", "panNumber", "bankAccount", "bankIFSC",
      "aadharFront", "aadharBack", "panCardImage",
      "gender", "bio",
    ];

    const updates: Record<string, any> = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ status: "fail", message: "No valid fields provided for update." });
      return;
    }

    const user = await authService.updateProfile(userId, updates);

    res.status(200).json({
      status: "success",
      message: "Profile updated successfully.",
      data: {
        user: {
          _id: user.id,
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone || "",
          avatar: user.avatar || "",
          website: user.website || "",
          role: user.role,
          status: user.status,
          kycStatus: user.kycStatus,
          balanceCoins: user.walletBalance,
          panNumber: user.panNumber || "",
          gstin: user.gstin || "",
          bankAccount: user.bankAccount || "",
          bankIFSC: user.bankIFSC || "",
          aadharFront: user.aadharFront || "",
          aadharBack: user.aadharBack || "",
          panCardImage: user.panCardImage || "",
          gender: user.gender || "",
          bio: user.bio || "",
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Change password for authenticated user
// @route   PATCH /api/auth/change-password
// @access  Private
export const changePassword = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ status: "fail", message: "User session not active." });
      return;
    }

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      res.status(400).json({ status: "fail", message: "Please provide current and new password." });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({ status: "fail", message: "New password must be at least 6 characters." });
      return;
    }

    await authService.changePassword(req.user.id, currentPassword, newPassword);

    res.status(200).json({
      status: "success",
      message: "Password changed successfully.",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Request password reset link via email
// @route   POST /api/auth/forgot-password
// @access  Public
export const forgotPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ status: "fail", message: "Please supply an email address." });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    const ip = req.ip || req.socket.remoteAddress || undefined;
    const result = await authService.forgotPassword(cleanEmail, ip);

    res.status(200).json({
      status: "success",
      message: result.message,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Reset password using token from email link
// @route   POST /api/auth/reset-password
// @access  Public
export const resetPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      res.status(400).json({ status: "fail", message: "Please supply token and new password." });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({ status: "fail", message: "New password must be at least 6 characters." });
      return;
    }

    const ip = req.ip || req.socket.remoteAddress || undefined;
    const result = await authService.resetPassword(token, newPassword, ip);

    res.status(200).json({
      status: "success",
      message: result.message,
    });
  } catch (error) {
    next(error);
  }
};
