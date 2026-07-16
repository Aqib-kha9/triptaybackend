import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "../config/db.js";
import { signToken } from "../utils/jwt.js";
import { config } from "../core/config.js";
import { BadRequestError, UnauthorizedError, NotFoundError, ConflictError, TooManyRequestsError } from "../core/errors.js";
import { logger } from "../core/logger.js";
import { sendTemplatedEmail } from "./email.service.js";
import { createAuditLog } from "./audit.service.js";

// ─── Types ───
interface SanitizedUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  avatar: string | null;
  website: string | null;
  role: string;
  status: string;
  walletBalance: number;
  kycStatus: string;
  panNumber: string | null;
  gstin: string | null;
  bankAccount: string | null;
  bankIFSC: string | null;
  aadharFront: string | null;
  aadharBack: string | null;
  panCardImage: string | null;
  gender: string | null;
  bio: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function sanitizeUser(raw: any): SanitizedUser {
  return {
    id: raw.id,
    name: raw.name,
    email: raw.email,
    phone: raw.phone ?? null,
    avatar: raw.avatar ?? null,
    website: raw.website ?? null,
    role: raw.role,
    status: raw.status,
    walletBalance: raw.walletBalance,
    kycStatus: raw.kycStatus,
    panNumber: raw.panNumber ?? null,
    gstin: raw.gstin ?? null,
    bankAccount: raw.bankAccount ?? null,
    bankIFSC: raw.bankIFSC ?? null,
    aadharFront: raw.aadharFront ?? null,
    aadharBack: raw.aadharBack ?? null,
    panCardImage: raw.panCardImage ?? null,
    gender: raw.gender ?? null,
    bio: raw.bio ?? null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}


export function normalizeIdentifier(identifier: string): { email: string; phone: string | null } {
  const clean = identifier.trim().toLowerCase();
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean);
  if (isEmail) {
    return { email: clean, phone: null };
  }
  const digitsOnly = clean.replace(/[\s\-\+\(\)]/g, "");
  const isPhone = /^\+?\d{10,15}$/.test(clean.replace(/[\s\-\(\)]/g, ""));
  if (isPhone || /^\d+$/.test(digitsOnly)) {
    return {
      email: `${digitsOnly}@triptay.com`,
      phone: digitsOnly
    };
  }
  return { email: clean, phone: null };
}

// ─── Signup ───
export async function signup(data: {
  name: string;
  email: string;
  password: string;
  phone?: string;
  role?: string;
}) {
  const { email: normalizedEmail, phone: detectedPhone } = normalizeIdentifier(data.email);
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    throw new ConflictError("A user with this email already exists.");
  }

  const hashed = await bcrypt.hash(data.password, 12);
  const user = await prisma.user.create({
    data: {
      name: data.name,
      email: normalizedEmail,
      password: hashed,
      phone: data.phone || detectedPhone || null,
      role: data.role || "Guest",
    },
  });

  const token = signToken({ id: user.id, email: user.email, role: user.role });
  logger.info(`User signed up: ${user.email} (${user.role})`);

  return { user: sanitizeUser(user), token };
}

// ─── Login ───
export async function login(email: string, password: string, ip?: string) {
  const { email: normalizedEmail } = normalizeIdentifier(email);
  // Hardcoded admin check (preserved from original)
  if (normalizedEmail === config.admin.email && password === config.admin.password) {
    let admin = await prisma.user.findFirst({
      where: { email: config.admin.email, role: "Admin" },
    });
    if (!admin) {
      const hashed = await bcrypt.hash(config.admin.password, 12);
      admin = await prisma.user.create({
        data: {
          name: config.admin.name,
          email: config.admin.email,
          password: hashed,
          role: "Admin",
          status: "Active",
        },
      });
    }
    const token = signToken({ id: admin.id, email: admin.email, role: "Admin" });
    return { user: sanitizeUser(admin), token };
  }

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user) {
    throw new UnauthorizedError("Invalid email or password.");
  }

  // ── Check account lockout ──
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const remainingMs = user.lockedUntil.getTime() - Date.now();
    const remainingMin = Math.ceil(remainingMs / (1000 * 60));
    throw new TooManyRequestsError(
      `Account temporarily locked due to too many failed login attempts. Please try again in ${remainingMin} minute(s).`,
    );
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    // ── Track failed login attempt ──
    const failedAttempts = user.failedLoginAttempts + 1;
    const maxFailed = config.security.maxFailedLogins;
    const lockoutMin = config.security.lockoutDurationMinutes;

    if (failedAttempts >= maxFailed) {
      // Lock the account
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: failedAttempts,
          lockedUntil: new Date(Date.now() + lockoutMin * 60 * 1000),
        },
      });

      await createAuditLog({
        actorId: user.id,
        actorEmail: user.email,
        action: "ACCOUNT_LOCKED",
        category: "auth",
        resource: "User",
        resourceId: user.id,
        details: { failedAttempts, ip },
      });

      logger.warn(`Account locked for ${user.email} after ${failedAttempts} failed attempts from IP ${ip}`);
      throw new TooManyRequestsError(
        `Account locked due to ${failedAttempts} failed login attempts. Please try again in ${lockoutMin} minutes.`,
      );
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: failedAttempts },
    });

    const remaining = maxFailed - failedAttempts;
    throw new UnauthorizedError(
      `Invalid email or password. ${remaining} attempt(s) remaining before account lockout.`,
    );
  }

  if (user.status === "Blocked") {
    throw new UnauthorizedError("Your account has been blocked. Please contact support.");
  }

  // ── Reset failed login attempts on successful login ──
  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      lastLoginIp: ip || null,
    },
  });

  const token = signToken({ id: user.id, email: user.email, role: user.role });
  logger.info(`User logged in: ${user.email}`);

  await createAuditLog({
    actorId: user.id,
    actorEmail: user.email,
    actorRole: user.role,
    action: "USER_LOGIN",
    category: "auth",
    resource: "User",
    resourceId: user.id,
    details: { ip },
  });

  return { user: sanitizeUser(user), token };
}

// ─── Get Me ───
export async function getMe(userId: string) {
  // Admin bypass
  if (userId === "admin") {
    return {
      id: "admin",
      name: "Admin",
      email: config.admin.email,
      role: "Admin",
      status: "Active",
    };
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError("User not found.");
  if (user.status === "Blocked") throw new UnauthorizedError("Your account has been blocked.");

  return sanitizeUser(user);
}

// ─── Get Profile ───
export async function getProfile(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError("User not found.");
  return sanitizeUser(user);
}

// ─── Update Profile ───
export async function updateProfile(userId: string, data: {
  name?: string;
  email?: string;
  phone?: string;
  website?: string;
  avatar?: string;
  gstin?: string;
  panNumber?: string;
  bankAccount?: string;
  bankIFSC?: string;
  aadharFront?: string;
  aadharBack?: string;
  panCardImage?: string;
  gender?: string | null;
  bio?: string | null;
}) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError("User not found.");

  if (data.email) {
    const cleanEmail = data.email.trim().toLowerCase();
    const existing = await prisma.user.findFirst({
      where: { email: cleanEmail, id: { not: userId } }
    });
    if (existing) throw new ConflictError("Email already in use by another user.");
    data.email = cleanEmail;
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data,
  });

  return sanitizeUser(updated);
}

// ─── Change Password ───
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError("User not found.");

  const isMatch = await bcrypt.compare(currentPassword, user.password);
  if (!isMatch) throw new BadRequestError("Current password is incorrect.");

  const hashed = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: userId },
    data: { password: hashed },
  });

  return { message: "Password changed successfully." };
}

// ─── Forgot Password (generate reset token + send email link) ───
export async function forgotPassword(email: string, ip?: string) {
  const user = await prisma.user.findUnique({ where: { email } });

  // Always return success to prevent email enumeration
  if (!user) {
    logger.warn(`Password reset requested for non-existent email: ${email}`);
    return { message: "If an account with that email exists, a password reset link has been sent." };
  }

  if (user.status === "Blocked") {
    return { message: "If an account with that email exists, a password reset link has been sent." };
  }

  // Generate a secure random token (32 bytes hex)
  const resetToken = crypto.randomBytes(32).toString("hex");
  const hashedToken = crypto.createHash("sha256").update(resetToken).digest("hex");
  const expiresAt = new Date(Date.now() + config.security.passwordResetExpiryHours * 60 * 60 * 1000);

  // Invalidate any existing reset tokens for this user, then create a new one
  await prisma.passwordReset.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  await prisma.passwordReset.create({
    data: {
      userId: user.id,
      email: user.email,
      token: hashedToken,
      expiresAt,
      ip: ip || null,
    },
  });

  // Build the reset URL and send the email
  const resetUrl = `${config.app.frontendUrl}/reset-password?token=${resetToken}`;
  await sendTemplatedEmail(user.email, "passwordReset", {
    name: user.name,
    resetUrl,
  }).catch((err) => {
    logger.error(`Failed to send password reset email to ${user.email}:`, err);
  });

  await createAuditLog({
    actorId: user.id,
    actorEmail: user.email,
    action: "PASSWORD_RESET_REQUESTED",
    category: "auth",
    resource: "User",
    resourceId: user.id,
    details: { ip },
  });

  logger.info(`Password reset link sent to ${user.email}`);
  return { message: "If an account with that email exists, a password reset link has been sent." };
}

// ─── Reset Password (verify token + set new password) ───
export async function resetPassword(token: string, newPassword: string, ip?: string) {
  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

  const resetRecord = await prisma.passwordReset.findFirst({
    where: { token: hashedToken, usedAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (!resetRecord || resetRecord.expiresAt < new Date()) {
    throw new BadRequestError("Invalid or expired password reset token.");
  }

  const user = await prisma.user.findUnique({ where: { id: resetRecord.userId } });
  if (!user) {
    throw new NotFoundError("User not found.");
  }

  if (user.status === "Blocked") {
    throw new UnauthorizedError("Your account has been blocked. Please contact support.");
  }

  // Hash the new password and update the user
  const hashedPassword = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: hashedPassword,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });

  // Mark the reset token as used
  await prisma.passwordReset.update({
    where: { id: resetRecord.id },
    data: { usedAt: new Date() },
  });

  // Invalidate all other active reset tokens for this user
  await prisma.passwordReset.updateMany({
    where: { userId: user.id, usedAt: null, id: { not: resetRecord.id } },
    data: { usedAt: new Date() },
  });

  await createAuditLog({
    actorId: user.id,
    actorEmail: user.email,
    action: "PASSWORD_RESET_COMPLETED",
    category: "auth",
    resource: "User",
    resourceId: user.id,
    details: { ip },
  });

  logger.info(`Password reset completed for ${user.email}`);
  return { message: "Password has been reset successfully. Please login with your new password." };
}

// ─── OTP (bcrypt-hashed codes) ───
export async function sendOtp(email: string, purpose: string = "login") {
  const { email: normalizedEmail } = normalizeIdentifier(email);
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const hashedCode = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + config.security.otpExpiryMinutes * 60 * 1000);

  // Remove any existing OTP for this identifier+purpose, then store the hashed code
  await prisma.otp.deleteMany({ where: { identifier: normalizedEmail, purpose } });
  await prisma.otp.create({
    data: { identifier: normalizedEmail, code: hashedCode, purpose, expiresAt },
  });

  // Send the plaintext code via email (best-effort, non-blocking on failure)
  // Skip sending actual emails for virtual triptay placeholder emails
  if (!normalizedEmail.endsWith("@triptay.com")) {
    await sendTemplatedEmail(normalizedEmail, "otp", { code, purpose }).catch((err) => {
      logger.error(`Failed to send OTP email to ${normalizedEmail}:`, err);
    });
  } else {
    logger.info(`OTP generated for mobile user: ${normalizedEmail}`);
  }

  logger.info(`OTP sent to ${normalizedEmail} (purpose: ${purpose})`);

  return { message: `OTP sent to ${normalizedEmail}.`, code };
}

export async function verifyOtp(email: string, code: string, purpose: string = "login") {
  const { email: normalizedEmail } = normalizeIdentifier(email);
  // Fetch all active OTPs for this identifier+purpose (hashes can't be queried directly)
  const otps = await prisma.otp.findMany({
    where: { identifier: normalizedEmail, purpose },
    orderBy: { createdAt: "desc" },
  });

  if (otps.length === 0) {
    throw new BadRequestError("Invalid or expired OTP.");
  }

  // Compare the provided code against each stored hash
  let matchedOtp: typeof otps[0] | null = null;
  for (const otp of otps) {
    if (await bcrypt.compare(code, otp.code)) {
      matchedOtp = otp;
      break;
    }
  }

  if (!matchedOtp || matchedOtp.expiresAt < new Date()) {
    const latestOtp = otps[0];
    if (!latestOtp) {
      throw new BadRequestError("Invalid or expired OTP.");
    }

    // Increment attempts on the most recent OTP to enable brute-force protection
    await prisma.otp.update({
      where: { id: latestOtp.id },
      data: { attempts: { increment: 1 } },
    });

    if (latestOtp.attempts + 1 >= config.security.otpMaxAttempts) {
      await prisma.otp.deleteMany({ where: { identifier: normalizedEmail, purpose } });
      throw new TooManyRequestsError("Too many incorrect OTP attempts. Please request a new OTP.");
    }

    throw new BadRequestError("Invalid or expired OTP.");
  }

  // Check if user exists
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  const exists = !!user;

  // Clean up used OTP
  await prisma.otp.deleteMany({ where: { identifier: normalizedEmail, purpose } });

  return {
    message: "OTP verified successfully.",
    exists,
    token: user ? signToken({ id: user.id, email: user.email, role: user.role }) : null,
    user: user ? sanitizeUser(user) : null,
  };
}

export async function registerOtp(data: {
  email: string;
  code: string;
  name: string;
  password: string;
  phone?: string;
  role?: string;
}) {
  const { email: normalizedEmail, phone: detectedPhone } = normalizeIdentifier(data.email);
  // Verify OTP first
  await verifyOtp(data.email, data.code);

  // Check if user already exists
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    throw new ConflictError("User with this email already exists.");
  }

  const hashed = await bcrypt.hash(data.password, 12);
  const user = await prisma.user.create({
    data: {
      name: data.name,
      email: normalizedEmail,
      password: hashed,
      phone: data.phone || detectedPhone || null,
      role: data.role || "Guest",
    },
  });

  const token = signToken({ id: user.id, email: user.email, role: user.role });
  return { user: sanitizeUser(user), token };
}

// Register OTP user without re-verifying OTP (already verified in prior step)
export async function registerOtpDirect(data: {
  email: string;
  name: string;
  phone?: string;
  role?: string;
}) {
  const { email: normalizedEmail, phone: detectedPhone } = normalizeIdentifier(data.email);
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    throw new ConflictError("User with this email already exists.");
  }

  // Generate a secure random password since no password is provided via OTP direct
  const randomPassword = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
  const hashed = await bcrypt.hash(randomPassword, 12);

  const user = await prisma.user.create({
    data: {
      name: data.name,
      email: normalizedEmail,
      password: hashed,
      phone: data.phone || detectedPhone || null,
      role: data.role || "Guest",
      status: "Active",
      kycStatus: "Not Submitted",
    },
  });

  const token = signToken({ id: user.id, email: user.email, role: user.role });
  logger.info(`User registered via OTP: ${user.email}`);
  return { user: sanitizeUser(user), token };
}

// ─── Google Login ───
export async function googleLogin(email: string, name: string) {
  let user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    const randomPassword = await bcrypt.hash(Math.random().toString(36).slice(-8), 12);
    user = await prisma.user.create({
      data: {
        name,
        email,
        password: randomPassword,
        role: "Guest",
      },
    });
    logger.info(`New user via Google: ${email}`);
  }

  if (user.status === "Blocked") {
    throw new UnauthorizedError("Your account has been blocked. Please contact support.");
  }

  const token = signToken({ id: user.id, email: user.email, role: user.role });
  return { user: sanitizeUser(user), token };
}

// ─── KYC ───
export async function submitKyc(userId: string, data: {
  panNumber: string;
  bankAccount: string;
  bankIFSC: string;
  gstin?: string;
  aadharFront?: string;
  aadharBack?: string;
  panCardImage?: string;
}) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError("User not found.");

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      panNumber: data.panNumber,
      bankAccount: data.bankAccount,
      bankIFSC: data.bankIFSC,
      gstin: data.gstin || null,
      aadharFront: data.aadharFront || user.aadharFront,
      aadharBack: data.aadharBack || user.aadharBack,
      panCardImage: data.panCardImage || user.panCardImage,
      kycStatus: "Pending",
    },
  });

  return sanitizeUser(updated);
}