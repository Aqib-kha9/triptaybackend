import type { Request, Response, NextFunction } from "express";
import * as configurationService from "../services/configuration.service.js";
import { logger } from "../core/logger.js";

// ──────────────────────── Controllers ────────────────────────

// @desc    List all configurations (admin)
// @route   GET /api/admin/configurations
// @access  Private (Admin)
export const listConfigurations = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { category, search, isPublic } = req.query;
    const result = await configurationService.listAllConfigurations({
      category: category as string | undefined,
      search: search as string | undefined,
      isPublic: isPublic as string | undefined,
    });

    res.status(200).json({
      status: "success",
      results: result.configurations.length,
      data: {
        configurations: result.configurations,
        categories: result.categories,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get a single configuration by key (admin)
// @route   GET /api/admin/configurations/:key
// @access  Private (Admin)
export const getConfiguration = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const config = await configurationService.getConfiguration(req.params.key);

    res.status(200).json({
      status: "success",
      data: { configuration: config },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update or create a configuration (admin)
// @route   PUT /api/admin/configurations/:key
// @access  Private (Admin)
export const updateConfiguration = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { value, category, description, isPublic } = req.body;

    const config = await configurationService.updateConfiguration(
      req.params.key,
      { value, category, description, isPublic },
      req.admin.id,
    );

    res.status(200).json({
      status: "success",
      message: "Configuration updated successfully.",
      data: { configuration: config },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Bulk update configurations (admin)
// @route   PUT /api/admin/configurations
// @access  Private (Admin)
export const bulkUpdateConfigurations = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { updates } = req.body;

    if (!Array.isArray(updates) || updates.length === 0) {
      res.status(400).json({
        status: "fail",
        message: "Please supply a non-empty 'updates' array.",
      });
      return;
    }

    const result = await configurationService.bulkUpdateConfigurations(updates, req.admin.id);

    res.status(200).json({
      status: "success",
      message: `${result.count} configuration(s) updated successfully.`,
      data: { configurations: result.configurations },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete a configuration (admin)
// @route   DELETE /api/admin/configurations/:key
// @access  Private (Admin)
export const deleteConfiguration = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await configurationService.deleteConfiguration(req.params.key, req.admin.id);

    res.status(200).json({
      status: "success",
      message: `Configuration "${result.key}" deleted successfully.`,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get public configurations (no auth)
// @route   GET /api/public/configurations
// @access  Public
export const getPublicConfigurations = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const config = await configurationService.getPublicConfigurations();

    res.status(200).json({
      status: "success",
      data: { configuration: config },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get payment gateway settings (admin) — secrets are masked
// @route   GET /api/admin/configurations/gateway-settings
// @access  Private (Admin)
export const getGatewaySettings = async (_req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const settings = await configurationService.getGatewaySettings();
    const mask = configurationService.maskSecret;

    // Return settings with sensitive fields masked for display
    res.status(200).json({
      status: "success",
      data: {
        gatewaySettings: {
          razorpay: {
            enabled: settings.razorpay.enabled,
            liveMode: settings.razorpay.liveMode,
            keyId: settings.razorpay.keyId, // key ID is semi-public (shown on dashboard)
            keySecret: mask(settings.razorpay.keySecret),
            keySecretConfigured: Boolean(settings.razorpay.keySecret),
            webhookSecret: mask(settings.razorpay.webhookSecret),
            webhookSecretConfigured: Boolean(settings.razorpay.webhookSecret),
            testKeyId: settings.razorpay.testKeyId,
            testKeySecret: mask(settings.razorpay.testKeySecret),
            testKeySecretConfigured: Boolean(settings.razorpay.testKeySecret),
            accountId: settings.razorpay.accountId,
            webhookUrl: settings.razorpay.webhookUrl,
          },
          payu: {
            enabled: settings.payu.enabled,
            liveMode: settings.payu.liveMode,
            merchantId: settings.payu.merchantId,
            key: settings.payu.key, // key is semi-public (used in form)
            salt: mask(settings.payu.salt),
            saltConfigured: Boolean(settings.payu.salt),
            webhookSalt: mask(settings.payu.webhookSalt),
            webhookSaltConfigured: Boolean(settings.payu.webhookSalt),
            baseUrl: settings.payu.baseUrl,
            paymentHandleUrl: settings.payu.paymentHandleUrl,
            successUrl: settings.payu.successUrl,
            failureUrl: settings.payu.failureUrl,
            testMerchantId: settings.payu.testMerchantId,
            testKey: settings.payu.testKey,
            testSalt: mask(settings.payu.testSalt),
            testSaltConfigured: Boolean(settings.payu.testSalt),
          },
          defaultGateway: settings.defaultGateway,
          fallbackEnabled: settings.fallbackEnabled,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Test payment gateway connectivity (admin)
// @route   POST /api/admin/configurations/gateway-settings/test
// @access  Private (Admin)
export const testGatewayConnection = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { gateway } = req.body; // "razorpay" | "payu"
    const settings = await configurationService.getGatewaySettings();
    let result: { success: boolean; message: string; details?: string } = { success: false, message: "Unknown gateway." };

    if (gateway === "razorpay") {
      if (!settings.razorpay.enabled) {
        result = { success: false, message: "Razorpay is disabled in settings." };
      } else {
        // Determine which credentials will actually be used (mirrors getRazorpay() logic)
        const activeKeyId = settings.razorpay.liveMode
          ? settings.razorpay.keyId
          : (settings.razorpay.testKeyId || settings.razorpay.keyId);
        const activeKeySecret = settings.razorpay.liveMode
          ? settings.razorpay.keySecret
          : (settings.razorpay.testKeySecret || settings.razorpay.keySecret);

        if (!activeKeyId || !activeKeySecret) {
          const mode = settings.razorpay.liveMode ? "Live" : "Test";
          result = { success: false, message: `Razorpay ${mode} Key ID or Key Secret is not configured.` };
        } else {
          // Actually hit the Razorpay API to verify the credentials work
          try {
            const { getRazorpay } = await import("../services/payment.service.js");
            logger.info(`[Gateway Test] Razorpay liveMode=${settings.razorpay.liveMode} → using key_id="${activeKeyId}" secret_length=${activeKeySecret?.length || 0}`);

            const razorpay = await getRazorpay();
            if (!razorpay) {
              result = { success: false, message: "Could not initialize Razorpay client." };
            } else {
              // Fetch most recent orders page — lightweight, fast, proves auth works
              await Promise.race([
                razorpay.orders.all({ count: 1 }),
                new Promise((_, reject) => setTimeout(() => reject(new Error("Connection timed out after 2.5s.")), 2500)),
              ]);
              result = {
                success: true,
                message: `Razorpay ${settings.razorpay.liveMode ? "LIVE" : "TEST"} credentials verified successfully.`,
                details: `Key ID: ${activeKeyId.substring(0, 16)}...`,
              };
            }
          } catch (rzpErr: any) {
            const description =
              rzpErr?.error?.description ||
              rzpErr?.error?.reason ||
              rzpErr?.message ||
              "Authentication failed";
            result = { success: false, message: `Razorpay error: ${description}` };
          }
        }
      }
    } else if (gateway === "payu") {
      if (!settings.payu.enabled) {
        result = { success: false, message: "PayU is disabled in settings." };
      } else if (!settings.payu.key || !settings.payu.salt) {
        result = { success: false, message: "PayU Key or Salt is not configured." };
      } else {
        result = {
          success: true,
          message: `PayU ${settings.payu.liveMode ? "PRODUCTION" : "TEST"} mode credentials detected.`,
          details: `MID: ${settings.payu.merchantId || "N/A"}, Key: ${settings.payu.key}, Base URL: ${settings.payu.baseUrl}`,
        };
      }
    }

    res.status(200).json({
      status: "success",
      data: { testResult: result },
    });
  } catch (error) {
    next(error);
  }
};
