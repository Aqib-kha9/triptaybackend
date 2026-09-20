import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const offerService = {
  /**
   * Get all active offers ordered by display priority (order)
   */
  async getActiveOffers() {
    return prisma.offer.findMany({
      where: { isActive: true },
      orderBy: { order: "asc" },
    });
  },

  /**
   * Get all offers (admin only)
   */
  async getAllOffers() {
    return prisma.offer.findMany({
      orderBy: { order: "asc" },
    });
  },

  /**
   * Create a new offer (admin)
   */
  async createOffer(data: {
    title: string;
    discount: string;
    desc: string;
    image: string;
    bgClass: string;
    tag?: string;
    couponCode?: string;
    linkUrl?: string;
    isActive?: boolean;
    order?: number;
  }) {
    return prisma.offer.create({
      data,
    });
  },

  /**
   * Update an existing offer (admin)
   */
  async updateOffer(id: string, data: any) {
    return prisma.offer.update({
      where: { id },
      data,
    });
  },

  /**
   * Delete an offer (admin)
   */
  async deleteOffer(id: string) {
    return prisma.offer.delete({
      where: { id },
    });
  },
};
