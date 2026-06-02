import type { Response, NextFunction } from "express";
import Notification from "../models/Notification.js";

// ──────────────────────── Get My Notifications ────────────────────────

export const getMyNotifications = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user._id || req.user.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;
    const type = req.query.type as string | undefined;

    const filter: any = { recipient: userId };
    if (type && type !== "all") {
      filter.type = type;
    }

    const [notifications, total] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Notification.countDocuments(filter),
    ]);

    res.status(200).json({
      status: "success",
      data: {
        notifications,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── Get Unread Count ────────────────────────

export const getUnreadCount = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user._id || req.user.id;

    const count = await Notification.countDocuments({
      recipient: userId,
      isRead: false,
    });

    res.status(200).json({
      status: "success",
      data: { unreadCount: count },
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── Mark One as Read ────────────────────────

export const markAsRead = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user._id || req.user.id;
    const { notificationId } = req.params;

    const notification = await (Notification as any).findOneAndUpdate(
      { _id: notificationId, recipient: userId },
      { isRead: true, readAt: new Date() },
      { new: true }
    );

    if (!notification) {
      res.status(404).json({ status: "fail", message: "Notification not found." });
      return;
    }

    res.status(200).json({ status: "success", data: notification });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── Mark All as Read ────────────────────────

export const markAllAsRead = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user._id || req.user.id;

    await (Notification as any).updateMany(
      { recipient: userId, isRead: false },
      { isRead: true, readAt: new Date() }
    );

    res.status(200).json({ status: "success", message: "All notifications marked as read." });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── Delete a Notification ────────────────────────

export const deleteNotification = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user._id || req.user.id;
    const { notificationId } = req.params;

    const notification = await (Notification as any).findOneAndDelete({
      _id: notificationId,
      recipient: userId,
    });

    if (!notification) {
      res.status(404).json({ status: "fail", message: "Notification not found." });
      return;
    }

    res.status(200).json({ status: "success", message: "Notification deleted." });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── Delete All Notifications ────────────────────────

export const deleteAllNotifications = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user._id || req.user.id;

    await Notification.deleteMany({ recipient: userId });

    res.status(200).json({ status: "success", message: "All notifications deleted." });
  } catch (error) {
    next(error);
  }
};