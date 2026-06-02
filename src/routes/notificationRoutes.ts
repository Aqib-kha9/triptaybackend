import { Router } from "express";
import { protect } from "../middlewares/authMiddleware.js";
import {
  getMyNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllNotifications,
} from "../controllers/notificationController.js";

const router = Router();

// All notification routes require authentication
router.use(protect);

// Get notifications (paginated, filterable by type)
router.get("/", getMyNotifications);

// Get unread count
router.get("/unread", getUnreadCount);

// Mark one as read
router.patch("/:notificationId/read", markAsRead);

// Mark all as read
router.patch("/read-all", markAllAsRead);

// Delete one
router.delete("/:notificationId", deleteNotification);

// Delete all
router.delete("/", deleteAllNotifications);

export default router;