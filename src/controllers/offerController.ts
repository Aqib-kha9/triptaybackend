import type { Request, Response } from "express";
import { offerService } from "../services/offer.service.js";

export const offerController = {
  // Public route
  async getActiveOffers(req: Request, res: Response) {
    try {
      const offers = await offerService.getActiveOffers();
      res.json({ success: true, data: offers });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // Admin routes
  async getAllOffers(req: Request, res: Response) {
    try {
      const offers = await offerService.getAllOffers();
      res.json({ success: true, data: offers });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  },

  async createOffer(req: Request, res: Response) {
    try {
      const offer = await offerService.createOffer(req.body);
      res.status(201).json({ success: true, data: offer });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  },

  async updateOffer(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const offer = await offerService.updateOffer(id as string, req.body);
      res.json({ success: true, data: offer });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  },

  async deleteOffer(req: Request, res: Response) {
    try {
      const { id } = req.params;
      await offerService.deleteOffer(id as string);
      res.json({ success: true, message: "Offer deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  },
};
