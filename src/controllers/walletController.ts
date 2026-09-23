import type { Request, Response } from "express";
import { walletService } from "../services/wallet.service.js";
import { getRazorpay } from "../services/payment.service.js";
import { getGatewaySettings } from "../services/configuration.service.js";
import crypto from "crypto";

export const walletController = {
  async getHistory(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const history = await walletService.getWalletHistory(userId);
      res.json({ status: "success", data: history });
    } catch (error: any) {
      console.error("[Wallet getHistory Error]:", error);
      res.status(500).json({ message: error.message || "Internal server error" });
    }
  },

  async createOrder(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const { amount } = req.body;
      if (!amount || amount <= 0) {
        return res.status(400).json({ message: "Valid amount is required" });
      }

      const razorpay = await getRazorpay();
      if (!razorpay) {
        return res.status(400).json({ message: "Payment gateway not configured." });
      }

      const order = await razorpay.orders.create({
        amount: Math.round(amount * 100), // in paise
        currency: "INR",
        notes: { userId, type: "wallet_topup" },
      });

      const settings = await getGatewaySettings();
      const keyId = settings.razorpay.liveMode 
        ? settings.razorpay.keyId 
        : (settings.razorpay.testKeyId || settings.razorpay.keyId);

      res.json({
        status: "success",
        data: {
          message: "Order created successfully",
          orderId: order.id,
          amount: order.amount,
          currency: order.currency,
          keyId: keyId,
        }
      });
    } catch (error: any) {
      console.error("[Wallet createOrder Error]:", error);
      const msg = error.error?.description || error.error?.reason || error.message || "Internal server error";
      res.status(500).json({ message: msg });
    }
  },

  async verifyPayment(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const { razorpayOrderId, razorpayPaymentId, razorpaySignature, amount } = req.body;
      if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature || !amount) {
        return res.status(400).json({ message: "Invalid payment details" });
      }

      const settings = await getGatewaySettings();
      const keySecret = settings.razorpay.liveMode ? settings.razorpay.keySecret : (settings.razorpay.testKeySecret || settings.razorpay.keySecret);
      
      if (!keySecret) {
        return res.status(400).json({ message: "Payment gateway not configured properly." });
      }

      const generatedSignature = crypto
        .createHmac("sha256", keySecret)
        .update(`${razorpayOrderId}|${razorpayPaymentId}`)
        .digest("hex");

      if (generatedSignature !== razorpaySignature) {
        return res.status(400).json({ message: "Invalid payment signature" });
      }

      // 100% Secure & Verified, now add money
      const txn = await walletService.addMoney(userId, amount, "Added to Wallet", `Top-up via Razorpay (${razorpayPaymentId})`);
      
      res.json({
        status: "success",
        data: {
          message: `Successfully added ₹${amount} to your wallet.`,
          transaction: txn,
        }
      });
    } catch (error: any) {
      console.error("[Wallet verifyPayment Error]:", error);
      const msg = error.error?.description || error.error?.reason || error.message || "Internal server error";
      res.status(500).json({ message: msg });
    }
  },
};
