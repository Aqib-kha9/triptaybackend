import { prisma } from "../config/db.js";

export const ticketService = {
  // Create a new ticket (Dispute or Support)
  async createTicket(data: any) {
    const ticketRef = `TKT-${Math.floor(100000 + Math.random() * 900000)}`;
    return await prisma.supportTicket.create({
      data: {
        ticketRef,
        ...data,
      },
    });
  },

  // Get all tickets with optional filtering
  async getTickets(filters: any = {}) {
    const where: any = {};
    if (filters.type) where.type = filters.type;
    if (filters.status) where.status = filters.status;
    if (filters.userId) where.userId = filters.userId;
    
    return await prisma.supportTicket.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
  },

  // Get ticket by ID
  async getTicketById(id: string) {
    return await prisma.supportTicket.findUnique({
      where: { id },
    });
  },

  // Update ticket status or details (Admin)
  async updateTicket(id: string, data: any) {
    return await prisma.supportTicket.update({
      where: { id },
      data,
    });
  },

  // Delete ticket
  async deleteTicket(id: string) {
    return await prisma.supportTicket.delete({
      where: { id },
    });
  },
};
