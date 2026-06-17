import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { prisma } from "../config/db.js";

// ──────────────────────── Helpers ────────────────────────

// Safe public fields to include in all auth responses.
// NEVER add: password, bankAccount, bankIFSC, panNumber, gstin,
//            aadharFront, aadharBack, panCardImage.
const SAFE_USER_FIELDS = [
  "id",
  "name",
  "email",
  "phone",
  "avatar",
  "website",
  "role",
  "status",
  "kycStatus",
  "walletBalance",
  "createdAt",
  "updatedAt",
] as const;

/** Picks only safe, public-facing fields from a user document or plain object. */
function sanitizeUserResponse(raw: any) {
  const safe: Record<string, any> = {};
  for (const key of SAFE_USER_FIELDS) {
    if (raw[key] !== undefined) {
      safe[key] = raw[key];
    }
  }
  // Map 'id' to '_id' for frontend compatibility if needed
  safe._id = raw.id;
  return safe;
}

// Helper to sign JWT token
const signToken = (id: string, email: string, role: string): string => {
  return jwt.sign(
    { id, email, role },
    process.env.JWT_SECRET || "super_secret_triptay_key_2026",
    { expiresIn: "7d" }
  );
};

// Helper to configure cookie and send sanitized JSON payload
const sendTokenResponse = (user: any, statusCode: number, res: Response) => {
  const token = signToken(user.id, user.email, user.role);

  const cookieOptions = {
    expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
  };

  res.cookie("token", token, cookieOptions);

  // Return ONLY safe public fields — no password, bank details, or document URLs
  const safeUser = sanitizeUserResponse(user);

  res.status(statusCode).json({
    status: "success",
    token,
    data: {
      user: safeUser,
    },
  });
};

// ──────────────────────── Controllers ────────────────────────

// @desc    Register a new standard Guest
// @route   POST /api/auth/signup
// @access  Public
export const signup = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { name, email, password, phone, role } = req.body;

    const cleanEmail = email.trim().toLowerCase();

    // Check if email already registered
    const existingUser = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (existingUser) {
      res.status(400).json({ status: "fail", message: "Email is already registered." });
      return;
    }

    // Map role string safely
    let resolvedRole = "Guest";
    if (role) {
      const lower = role.toLowerCase();
      if (lower === "vendor") resolvedRole = "Vendor";
      else if (lower === "dual mode") resolvedRole = "Dual Mode";
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create standard user with resolved role
    const user = await prisma.user.create({
      data: {
        name,
        email: cleanEmail,
        password: hashedPassword,
        phone: phone || null,
        role: resolvedRole,
      },
    });

    sendTokenResponse(user, 210, res);
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

    // 1. Hook for Superadmin Login
    const adminEmail = process.env.ADMIN_EMAIL || "admin@triptay.com";
    const adminPassword = process.env.ADMIN_PASSWORD || "admin_triptay_2026_pass";

    if (cleanEmail === adminEmail.toLowerCase()) {
      if (password === adminPassword) {
        // Authenticated Superadmin session — use safe fields only
        const adminUser = {
          id: "ADMIN-000",
          name: "System Superadmin",
          email: adminEmail,
          role: "Admin",
          status: "Active",
          kycStatus: "Approved",
          walletBalance: 0,
        };
        sendTokenResponse(adminUser, 200, res);
        return;
      } else {
        res.status(401).json({ status: "fail", message: "Invalid Superadmin credentials." });
        return;
      }
    }

    // 2. Query standard users in DB
    const user = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (!user) {
      res.status(401).json({ status: "fail", message: "Invalid email or password." });
      return;
    }

    // Verify Password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      res.status(401).json({ status: "fail", message: "Invalid email or password." });
      return;
    }

    // Check account status
    if (user.status === "Blocked") {
      res.status(403).json({ status: "fail", message: "This account has been suspended by administrators." });
      return;
    }

    sendTokenResponse(user, 200, res);
  } catch (error) {
    next(error);
  }
};

// @desc    Clear authorization cookies & logout
// @route   POST /api/auth/logout
// @access  Public
export const logout = async (_req: Request, res: Response): Promise<void> => {
  res.cookie("token", "loggedout", {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true,
  });

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

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) {
      res.status(401).json({ status: "fail", message: "User account not found." });
      return;
    }

    res.status(200).json({
      status: "success",
      data: {
        user: sanitizeUserResponse(user),
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
    const { identifier } = req.body;
    if (!identifier) {
      res.status(400).json({ status: "fail", message: "Please supply an email or phone number." });
      return;
    }

    const cleanId = identifier.trim().toLowerCase();

    // Generate 6-digit numeric OTP
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // Delete any existing OTP records for this identifier (ensures uniqueness)
    await prisma.otp.deleteMany({ where: { identifier: cleanId } });

    // Create a new OTP record expiring in 10 minutes
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await prisma.otp.create({
      data: {
        identifier: cleanId,
        code,
        expiresAt,
      },
    });

    console.log(`[OTP] ${cleanId} → ${code}`);

    res.status(200).json({
      status: "success",
      message: `OTP sent to ${cleanId}.`,
      devCode: code,
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
    const { identifier, code } = req.body;
    if (!identifier || !code) {
      res.status(400).json({ status: "fail", message: "Please supply identifier and OTP code." });
      return;
    }

    const cleanId = identifier.trim().toLowerCase();
    const otpRecord = await prisma.otp.findFirst({
      where: {
        identifier: cleanId,
        code,
        expiresAt: { gt: new Date() },
      },
    });

    if (!otpRecord) {
      res.status(400).json({ status: "fail", message: "Invalid or expired verification code." });
      return;
    }

    // OTP is single-use — delete after successful verification
    await prisma.otp.delete({ where: { id: otpRecord.id } });

    const user = await prisma.user.findUnique({ where: { email: cleanId } });
    if (user) {
      if (user.status === "Blocked") {
        res.status(403).json({ status: "fail", message: "This account has been suspended by administrators." });
        return;
      }

      sendTokenResponse(user, 200, res);
    } else {
      // User does not exist → Tell frontend to complete profile registration
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

    // Double check if email already registered
    const existingUser = await prisma.user.findUnique({ where: { email: cleanId } });
    if (existingUser) {
      res.status(400).json({ status: "fail", message: "Email/Identifier is already registered." });
      return;
    }

    // Map role safely
    let resolvedRole = "Guest";
    if (role) {
      const lower = role.toLowerCase();
      if (lower === "vendor") resolvedRole = "Vendor";
      else if (lower === "dual mode") resolvedRole = "Dual Mode";
    }

    // Generate a secure random password since schema requires password
    const randomPassword = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(randomPassword, salt);

    // Create new user profile in DB
    const user = await prisma.user.create({
      data: {
        name,
        email: cleanId,
        password: hashedPassword,
        phone: cleanId.match(/^\d+$/) ? cleanId : null,
        role: resolvedRole,
        status: "Active",
        kycStatus: "Not Submitted",
      },
    });

    sendTokenResponse(user, 210, res);
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

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({ status: "fail", message: "User not found." });
      return;
    }

    // Update KYC fields and set status to "Pending" for admin review
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        panNumber,
        gstin,
        bankAccount,
        bankIFSC,
        aadharFront: aadharFront || user.aadharFront,
        aadharBack: aadharBack || user.aadharBack,
        panCardImage: panCardImage || user.panCardImage,
        kycStatus: "Pending",
      },
    });

    res.status(200).json({
      status: "success",
      message: "KYC documents submitted successfully. Pending admin approval.",
      data: {
        user: sanitizeUserResponse(updatedUser),
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

    let user = await prisma.user.findUnique({ where: { email: cleanEmail } });

    if (user) {
      if (user.status === "Blocked") {
        res.status(403).json({ status: "fail", message: "This account has been suspended by administrators." });
        return;
      }
    } else {
      // Register new user automatically
      const randomPassword = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(randomPassword, salt);

      user = await prisma.user.create({
        data: {
          name,
          email: cleanEmail,
          password: hashedPassword,
          role: "Guest",
          status: "Active",
        },
      });
    }

    sendTokenResponse(user, 200, res);
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

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) {
      res.status(404).json({ status: "fail", message: "User not found." });
      return;
    }

    // Return full profile including sensitive fields for the owner
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
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({ status: "fail", message: "User not found." });
      return;
    }

    const allowedFields = [
      "name",
      "phone",
      "avatar",
      "website",
      "gstin",
      "panNumber",
      "bankAccount",
      "bankIFSC",
      "aadharFront",
      "aadharBack",
      "panCardImage",
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

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updates,
    });

    res.status(200).json({
      status: "success",
      message: "Profile updated successfully.",
      data: {
        user: {
          _id: updatedUser.id,
          id: updatedUser.id,
          name: updatedUser.name,
          email: updatedUser.email,
          phone: updatedUser.phone || "",
          avatar: updatedUser.avatar || "",
          website: updatedUser.website || "",
          role: updatedUser.role,
          status: updatedUser.status,
          kycStatus: updatedUser.kycStatus,
          balanceCoins: updatedUser.walletBalance,
          panNumber: updatedUser.panNumber || "",
          gstin: updatedUser.gstin || "",
          bankAccount: updatedUser.bankAccount || "",
          bankIFSC: updatedUser.bankIFSC || "",
          aadharFront: updatedUser.aadharFront || "",
          aadharBack: updatedUser.aadharBack || "",
          panCardImage: updatedUser.panCardImage || "",
          createdAt: updatedUser.createdAt,
          updatedAt: updatedUser.updatedAt,
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

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) {
      res.status(404).json({ status: "fail", message: "User not found." });
      return;
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      res.status(401).json({ status: "fail", message: "Current password is incorrect." });
      return;
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await prisma.user.update({
      where: { id: req.user.id },
      data: { password: hashedPassword },
    });

    res.status(200).json({
      status: "success",
      message: "Password changed successfully.",
    });
  } catch (error) {
    next(error);
  }
};
