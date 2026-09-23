import { Router } from "express";
import { protect, restrictTo } from "../middlewares/authMiddleware.js";
import { createTicket, getTickets, updateTicketStatus } from "../controllers/supportController.js";
import { validate } from "../validators/middleware.js";
import { z } from "zod";

const router = Router();

// Validation schema for creating a ticket
const createTicketSchema = z.object({
  body: z.object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    email: z.string().email("Invalid email format"),
    subject: z.string().min(3, "Subject must be at least 3 characters"),
    message: z.string().min(10, "Message must be at least 10 characters"),
  }),
});

// Optionally use `protect` to attach user if logged in, but we want it public too.
// If we want public access but optional user parsing, we might need a custom middleware
// or just parse the token if it exists without rejecting if it doesn't.
// Let's use an optional auth middleware if available, or just leave it public.
// Wait, `authMiddleware.ts` `protect` usually rejects if no token.
// So we will just leave the POST route completely public.
router.post("/", validate(createTicketSchema) as any, createTicket as any);

// Admin only routes
router.use(protect as any, restrictTo("Admin") as any);
router.get("/", getTickets as any);
router.patch("/:id/status", updateTicketStatus as any);

export default router;
