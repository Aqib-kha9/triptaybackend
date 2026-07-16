import { prisma } from "../config/db.js";
import { NotFoundError } from "../core/errors.js";
import { buildPaginationMeta } from "../utils/pagination.js";

// ──────────────────────── Types ────────────────────────

export interface NotificationItem {
  _id: string;
  id: string;
  recipient: string;
  [key: string]: unknown;
}

export interface NotificationsResult {
  notifications: NotificationItem[];
  pagination: ReturnType<typeof buildPaginationMeta>;
}

// ──────────────────────── Helpers ────────────────────────

function resolvePagination(
  pageStr?: string,
  limitStr?: string,
  defaultLimit = 20,
  maxLimit = 50,
): { page: number; limit: number; skip: number } {
  const page = Math.max(1, parseInt(pageStr || "1", 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(limitStr || String(defaultLimit), 10) || defaultLimit));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

function mapNotification(n: Record<string, unknown>): NotificationItem {
  return {
    ...n,
    _id: n.id as string,
    recipient: n.recipientId as string,
  } as NotificationItem;
}

// ──────────────────────── Service Functions ────────────────────────

export async function getMyNotifications(
  userId: string,
  pageStr?: string,
  limitStr?: string,
  type?: string,
): Promise<NotificationsResult> {
  const { page, limit, skip } = resolvePagination(pageStr, limitStr);

  const filter: Record<string, unknown> = { recipientId: userId };
  if (type && type !== "all") {
    filter.type = type;
  }

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where: filter as any,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.notification.count({ where: filter as any }),
  ]);

  const mapped = notifications.map((n) =>
    mapNotification(n as unknown as Record<string, unknown>),
  );

  const pagination = buildPaginationMeta(page, limit, total);

  return { notifications: mapped, pagination };
}

export async function getUnreadCount(userId: string): Promise<number> {
  return prisma.notification.count({
    where: {
      recipientId: userId,
      isRead: false,
    },
  });
}

export async function markAsRead(
  userId: string,
  notificationId: string,
): Promise<NotificationItem> {
  const existing = await prisma.notification.findFirst({
    where: { id: notificationId, recipientId: userId },
  });

  if (!existing) {
    throw new NotFoundError("Notification not found.");
  }

  const updated = await prisma.notification.update({
    where: { id: notificationId },
    data: { isRead: true, readAt: new Date() },
  });

  return mapNotification(updated as unknown as Record<string, unknown>);
}

export async function markAllAsRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: {
      recipientId: userId,
      isRead: false,
    },
    data: {
      isRead: true,
      readAt: new Date(),
    },
  });
}

export async function deleteNotification(
  userId: string,
  notificationId: string,
): Promise<void> {
  const existing = await prisma.notification.findFirst({
    where: { id: notificationId, recipientId: userId },
  });

  if (!existing) {
    throw new NotFoundError("Notification not found.");
  }

  await prisma.notification.delete({ where: { id: notificationId } });
}

export async function deleteAllNotifications(userId: string): Promise<void> {
  await prisma.notification.deleteMany({
    where: { recipientId: userId },
  });
}