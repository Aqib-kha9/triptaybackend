import express from "express";
import type { Request, Response, NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "./core/config.js";
import { AppError } from "./core/errors.js";
import { logger } from "./core/logger.js";

// Routes (controllers still handle logic — to be refactored to thin wrappers)
import authRoutes from "./routes/authRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import listingRoutes from "./routes/listingRoutes.js";
import activityRoutes from "./routes/activityRoutes.js";
import availabilityRoutes from "./routes/availabilityRoutes.js";
import chatRoutes from "./routes/chatRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import wishlistRoutes from "./routes/wishlistRoutes.js";
import destinationRoutes from "./routes/destinationRoutes.js";
import bookingRoutes from "./routes/bookingRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import couponRoutes from "./routes/couponRoutes.js";
import commissionRoutes from "./routes/commissionRoutes.js";
import communicationRoutes from "./routes/communicationRoutes.js";
import disputeRoutes from "./routes/disputeRoutes.js";
import searchRoutes from "./routes/searchRoutes.js";
import reviewRoutes from "./routes/reviewRoutes.js";

// Audit middleware for logging admin/mutation requests
import { auditMiddleware } from "./services/audit.service.js";

// Public browse endpoints (still hitting controllers directly)
import { browseListings, locationSuggestions, browseNearby, getPublicListing, getListingAvailability } from "./controllers/listingController.js";
import { browseActivities, getPublicActivity, getActivityAvailability } from "./controllers/activityController.js";
import { getPublicTestimonials } from "./controllers/adminController.js";
import { getPublicConfigurations } from "./controllers/configurationController.js";
import { seedDefaultConfigurations } from "./services/configuration.service.js";

const app = express();

// Trust the reverse proxy (Render sets X-Forwarded-For, X-Forwarded-Proto)
app.set("trust proxy", 1);

// ──────────────────────── Security Middleware ────────────────────────

// 1. HTTP security headers
app.use(helmet());

// 2. CORS — allow Next.js frontend and Admin panel (dev + production)
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, server-to-server)
      if (!origin) {
        callback(null, true);
        return;
      }
      // Allow any vercel.app subdomain (for preview deployments)
      if (origin.endsWith(".vercel.app")) {
        callback(null, true);
        return;
      }
      if (config.cors.allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
    credentials: true,
  }),
);

// 3. Body parser (limit payload size to prevent abuse)
// express.json() for JSON payloads; express.urlencoded() for form-urlencoded payloads (PayU webhooks)
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser());

// 4. NoSQL injection prevention
const sanitizeDeep = (obj: any): any => {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeDeep);
  const cleaned: Record<string, any> = {};
  for (const [key, val] of Object.entries(obj)) {
    const safeKey = key.replace(/^\$/, "").replace(/\./g, "");
    cleaned[safeKey] = sanitizeDeep(val);
  }
  return cleaned;
};

app.use("/api/", (req: Request, _res: Response, next: NextFunction) => {
  if (req.body) req.body = sanitizeDeep(req.body);
  if (req.params) req.params = sanitizeDeep(req.params) as Record<string, string>;
  next();
});

// 5. Rate limiters — layered approach
// 5a. Auth rate limiter (stricter, protects login/OTP from brute force)
const authLimiter = rateLimit({
  windowMs: config.rateLimit.auth.windowMs,
  max: config.rateLimit.auth.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "fail",
    message: "Too many auth attempts from this IP, please try again after 15 minutes.",
  },
});
app.use("/api/auth", authLimiter);

// 5b. Global API limiter
const globalLimiter = rateLimit({
  windowMs: config.rateLimit.global.windowMs,
  max: config.rateLimit.global.max,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req: Request) => {
    return req.method === "GET" && req.path === "/auth/me";
  },
  message: {
    status: "fail",
    message: "Too many requests from this IP, please try again after 15 minutes.",
  },
});
app.use("/api/", globalLimiter);

// 6. CSRF protection via Origin/Referer header validation
app.use("/api/", (req: Request, res: Response, next) => {
  const safeMethods = ["GET", "HEAD", "OPTIONS"];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  const origin = req.headers.origin;
  const referer = req.headers.referer;

  // Allow requests with no origin/referer (mobile apps, server-to-server, curl)
  if (!origin && !referer) {
    return next();
  }

  const isOriginAllowed = (o: string): boolean => {
    if (config.cors.allowedOrigins.includes(o)) return true;
    if (o.endsWith(".vercel.app")) return true;
    return false;
  };

  if (origin && !isOriginAllowed(origin)) {
    res.status(403).json({
      status: "fail",
      message: "Cross-origin request rejected by CSRF protection.",
    });
    return;
  }

  if (
    referer &&
    !config.cors.allowedOrigins.some((allowed) => referer.startsWith(allowed)) &&
    !referer.includes(".vercel.app")
  ) {
    res.status(403).json({
      status: "fail",
      message: "Cross-origin request rejected by CSRF protection.",
    });
    return;
  }

  next();
});

// ──────────────────────── Routes ────────────────────────

// Audit middleware — logs all mutation requests (POST/PUT/PATCH/DELETE) to AuditLog table
app.use("/api/", auditMiddleware);

app.use("/api/auth", authRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/admin", adminRoutes);

// Public browse endpoints (no auth required — MUST be registered before respective routers)
app.get("/api/listings/browse", browseListings as any);
app.get("/api/public/listing/:slug", getPublicListing as any);
app.get("/api/public/listings/:id/availability", getListingAvailability as any);
app.get("/api/activities/browse", browseActivities as any);
app.get("/api/public/activity/:slug", getPublicActivity as any);
app.get("/api/public/activities/:id/availability", getActivityAvailability as any);
app.get("/api/locations/suggest", locationSuggestions as any);
app.get("/api/nearby/browse", browseNearby as any);
app.get("/api/testimonials", getPublicTestimonials as any);
app.get("/api/public/configurations", getPublicConfigurations as any);

// Public destination routes (no auth required)
app.use("/api/destinations", destinationRoutes);

// Protected routes (auth required via router middleware)
app.use("/api/listings", listingRoutes);
app.use("/api/activities", activityRoutes);
app.use("/api/availability", availabilityRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/wishlist", wishlistRoutes);

// Phase 1: Core Revenue Engine routes
app.use("/api/bookings", bookingRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/coupons", couponRoutes);
app.use("/api/commission", commissionRoutes);

// Phase 3: Communication Layer routes (email, WhatsApp, push, marketing)
app.use("/api/communications", communicationRoutes);

// Phase 5: Dispute Resolution routes (user-facing)
app.use("/api/disputes", disputeRoutes);

// Phase 5: Search Optimization routes (public)
app.use("/api/search", searchRoutes);

// Phase 5: Review routes (public read + protected write)
app.use("/api/reviews", reviewRoutes);

// Health check endpoint
app.get("/api/health", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "success",
    message: "Triptay operational control backend active.",
    timestamp: new Date().toISOString(),
  });
});

// ──────────────────────── Global Error Handler ────────────────────────

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  // Handle AppError instances (our custom errors)
  if (err instanceof AppError) {
    logger.warn(`[${err.statusCode}] ${err.message}`);
    return res.status(err.statusCode).json({
      status: "fail",
      message: err.message,
    });
  }

  // Handle Prisma known errors
  if (err.code === "P2002") {
    return res.status(409).json({
      status: "fail",
      message: "A record with that value already exists.",
    });
  }

  if (err.code === "P2025") {
    return res.status(404).json({
      status: "fail",
      message: "Record not found.",
    });
  }

  // JWT errors
  if (err.name === "JsonWebTokenError") {
    return res.status(401).json({
      status: "fail",
      message: "Invalid token. Please log in again.",
    });
  }

  if (err.name === "TokenExpiredError") {
    return res.status(401).json({
      status: "fail",
      message: "Your token has expired. Please log in again.",
    });
  }

  // Multer file size error
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({
      status: "fail",
      message: "File too large. Maximum size is 10MB.",
    });
  }

  // Generic / unknown error
  const statusCode = err.statusCode || err.status || 500;
  const message =
    statusCode === 500 && config.isProduction
      ? "Internal server error. Please try again later."
      : err.message || "Something went wrong on the server.";

  logger.error(`[${statusCode}] ${err.message || "Unknown error"}`, {
    stack: err.stack,
  });

  res.status(statusCode).json({
    status: "fail",
    message,
    ...(config.nodeEnv !== "production" && { stack: err.stack }),
  });
});

export default app;
