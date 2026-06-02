import type { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { User } from "../models/User.js";

interface DecodedToken {
  id: string;
  email: string;
  role: string;
}

// @desc    Global Route Auth Guard Middleware
export const protect = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    let token = "";

    // 1. Resolve token from Authorization Header
    if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
      token = req.headers.authorization.split(" ")[1] || "";
    }
    // 2. Fallback to token cookie
    else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token || token === "loggedout") {
      res.status(401).json({ status: "fail", message: "You are not logged in. Please authenticate." });
      return;
    }

    // Verify token validity
    const decoded = jwt.verify(
      token, 
      process.env.JWT_SECRET || "super_secret_triptay_key_2026"
    ) as DecodedToken;

    // Handle Admin Session Route bypass
    if (decoded.role === "Admin") {
      req.user = {
        id: "ADMIN-000",
        name: "System Superadmin",
        email: process.env.ADMIN_EMAIL || "admin@triptay.com",
        role: "Admin",
        status: "Active",
        walletBalance: 0,
        kycStatus: "Approved"
      };
      next();
      return;
    }

    // Retrieve active standard User from database
    const user = await User.findById(decoded.id);
    if (!user) {
      res.status(401).json({ status: "fail", message: "User session expired or user no longer exists." });
      return;
    }

    // Check blocked status
    if (user.status === "Blocked") {
      res.status(403).json({ status: "fail", message: "Account has been suspended." });
      return;
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ status: "fail", message: "Authentication failed. Invalid token." });
  }
};

// @desc    Role authorization gating
export const restrictTo = (...roles: string[]) => {
  return (req: any, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ 
        status: "fail", 
        message: `Role unauthorized. Required access: [${roles.join(", ")}]. Current role: ${req.user?.role || "none"}` 
      });
      return;
    }
    next();
  };
};
