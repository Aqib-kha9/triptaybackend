// ─────────────────────────────────────────────────────────────
//   Configuration Service (Phase 4 — Infrastructure)
//   Manages platform-wide key/value settings stored in the
//   Configuration table (commission rates, GST, payouts, etc.)
// ─────────────────────────────────────────────────────────────

import { prisma } from "../config/db.js";
import { cacheWrap, cacheDelPattern } from "../config/redis.js";
import { AppError } from "../core/errors.js";
import { logger } from "../core/logger.js";

// ─── Types ───────────────────────────────────────────────────

export interface UpdateConfigurationInput {
  value: unknown;
  category?: string;
  description?: string;
  isPublic?: boolean;
}

export interface ConfigurationListQuery {
  category?: string;
  search?: string;
  isPublic?: string;
}

// ─── Default seed values ─────────────────────────────────────
// These are written once (on first request) so the admin panel
// has sensible defaults to display even before any manual edits.

const DEFAULT_CONFIGURATIONS: Array<{
  key: string;
  value: string;
  category: string;
  description: string;
  isPublic: boolean;
}> = [
  {
    key: "commission_rate",
    value: "10",
    category: "commission",
    description: "Platform commission percentage applied to each booking.",
    isPublic: false,
  },
  {
    key: "gst_rate",
    value: "12",
    category: "payment",
    description: "GST percentage applied to booking subtotals.",
    isPublic: true,
  },
  {
    key: "platform_fee_rate",
    value: "5",
    category: "payment",
    description: "Platform fee percentage charged to guests on booking base price.",
    isPublic: true,
  },
  {
    key: "auto_payout_enabled",
    value: "true",
    category: "payment",
    description: "Whether host payouts are processed automatically on booking completion.",
    isPublic: false,
  },
  {
    key: "payout_min_threshold",
    value: "500",
    category: "payment",
    description: "Minimum pending commission amount required before a payout is eligible.",
    isPublic: false,
  },
  {
    key: "rate_limit_global_max",
    value: "300",
    category: "security",
    description: "Maximum global API requests per IP per window.",
    isPublic: false,
  },
  {
    key: "rate_limit_auth_max",
    value: "10",
    category: "security",
    description: "Maximum auth endpoint requests per IP per window.",
    isPublic: false,
  },
  {
    key: "ip_blocklist",
    value: "[]",
    category: "security",
    description: "JSON array of blocked IP addresses.",
    isPublic: false,
  },
  {
    key: "booking_expiry_minutes",
    value: "30",
    category: "general",
    description: "Minutes before a pending booking auto-expires if unpaid.",
    isPublic: false,
  },
  {
    key: "maintenance_mode",
    value: "false",
    category: "general",
    description: "When true, the platform rejects non-admin write requests.",
    isPublic: true,
  },

  // ─── Razorpay Gateway Settings ───
  {
    key: "razorpay_enabled",
    value: "true",
    category: "payment_gateway",
    description: "Enable/disable Razorpay as an available payment method at checkout.",
    isPublic: true,
  },
  {
    key: "razorpay_live_mode",
    value: "false",
    category: "payment_gateway",
    description: "When true, uses live production keys. When false, uses test/sandbox keys.",
    isPublic: false,
  },
  {
    key: "razorpay_key_id",
    value: process.env.RAZORPAY_KEY_ID || "",
    category: "payment_gateway",
    description: "Razorpay API Key ID (public identifier).",
    isPublic: false,
  },
  {
    key: "razorpay_key_secret",
    value: process.env.RAZORPAY_KEY_SECRET || "",
    category: "payment_gateway",
    description: "Razorpay API Key Secret (sensitive — never expose to frontend).",
    isPublic: false,
  },
  {
    key: "razorpay_webhook_secret",
    value: process.env.RAZORPAY_WEBHOOK_SECRET || "",
    category: "payment_gateway",
    description: "Razorpay webhook signing secret for verifying webhook payloads.",
    isPublic: false,
  },
  {
    key: "razorpay_test_key_id",
    value: process.env.RAZORPAY_TEST_KEY_ID || "",
    category: "payment_gateway",
    description: "Razorpay Test/Sandbox API Key ID.",
    isPublic: false,
  },
  {
    key: "razorpay_test_key_secret",
    value: process.env.RAZORPAY_TEST_KEY_SECRET || "",
    category: "payment_gateway",
    description: "Razorpay Test/Sandbox API Key Secret.",
    isPublic: false,
  },
  {
    key: "razorpay_account_id",
    value: "",
    category: "payment_gateway",
    description: "Razorpay Account ID (X-Account-ID for Route / multi-merchant).",
    isPublic: false,
  },
  {
    key: "razorpay_webhook_url",
    value: "",
    category: "payment_gateway",
    description: "Configured Razorpay webhook endpoint URL (informational).",
    isPublic: false,
  },

  // ─── PayU Gateway Settings ───
  {
    key: "payu_enabled",
    value: "true",
    category: "payment_gateway",
    description: "Enable/disable PayU as an available payment method at checkout.",
    isPublic: true,
  },
  {
    key: "payu_live_mode",
    value: process.env.PAYU_ENV === "PRODUCTION" ? "true" : "false",
    category: "payment_gateway",
    description: "When true, uses live production environment. When false, uses test environment.",
    isPublic: false,
  },
  {
    key: "payu_merchant_id",
    value: process.env.PAYU_MERCHANT_ID || "",
    category: "payment_gateway",
    description: "PayU Merchant ID (MID).",
    isPublic: false,
  },
  {
    key: "payu_key",
    value: process.env.PAYU_KEY || "",
    category: "payment_gateway",
    description: "PayU Merchant Key (public identifier for hash generation).",
    isPublic: false,
  },
  {
    key: "payu_salt",
    value: process.env.PAYU_SALT || "",
    category: "payment_gateway",
    description: "PayU Merchant Salt (sensitive — used for hash verification).",
    isPublic: false,
  },
  {
    key: "payu_webhook_salt",
    value: process.env.PAYU_WEBHOOK_SALT || "",
    category: "payment_gateway",
    description: "PayU Webhook Salt (separate salt for webhook verification).",
    isPublic: false,
  },
  {
    key: "payu_base_url",
    value: process.env.PAYU_BASE_URL || (process.env.NODE_ENV === "production" ? "https://secure.payu.in" : "https://test.payu.in"),
    category: "payment_gateway",
    description: "PayU API base URL (test: https://test.payu.in | production: https://secure.payu.in).",
    isPublic: false,
  },
  {
    key: "payu_payment_handle_url",
    value: process.env.PAYU_PAYMENT_HANDLE_URL || "",
    category: "payment_gateway",
    description: "PayU Payment Handle URL (e.g. https://u.payu.in/WrmptyxGODNH).",
    isPublic: false,
  },
  {
    key: "payu_success_url",
    value: process.env.PAYU_SUCCESS_URL || `${process.env.FRONTEND_URL || "http://localhost:3000"}/checkout/payu/success`,
    category: "payment_gateway",
    description: "PayU success callback URL (surl) — where PayU redirects on success.",
    isPublic: false,
  },
  {
    key: "payu_failure_url",
    value: process.env.PAYU_FAILURE_URL || `${process.env.FRONTEND_URL || "http://localhost:3000"}/checkout/payu/failure`,
    category: "payment_gateway",
    description: "PayU failure callback URL (furl) — where PayU redirects on failure.",
    isPublic: false,
  },
  {
    key: "payu_test_merchant_id",
    value: "",
    category: "payment_gateway",
    description: "PayU Test Environment Merchant ID (MID).",
    isPublic: false,
  },
  {
    key: "payu_test_key",
    value: "",
    category: "payment_gateway",
    description: "PayU Test Environment Merchant Key.",
    isPublic: false,
  },
  {
    key: "payu_test_salt",
    value: "",
    category: "payment_gateway",
    description: "PayU Test Environment Merchant Salt.",
    isPublic: false,
  },

  // ─── Default Gateway Selection ───
  {
    key: "default_payment_gateway",
    value: "razorpay",
    category: "payment_gateway",
    description: "Default gateway shown first at checkout (razorpay | payu).",
    isPublic: true,
  },
  {
    key: "payment_gateway_fallback_enabled",
    value: "true",
    category: "payment_gateway",
    description: "When true, checkout automatically falls back to next enabled gateway if primary fails.",
    isPublic: false,
  },

  // ─── Cancellation Policy Settings ───
  {
    key: "cancellation_default_policy",
    value: "Moderate",
    category: "cancellation",
    description: "Global default cancellation policy applied to all listings/activities when vendor override is disabled or no policy is set (Flexible | Moderate | Strict | Non-Refundable).",
    isPublic: true,
  },
  {
    key: "cancellation_vendor_override_enabled",
    value: "true",
    category: "cancellation",
    description: "When true, vendors can set their own cancellation policy per listing/activity. When false, all listings use the global default policy.",
    isPublic: true,
  },
  {
    key: "cancellation_flexible_full_refund_hours",
    value: "24",
    category: "cancellation",
    description: "Hours before check-in for full refund under Flexible policy. Within this window = 50% refund.",
    isPublic: false,
  },
  {
    key: "cancellation_moderate_full_refund_hours",
    value: "120",
    category: "cancellation",
    description: "Hours before check-in (5 days) for full refund under Moderate policy.",
    isPublic: false,
  },
  {
    key: "cancellation_moderate_partial_refund_hours",
    value: "48",
    category: "cancellation",
    description: "Hours before check-in (2 days) for 50% refund under Moderate policy. Within this window = no refund.",
    isPublic: false,
  },
  {
    key: "cancellation_strict_partial_refund_hours",
    value: "168",
    category: "cancellation",
    description: "Hours before check-in (7 days) for 50% refund under Strict policy. Within this window = no refund.",
    isPublic: false,
  },

  // ─── AWS SES (Email) Configuration Settings ───
  {
    key: "ses_region",
    value: process.env.AWS_SES_REGION || process.env.AWS_REGION || "ap-south-1",
    category: "email_gateway",
    description: "AWS SES regional endpoint domain (e.g. ap-south-1).",
    isPublic: false,
  },
  {
    key: "ses_from_email",
    value: process.env.SES_FROM_EMAIL || "no-reply@triptay.com",
    category: "email_gateway",
    description: "Verified AWS SES sender/bounce email address.",
    isPublic: false,
  },
  {
    key: "ses_from_name",
    value: process.env.SES_FROM_NAME || "Triptay",
    category: "email_gateway",
    description: "Display name shown in user inboxes.",
    isPublic: false,
  },
  {
    key: "ses_configuration_set",
    value: process.env.SES_CONFIGURATION_SET || "",
    category: "email_gateway",
    description: "SES Configuration Set name for delivery/open webhook tracking logs.",
    isPublic: false,
  },

  // ─── Twilio / Meta WhatsApp API Settings ───
  {
    key: "whatsapp_enabled",
    value: "true",
    category: "whatsapp_gateway",
    description: "Enable/disable WhatsApp message notifications.",
    isPublic: true,
  },
  {
    key: "whatsapp_api_url",
    value: process.env.WHATSAPP_API_URL || "https://graph.facebook.com/v18.0",
    category: "whatsapp_gateway",
    description: "Meta Graph API version base URL.",
    isPublic: false,
  },
  {
    key: "whatsapp_phone_number_id",
    value: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
    category: "whatsapp_gateway",
    description: "Meta App Phone Number ID to send messages.",
    isPublic: false,
  },
  {
    key: "whatsapp_access_token",
    value: process.env.WHATSAPP_ACCESS_TOKEN || "",
    category: "whatsapp_gateway",
    description: "Meta permanent system user access token (never expose).",
    isPublic: false,
  },
  {
    key: "whatsapp_verify_token",
    value: process.env.WHATSAPP_VERIFY_TOKEN || "triptay_verify",
    category: "whatsapp_gateway",
    description: "Custom verification handshake token for Webhook registration.",
    isPublic: false,
  },
];

// ─── Helpers ─────────────────────────────────────────────────

function mapConfig(row: Record<string, unknown>): Record<string, unknown> {
  // Parse JSON-like values so the admin panel receives native types
  let parsedValue: unknown = row.value;
  if (typeof row.value === "string") {
    const trimmed = row.value.trim();
    if (trimmed === "true") parsedValue = true;
    else if (trimmed === "false") parsedValue = false;
    else if (trimmed !== "" && !isNaN(Number(trimmed)) && !trimmed.includes("e")) {
      parsedValue = Number(trimmed);
    } else if (
      (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
      (trimmed.startsWith("{") && trimmed.endsWith("}"))
    ) {
      try {
        parsedValue = JSON.parse(trimmed);
      } catch {
        // keep raw string if not valid JSON
        parsedValue = row.value;
      }
    }
  }

  return {
    id: row.id,
    key: row.key,
    value: parsedValue,
    rawValue: row.value,
    category: row.category,
    description: row.description,
    isPublic: row.isPublic,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ─── Seed defaults ───────────────────────────────────────────

export async function seedDefaultConfigurations(): Promise<void> {
  try {
    const existing = await prisma.configuration.findMany({
      select: { key: true },
    });
    const existingKeys = new Set(existing.map((c) => c.key));

    const toCreate = DEFAULT_CONFIGURATIONS.filter(
      (d) => !existingKeys.has(d.key),
    );

    if (toCreate.length === 0) return;

    await prisma.configuration.createMany({
      data: toCreate.map((d) => ({
        key: d.key,
        value: d.value,
        category: d.category,
        description: d.description,
        isPublic: d.isPublic,
      })),
    });

    logger.info(`Seeded ${toCreate.length} default configuration entries.`);
  } catch (err) {
    logger.error("Failed to seed default configurations", { error: err });
  }
}

// ─── List all configurations (admin) ─────────────────────────

export async function listAllConfigurations(query: ConfigurationListQuery) {
  const { category, search, isPublic } = query;

  const where: Record<string, unknown> = {};
  if (category && category !== "all") {
    where.category = category;
  }
  if (search) {
    where.OR = [
      { key: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
    ];
  }
  if (isPublic === "true") {
    where.isPublic = true;
  } else if (isPublic === "false") {
    where.isPublic = false;
  }

  const configs = await prisma.configuration.findMany({
    where,
    orderBy: [{ category: "asc" }, { key: "asc" }],
  });

  return {
    configurations: configs.map((c) => mapConfig(c as unknown as Record<string, unknown>)),
    categories: await getCategories(),
  };
}

// ─── Public configurations (no auth) ─────────────────────────

export async function getPublicConfigurations() {
  return cacheWrap(
    "config:public",
    async () => {
      const configs = await prisma.configuration.findMany({
        where: { isPublic: true },
        select: { key: true, value: true, category: true },
      });

      const map: Record<string, unknown> = {};
      for (const c of configs) {
        const mapped = mapConfig(c as unknown as Record<string, unknown>);
        map[c.key] = mapped.value;
      }
      return map;
    },
    300, // 5 minute cache
  );
}

// ─── Get single configuration ────────────────────────────────

export async function getConfiguration(key: string) {
  const config = await prisma.configuration.findUnique({
    where: { key },
  });

  if (!config) {
    throw new AppError(`Configuration key "${key}" not found.`, 404);
  }

  return mapConfig(config as unknown as Record<string, unknown>);
}

// ─── Update / create configuration (upsert) ──────────────────

export async function updateConfiguration(
  key: string,
  data: UpdateConfigurationInput,
  adminId: string,
) {
  // Normalize value to a storable string
  let valueStr: string;
  if (typeof data.value === "string") {
    valueStr = data.value;
  } else if (typeof data.value === "number" || typeof data.value === "boolean") {
    valueStr = String(data.value);
  } else if (data.value === null || data.value === undefined) {
    throw new AppError("Configuration value is required.", 400);
  } else {
    // objects/arrays → JSON string
    valueStr = JSON.stringify(data.value);
  }

  const config = await prisma.configuration.upsert({
    where: { key },
    update: {
      value: valueStr,
      ...(data.category !== undefined && { category: data.category }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.isPublic !== undefined && { isPublic: data.isPublic }),
      updatedBy: adminId,
    },
    create: {
      key,
      value: valueStr,
      category: data.category || "general",
      description: data.description || null,
      isPublic: data.isPublic ?? false,
      updatedBy: adminId,
    },
  });

  // Invalidate caches
  await cacheDelPattern("config:*");

  logger.info(`Configuration "${key}" updated by admin ${adminId}`);

  return mapConfig(config as unknown as Record<string, unknown>);
}

// ─── Bulk update configurations ──────────────────────────────

export async function bulkUpdateConfigurations(
  updates: Array<{ key: string } & UpdateConfigurationInput>,
  adminId: string,
) {
  const results: Record<string, unknown>[] = [];

  for (const item of updates) {
    const { key, ...data } = item;
    const updated = await updateConfiguration(key, data, adminId);
    results.push(updated);
  }

  return { configurations: results, count: results.length };
}

// ─── Delete configuration ────────────────────────────────────

export async function deleteConfiguration(key: string, adminId: string) {
  const existing = await prisma.configuration.findUnique({
    where: { key },
    select: { id: true },
  });

  if (!existing) {
    throw new AppError(`Configuration key "${key}" not found.`, 404);
  }

  await prisma.configuration.delete({
    where: { key },
  });

  await cacheDelPattern("config:*");

  logger.info(`Configuration "${key}" deleted by admin ${adminId}`);

  return { key };
}

// ─── Get distinct categories ─────────────────────────────────

async function getCategories(): Promise<string[]> {
  const result = await prisma.configuration.findMany({
    distinct: ["category"],
    select: { category: true },
    orderBy: { category: "asc" },
  });
  return result.map((r) => r.category);
}

// ─── Payment Gateway Settings (DB-backed with env fallback) ──

export interface GatewaySettings {
  razorpay: {
    enabled: boolean;
    liveMode: boolean;
    keyId: string;
    keySecret: string;
    webhookSecret: string;
    testKeyId: string;
    testKeySecret: string;
    accountId: string;
    webhookUrl: string;
  };
  payu: {
    enabled: boolean;
    liveMode: boolean;
    merchantId: string;
    key: string;
    salt: string;
    webhookSalt: string;
    baseUrl: string;
    paymentHandleUrl: string;
    successUrl: string;
    failureUrl: string;
    testMerchantId: string;
    testKey: string;
    testSalt: string;
  };
  defaultGateway: string;
  fallbackEnabled: boolean;
}

/**
 * Fetch all payment-gateway settings from the DB (category = "payment_gateway").
 * Falls back to environment variables if a DB row is missing or empty.
 * Results are cached for 60 seconds to avoid repeated DB hits.
 */
export async function getGatewaySettings(): Promise<GatewaySettings> {
  return cacheWrap(
    "config:gateway-settings",
    async () => {
      const rows = await prisma.configuration.findMany({
        where: { category: "payment_gateway" },
        select: { key: true, value: true },
      });

      const map: Record<string, string> = {};
      for (const r of rows) {
        map[r.key] = r.value;
      }

      // Helper: DB value first, then env fallback, then default
      const pick = (dbKey: string, envKey: string, fallback = ""): string => {
        const dbVal = map[dbKey];
        if (dbVal !== undefined && dbVal !== "") return dbVal;
        return process.env[envKey] || fallback;
      };

      const pickBool = (dbKey: string, fallback = false): boolean => {
        const dbVal = map[dbKey];
        if (dbVal !== undefined && dbVal !== "") return dbVal === "true";
        return fallback;
      };

      return {
        razorpay: {
          enabled: pickBool("razorpay_enabled", true),
          liveMode: pickBool("razorpay_live_mode", false),
          keyId: pick("razorpay_key_id", "RAZORPAY_KEY_ID"),
          keySecret: pick("razorpay_key_secret", "RAZORPAY_KEY_SECRET"),
          webhookSecret: pick("razorpay_webhook_secret", "RAZORPAY_WEBHOOK_SECRET"),
          testKeyId: pick("razorpay_test_key_id", "RAZORPAY_TEST_KEY_ID"),
          testKeySecret: pick("razorpay_test_key_secret", "RAZORPAY_TEST_KEY_SECRET"),
          accountId: map.razorpay_account_id || "",
          webhookUrl: map.razorpay_webhook_url || "",
        },
        payu: {
          enabled: pickBool("payu_enabled", true),
          liveMode: pickBool("payu_live_mode", process.env.PAYU_ENV === "PRODUCTION"),
          merchantId: pick("payu_merchant_id", "PAYU_MERCHANT_ID"),
          key: pick("payu_key", "PAYU_KEY"),
          salt: pick("payu_salt", "PAYU_SALT"),
          webhookSalt: pick("payu_webhook_salt", "PAYU_WEBHOOK_SALT"),
          baseUrl: pick("payu_base_url", "PAYU_BASE_URL", process.env.NODE_ENV === "production" ? "https://secure.payu.in" : "https://test.payu.in"),
          paymentHandleUrl: pick("payu_payment_handle_url", "PAYU_PAYMENT_HANDLE_URL"),
          successUrl: pick("payu_success_url", "PAYU_SUCCESS_URL", `${process.env.FRONTEND_URL || "http://localhost:3000"}/checkout/payu/success`),
          failureUrl: pick("payu_failure_url", "PAYU_FAILURE_URL", `${process.env.FRONTEND_URL || "http://localhost:3000"}/checkout/payu/failure`),
          testMerchantId: map.payu_test_merchant_id || "",
          testKey: map.payu_test_key || "",
          testSalt: map.payu_test_salt || "",
        },
        defaultGateway: map.default_payment_gateway || "razorpay",
        fallbackEnabled: pickBool("payment_gateway_fallback_enabled", true),
      };
    },
    60, // 60-second cache
  );
}

/**
 * Mask a secret string for display — shows first 4 and last 4 chars only.
 */
export function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "••••••••";
  return `${value.substring(0, 4)}${"•".repeat(Math.min(value.length - 8, 24))}${value.substring(value.length - 4)}`;
}

// ─── Cancellation Policy Settings ──────────────────────────────

export interface CancellationPolicySettings {
  /** Global default policy applied when vendor override is disabled or no policy set. */
  defaultPolicy: string;
  /** Whether vendors can set their own cancellation policy per listing/activity. */
  vendorOverrideEnabled: boolean;
  /** Hours before check-in for full refund under Flexible policy. */
  flexibleFullRefundHours: number;
  /** Hours before check-in for full refund under Moderate policy. */
  moderateFullRefundHours: number;
  /** Hours before check-in for 50% refund under Moderate policy. */
  moderatePartialRefundHours: number;
  /** Hours before check-in for 50% refund under Strict policy. */
  strictPartialRefundHours: number;
}

/**
 * Fetch all cancellation-policy settings from the DB (category = "cancellation").
 * Falls back to the seeded defaults if a DB row is missing or empty.
 * Results are cached for 60 seconds to avoid repeated DB hits.
 *
 * Used by:
 *   - booking.service.ts (getCancelPreview / cancelBooking) for refund calculations
 *   - listing.service.ts / activity.service.ts to apply the admin default policy
 *   - Public config endpoint so the frontend vendor forms can show/hide the selector
 */
export async function getCancellationPolicySettings(): Promise<CancellationPolicySettings> {
  return cacheWrap(
    "config:cancellation-policy",
    async () => {
      const rows = await prisma.configuration.findMany({
        where: { category: "cancellation" },
        select: { key: true, value: true },
      });

      const map: Record<string, string> = {};
      for (const r of rows) {
        map[r.key] = r.value;
      }

      const pickStr = (key: string, fallback: string): string => {
        const v = map[key];
        return v !== undefined && v !== "" ? v : fallback;
      };
      const pickNum = (key: string, fallback: number): number => {
        const v = map[key];
        if (v === undefined || v === "") return fallback;
        const n = Number(v);
        return isNaN(n) ? fallback : n;
      };
      const pickBool = (key: string, fallback: boolean): boolean => {
        const v = map[key];
        return v !== undefined && v !== "" ? v === "true" : fallback;
      };

      return {
        defaultPolicy: pickStr("cancellation_default_policy", "Moderate"),
        vendorOverrideEnabled: pickBool("cancellation_vendor_override_enabled", true),
        flexibleFullRefundHours: pickNum("cancellation_flexible_full_refund_hours", 24),
        moderateFullRefundHours: pickNum("cancellation_moderate_full_refund_hours", 120),
        moderatePartialRefundHours: pickNum("cancellation_moderate_partial_refund_hours", 48),
        strictPartialRefundHours: pickNum("cancellation_strict_partial_refund_hours", 168),
      };
    },
    60, // 60-second cache
  );
}

/**
 * Retrieve AWS SES email gateway settings from database configurations.
 */
export async function getEmailSettings(): Promise<{
  region: string;
  fromEmail: string;
  fromName: string;
  configurationSet: string;
}> {
  return cacheWrap(
    "config:email-settings",
    async () => {
      const rows = await prisma.configuration.findMany({
        where: { category: "email_gateway" },
        select: { key: true, value: true },
      });

      const map: Record<string, string> = {};
      for (const r of rows) {
        map[r.key] = r.value;
      }

      return {
        region: map.ses_region || process.env.AWS_SES_REGION || process.env.AWS_REGION || "ap-south-1",
        fromEmail: map.ses_from_email || process.env.SES_FROM_EMAIL || "no-reply@triptay.com",
        fromName: map.ses_from_name || process.env.SES_FROM_NAME || "Triptay",
        configurationSet: map.ses_configuration_set || process.env.SES_CONFIGURATION_SET || "",
      };
    },
    60,
  );
}

/**
 * Retrieve Meta/Twilio WhatsApp gateway settings from database configurations.
 */
export async function getWhatsAppSettings(): Promise<{
  enabled: boolean;
  apiUrl: string;
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
}> {
  return cacheWrap(
    "config:whatsapp-settings",
    async () => {
      const rows = await prisma.configuration.findMany({
        where: { category: "whatsapp_gateway" },
        select: { key: true, value: true },
      });

      const map: Record<string, string> = {};
      for (const r of rows) {
        map[r.key] = r.value;
      }

      return {
        enabled: map.whatsapp_enabled !== "false",
        apiUrl: map.whatsapp_api_url || process.env.WHATSAPP_API_URL || "https://graph.facebook.com/v18.0",
        phoneNumberId: map.whatsapp_phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID || "",
        accessToken: map.whatsapp_access_token || process.env.WHATSAPP_ACCESS_TOKEN || "",
        verifyToken: map.whatsapp_verify_token || process.env.WHATSAPP_VERIFY_TOKEN || "triptay_verify",
      };
    },
    60,
  );
}
