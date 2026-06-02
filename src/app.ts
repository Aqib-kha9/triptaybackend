import express from "express";
import type { Request, Response, NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import authRoutes from "./routes/authRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import listingRoutes from "./routes/listingRoutes.js";
import activityRoutes from "./routes/activityRoutes.js";
import availabilityRoutes from "./routes/availabilityRoutes.js";
import chatRoutes from "./routes/chatRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import { browseListings, locationSuggestions, browseNearby, getPublicListing } from "./controllers/listingController.js";
import { browseActivities } from "./controllers/activityController.js";
import destinationRoutes from "./routes/destinationRoutes.js";

const app = express();

// ──────────────────────── Security Middleware ────────────────────────

// 1. HTTP security headers (X-Frame-Options, X-XSS-Protection, CSP, etc.)
app.use(helmet());

// 2. CORS — allow Next.js frontend (3000) and Admin panel (3001)
const allowedOrigins = [
  process.env.CLIENT_URL || "http://localhost:3001",
  "http://localhost:3000",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
    credentials: true,
  })
);

// 3. Body parser (limit payload size to prevent abuse)
app.use(express.json({ limit: "1mb" }));
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
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "fail",
    message: "Too many auth attempts from this IP, please try again after 15 minutes.",
  },
});
app.use("/api/auth", authLimiter);

// 5b. Global API limiter — generous ceiling (500 req / 15 min per IP)
// Authenticated /api/auth/me calls are skipped to avoid counting routine page-navigation checks
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req: Request) => {
    // Don't count /api/auth/me — it's called on every vendor/dashboard page load
    // Token validity is verified inside the controller; rate-limiting here only hurts legitimate users
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

  if (!origin && !referer) {
    return next();
  }

  if (origin && !allowedOrigins.includes(origin)) {
    res
      .status(403)
      .json({ status: "fail", message: "Cross-origin request rejected by CSRF protection." });
    return;
  }

  if (referer && !allowedOrigins.some((allowed) => referer.startsWith(allowed))) {
    res
      .status(403)
      .json({ status: "fail", message: "Cross-origin request rejected by CSRF protection." });
    return;
  }

  next();
});

// ──────────────────────── Routes ────────────────────────

app.use("/api/auth", authRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/admin", adminRoutes);

// Public browse endpoints (no auth required — MUST be registered before respective routers)
app.get("/api/listings/browse", browseListings as any);
app.get("/api/public/listing/:slug", getPublicListing as any);
app.get("/api/activities/browse", browseActivities as any);
app.get("/api/locations/suggest", locationSuggestions as any);
app.get("/api/nearby/browse", browseNearby as any);

// Public destination routes (no auth required)
app.use("/api/destinations", destinationRoutes);

// Protected routes (auth required via router middleware)
app.use("/api/listings", listingRoutes);
app.use("/api/activities", activityRoutes);
app.use("/api/availability", availabilityRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/notifications", notificationRoutes);

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
  const statusCode = err.statusCode || err.status || 500;
  const message =
    statusCode === 500 && process.env.NODE_ENV === "production"
      ? "Internal server error. Please try again later."
      : err.message || "Something went wrong on the server.";

  console.error(`[ERROR] ${statusCode} — ${err.message || "Unknown error"}`);
  if (statusCode === 500) console.error(err.stack);

  res.status(statusCode).json({
    status: "fail",
    message,
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
  });
});

export default app;
