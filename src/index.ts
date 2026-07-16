import dotenv from "dotenv";
dotenv.config();

import { createServer } from "http";
import app from "./app.js";
import { connectDB } from "./config/db.js";
import { createSocketServer } from "./socket/handler.js";
import { setSocketIO } from "./socket/emitter.js";
import { config } from "./core/config.js";
import { logger } from "./core/logger.js";

// Initialize scheduled cron jobs (audit archival, cache cleanup, booking expiry, coupon deactivation)
import "./jobs/cron.js";

// Initialize Firebase Cloud Messaging (push notifications)
import { initFirebase } from "./services/push.service.js";

// Seed default platform configurations on first boot
import { seedDefaultConfigurations } from "./services/configuration.service.js";
import { seedDefaultTemplates } from "./services/template.service.js";

// ──────────────────────── Create HTTP Server ────────────────────────

const httpServer = createServer(app);

// ──────────────────────── Socket.IO Setup ────────────────────────

const io = createSocketServer(httpServer);
setSocketIO(io);

// ──────────────────────── Start Server ────────────────────────

const startServer = async () => {
  await connectDB();

  // Initialize Firebase for push notifications
  try {
    initFirebase();
    logger.info("Firebase Cloud Messaging initialized");
  } catch (err) {
    logger.warn("Firebase initialization skipped:", err);
  }

  // Seed default platform configurations (idempotent)
  try {
    await seedDefaultConfigurations();
  } catch (err) {
    logger.warn("Configuration seeding skipped:", err);
  }

  // Seed default templates (idempotent)
  try {
    await seedDefaultTemplates();
  } catch (err) {
    logger.warn("Templates seeding skipped:", err);
  }

  httpServer.listen(config.port, () => {
    logger.info(`Server running in ${config.nodeEnv} mode on port ${config.port}`);
    logger.info("Socket.IO ready for real-time communication");
  });
};

startServer();

export { io };
