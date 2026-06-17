import type { Response, NextFunction } from "express";
import { prisma } from "../config/db.js";

// ──────────────────────── Get My Notifications ────────────────────────

export const getMyNotifications = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;
    const type = req.query.type as string | undefined;

    const filter: any = { recipientId: userId };
    if (type && type !== "all") {
      filter.type = type;
    }

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where: filter,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.notification.count({
        where: filter,
      }),
    ]);

    // Map id to _id for frontend compatibility
    const mappedNotifications = notifications.map((n: any) => ({
      ...n,
      _id: n.id,
      recipient: n.recipientId,
    }));

    res.status(200).json({
      status: "success",
      data: {
        notifications: mappedNotifications,
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
    const userId = req.user.id;

    const count = await prisma.notification.count({
      where: {
        recipientId: userId,
        isRead: false,
      },
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
    const userId = req.user.id;
    const { notificationId } = req.params;

    const existing = await prisma.notification.findFirst({
      where: { id: notificationId, recipientId: userId },
    });

    if (!existing) {
      res.status(404).json({ status: "fail", message: "Notification not found." });
      return;
    }

    const updated = await prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true, readAt: new Date() },
    });

    const mapped = {
      ...updated,
      _id: updated.id,
      recipient: updated.recipientId,
    };

    res.status(200).json({ status: "success", data: mapped });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── Mark All as Read ────────────────────────

export const markAllAsRead = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user.id;

    await prisma.notification.updateMany({
      where: { recipientId: userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });

    res.status(200).json({ status: "success", message: "All notifications marked as read." });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── Delete a Notification ────────────────────────

export const deleteNotification = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user.id;
    const { notificationId } = req.params;

    const existing = await prisma.notification.findFirst({
      where: { id: notificationId, recipientId: userId },
    });

    if (!existing) {
      res.status(404).json({ status: "fail", message: "Notification not found." });
      return;
    }

    await prisma.notification.delete({
      where: { id: notificationId },
    });

    res.status(200).json({ status: "success", message: "Notification deleted." });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── Delete All Notifications ────────────────────────

export const deleteAllNotifications = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user.id;

    await prisma.notification.deleteMany({
      where: { recipientId: userId },
    });

    res.status(200).json({ status: "success", message: "All notifications deleted." });
  } catch (error) {
    next(error);
  }
};