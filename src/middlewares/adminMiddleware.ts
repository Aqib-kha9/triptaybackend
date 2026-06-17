import type { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../config/db.js";

interface DecodedToken {
  id: string;
  email: string;
  role: string;
}

/**
 * @desc    Admin-only auth guard — verifies token AND enforces Admin role
 *          Non-admin tokens are rejected with 403.
 */
export const adminProtect = async (
  req: any,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    let token = "";

    // 1. Extract from Authorization header
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1] || "";
    }
    // 2. Fallback to admin_token cookie
    else if (req.cookies && req.cookies.admin_token) {
      token = req.cookies.admin_token;
    }
    // 3. Also check generic token cookie as fallback
    else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token || token === "loggedout") {
      res
        .status(401)
        .json({
          status: "fail",
          message: "Authentication required. Please log in.",
        });
      return;
    }

    // Verify token
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "super_secret_triptay_key_2026"
    ) as DecodedToken;

    // ── CRITICAL: Enforce Admin role ──
    if (decoded.role !== "Admin") {
      res
        .status(403)
        .json({
          status: "fail",
          message: "Access denied. Administrator privileges required.",
        });
      return;
    }

    // Look up admin in database
    const admin = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!admin) {
      res
        .status(401)
        .json({
          status: "fail",
          message: "Administrator account no longer exists.",
        });
      return;
    }

    if (admin.status === "Blocked") {
      res
        .status(403)
        .json({
          status: "fail",
          message: "Administrator account suspended.",
        });
      return;
    }

    // Exclude password field from req.user
    const sanitizedAdmin = { ...admin };
    delete (sanitizedAdmin as any).password;

    req.user = sanitizedAdmin;
    next();
  } catch (error) {
    res
      .status(401)
      .json({
        status: "fail",
        message: "Session expired or invalid. Please log in again.",
      });
  }
};