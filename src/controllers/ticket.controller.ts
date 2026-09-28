import type { Request, Response } from "express";
import { ticketService } from "../services/ticket.service.js";

export const ticketController = {
  async createTicket(req: Request, res: Response): Promise<void> {
    try {
      const data = req.body;
      const ticket = await ticketService.createTicket({
        ...data,
        userId: (req as any).user?.id || data.userId, // Authenticated user ID if available
      });
      res.status(201).json({ status: "success", data: { ticket } });
    } catch (error: any) {
      res.status(400).json({ status: "error", message: error.message });
    }
  },

  async getTickets(req: Request, res: Response): Promise<void> {
    try {
      const filters = req.query;
      const tickets = await ticketService.getTickets(filters);
      res.status(200).json({ status: "success", data: { tickets } });
    } catch (error: any) {
      res.status(400).json({ status: "error", message: error.message });
    }
  },

  async getTicketById(req: Request, res: Response): Promise<void> {
    try {
      const ticket = await ticketService.getTicketById(req.params.id as string);
      if (!ticket) {
        res.status(404).json({ status: "error", message: "Ticket not found" });
        return;
      }
      res.status(200).json({ status: "success", data: { ticket } });
    } catch (error: any) {
      res.status(400).json({ status: "error", message: error.message });
    }
  },

  async updateTicket(req: Request, res: Response): Promise<void> {
    try {
      const ticket = await ticketService.updateTicket(req.params.id as string, req.body);
      res.status(200).json({ status: "success", data: { ticket } });
    } catch (error: any) {
      res.status(400).json({ status: "error", message: error.message });
    }
  },

  async deleteTicket(req: Request, res: Response): Promise<void> {
    try {
      await ticketService.deleteTicket(req.params.id as string);
      res.status(200).json({ status: "success", message: "Ticket deleted successfully" });
    } catch (error: any) {
      res.status(400).json({ status: "error", message: error.message });
    }
  },
};
