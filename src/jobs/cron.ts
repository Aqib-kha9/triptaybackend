import cron from "node-cron";
import { prisma } from "../config/db.js";
import { config } from "../core/config.js";
import { logger } from "../core/logger.js";
import { archiveOldAuditLogs } from "../services/audit.service.js";
import { isRedisAvailable, cacheDelPattern } from "../config/redis.js";
import { executeCampaign } from "../services/campaign.service.js";

// ──────────────────────── Cron Job Scheduler ────────────────────────
// All scheduled tasks are registered here and started on server boot.

/**
 * Archive old audit logs to S3 and delete from database.
 * Runs daily at 2:00 AM IST (system timezone).
 */
cron.schedule("0 2 * * *", async () => {
  try {
    logger.info("[CRON] Starting audit log archival job...");
    const archived = await archiveOldAuditLogs(config.security.auditLogRetentionDays);
    logger.info(`[CRON] Audit log archival complete. Archived ${archived} old logs.`);
  } catch (err) {
    logger.error("[CRON] Audit log archival failed:", err);
  }
});

/**
 * Flush expired Redis cache keys periodically.
 * Runs every hour to clean up stale cache entries.
 */
cron.schedule("0 * * * *", async () => {
  if (!isRedisAvailable()) return;
  try {
    logger.info("[CRON] Running hourly cache cleanup...");
    // Clean up any temporary cache keys with known patterns
    await cacheDelPattern("temp:*");
    await cacheDelPattern("otp:rate:*");
    logger.info("[CRON] Hourly cache cleanup complete.");
  } catch (err) {
    logger.error("[CRON] Cache cleanup failed:", err);
  }
});

/**
 * Mark expired bookings as expired (releases blocked dates).
 * Runs every 5 minutes for fast recovery of abandoned checkouts.
 *
 * This covers BOTH booking types:
 *   - "instant" bookings pending payment (15-min window) — released quickly so
 *     other guests can book the same dates, exactly like Airbnb/Amazon inventory holds.
 *   - "request" bookings awaiting host approval (24-hour window).
 *
 * Any pending booking whose `expiresAt` has passed is marked "expired", which
 * immediately frees its dates for other guests (see checkBookingConflict &
 * getListingAvailability which exclude expired + stale-pending bookings).
 */
cron.schedule("*/5 * * * *", async () => {
  try {
    const now = new Date();
    const result = await prisma.booking.updateMany({
      where: {
        status: "pending",
        expiresAt: { lt: now },
      },
      data: {
        status: "expired",
        paymentStatus: "pending",
        cancelledAt: now,
      },
    });
    if (result.count > 0) {
      logger.info(`[CRON] Expired ${result.count} stale pending bookings (dates released).`);
    }
  } catch (err) {
    logger.error("[CRON] Booking expiry job failed:", err);
  }
});

/**
 * Deactivate expired coupons.
 * Runs daily at midnight.
 */
cron.schedule("0 0 * * *", async () => {
  try {
    const result = await prisma.coupon.updateMany({
      where: {
        isActive: true,
        validUntil: { lt: new Date() },
      },
      data: { isActive: false },
    });
    if (result.count > 0) {
      logger.info(`[CRON] Deactivated ${result.count} expired coupons.`);
    }
  } catch (err) {
    logger.error("[CRON] Coupon deactivation job failed:", err);
  }
});

/**
 * Execute scheduled marketing campaigns.
 * Runs every minute to trigger campaigns scheduled for the current time.
 */
cron.schedule("* * * * *", async () => {
  try {
    const now = new Date();
    const campaignsToRun = await prisma.campaign.findMany({
      where: {
        status: "scheduled",
        scheduledAt: { lte: now },
      },
    });

    for (const campaign of campaignsToRun) {
      logger.info(`[CRON] Starting execution of scheduled campaign: ${campaign.name} (${campaign.id})`);
      executeCampaign(campaign.id, "SYSTEM").catch(err => {
        logger.error(`[CRON] Failed to execute campaign ${campaign.id}:`, err);
      });
    }
  } catch (err) {
    logger.error("[CRON] Scheduled campaigns job failed:", err);
  }
});

logger.info("[CRON] Scheduled jobs registered (audit archival, cache cleanup, booking expiry, coupon deactivation, campaign execution).");

export {};
