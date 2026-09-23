import type { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// @desc    Create a new support ticket
// @route   POST /api/support
// @access  Public or Protected (We can read req.user if available)
export const createTicket = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, subject, message } = req.body;
    
    // user might be logged in or guest
    const userId = (req as any).user?.id || null;

    if (!name || !email || !subject || !message) {
      res.status(400).json({ status: "fail", message: "All fields are required" });
      return;
    }

    const ticket = await prisma.supportTicket.create({
      data: {
        userId,
        name,
        email,
        subject,
        message,
        status: "Open",
      },
    });

    res.status(201).json({
      status: "success",
      data: { ticket },
    });
  } catch (error: any) {
    console.error("Error creating ticket:", error);
    res.status(500).json({ status: "error", message: "Server error" });
  }
};

// @desc    Get all support tickets
// @route   GET /api/support
// @access  Admin
export const getTickets = async (req: Request, res: Response): Promise<void> => {
  try {
    const tickets = await prisma.supportTicket.findMany({
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({
      status: "success",
      results: tickets.length,
      data: { tickets },
    });
  } catch (error: any) {
    console.error("Error fetching tickets:", error);
    res.status(500).json({ status: "error", message: "Server error" });
  }
};

// @desc    Update support ticket status
// @route   PATCH /api/support/:id/status
// @access  Admin
export const updateTicketStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!["Open", "In Progress", "Resolved"].includes(status)) {
      res.status(400).json({ status: "fail", message: "Invalid status" });
      return;
    }

    const ticket = await prisma.supportTicket.update({
      where: { id: String(id) },
      data: { status },
    });

    res.status(200).json({
      status: "success",
      data: { ticket },
    });
  } catch (error: any) {
    console.error("Error updating ticket status:", error);
    res.status(500).json({ status: "error", message: "Server error" });
  }
};
