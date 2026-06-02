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

const router = Router();

// All chat routes require authentication
router.use(protect);

// Conversation CRUD
router.post("/conversations", getOrCreateConversation);
router.get("/conversations", getMyConversations);

// Messages
router.get("/conversations/:conversationId/messages", getMessages);
router.post("/conversations/:conversationId/messages", sendMessage);

// Read status
router.patch("/conversations/:conversationId/read", markConversationRead);

// Unread count
router.get("/unread", getUnreadCount);

export default router;