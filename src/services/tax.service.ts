import { prisma } from "../config/db.js";

export const taxService = {
  /**
   * Calculates taxes that the customer pays (GST on accommodation and platform fee).
   */
  async calculateCustomerTaxes(
    itemType: "listing" | "activity",
    baseAmount: number,
    cleaningFee: number,
    extraGuestCharges: number,
    nights: number,
    platformFee: number,
    vendorTaxPercentage?: number,
    totalUnits: number = 1
  ) {
    const [platformGstConfig, gstRateConfig, gstLuxuryRateConfig, gstThresholdConfig] = await Promise.all([
      prisma.configuration.findUnique({ where: { key: "platform_gst_rate" } }),
      prisma.configuration.findUnique({ where: { key: "gst_rate" } }),
      prisma.configuration.findUnique({ where: { key: "gst_luxury_rate" } }),
      prisma.configuration.findUnique({ where: { key: "gst_luxury_threshold" } }),
    ]);

    const platformGstRate = platformGstConfig ? parseFloat(platformGstConfig.value) : 18;
    const baseGstRate = gstRateConfig ? parseFloat(gstRateConfig.value) : 12;
    const luxuryGstRate = gstLuxuryRateConfig ? parseFloat(gstLuxuryRateConfig.value) : 18;
    const luxuryThreshold = gstThresholdConfig ? parseFloat(gstThresholdConfig.value) : 7500;

    const totalAccommodationRevenue = baseAmount + cleaningFee + extraGuestCharges;
    let accommodationTax = 0;

    if (itemType === "listing" && nights > 0) {
      const effectiveDailyRate = (totalAccommodationRevenue / totalUnits) / nights;
      if (effectiveDailyRate <= luxuryThreshold) {
        accommodationTax = totalAccommodationRevenue * (baseGstRate / 100);
      } else {
        accommodationTax = totalAccommodationRevenue * (luxuryGstRate / 100);
      }
    } else {
      const activityRate = vendorTaxPercentage ?? baseGstRate;
      accommodationTax = totalAccommodationRevenue * (activityRate / 100);
    }

    const platformFeeTax = platformFee * (platformGstRate / 100);

    return {
      accommodationTax: Math.round(accommodationTax),
      platformFeeTax: Math.round(platformFeeTax),
    };
  },

  /**
   * Calculates deductions from the vendor's payout (TCS, TDS, GST on Commission).
   */
  async calculateVendorDeductions(
    totalAccommodationRevenue: number,
    commissionAmount: number
  ) {
    const [tcsConfig, tdsConfig, platformGstConfig] = await Promise.all([
      prisma.configuration.findUnique({ where: { key: "tcs_rate" } }),
      prisma.configuration.findUnique({ where: { key: "tds_rate" } }),
      prisma.configuration.findUnique({ where: { key: "platform_gst_rate" } }),
    ]);

    const tcsRate = tcsConfig ? parseFloat(tcsConfig.value) : 1;
    const tdsRate = tdsConfig ? parseFloat(tdsConfig.value) : 1;
    const platformGstRate = platformGstConfig ? parseFloat(platformGstConfig.value) : 18;

    const commissionTax = commissionAmount * (platformGstRate / 100);
    const tcsDeduction = totalAccommodationRevenue * (tcsRate / 100);
    const tdsDeduction = totalAccommodationRevenue * (tdsRate / 100);

    return {
      commissionTax: Math.round(commissionTax),
      tcsDeduction: Math.round(tcsDeduction),
      tdsDeduction: Math.round(tdsDeduction),
    };
  }
};
