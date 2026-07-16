import { Router } from "express";
import { protect } from "../middlewares/authMiddleware.js";
import {
  getOrCreateConversation,
  getMyConversations,
  getMessages,
  sendMessage,
  markConversationRead,
  getUnreadCount,
} from "../controllers/chatController.js";
import { validate } from "../validators/middleware.js";
import { schemas } from "../validators/schemas.js";

const router = Router();

// All chat routes require authentication
router.use(protect);

// Conversation CRUD
router.post("/conversations", validate(schemas.chat.getOrCreateConversation), getOrCreateConversation);
router.get("/conversations", getMyConversations);

// Messages
router.get("/conversations/:id/messages", getMessages);
router.post("/conversations/:id/messages", validate(schemas.chat.sendMessage), sendMessage);

// Read status
router.patch("/conversations/:id/read", markConversationRead);

// Unread count
router.get("/unread", getUnreadCount);

export default router;