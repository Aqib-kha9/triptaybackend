import { prisma } from "../config/db.js";
import { BadRequestError, NotFoundError, ForbiddenError } from "../core/errors.js";
import { logger } from "../core/logger.js";

// ──────────────────────── Types ────────────────────────

export interface ChatParticipant {
  _id: string;
  name: string;
  email: string;
  avatar?: string | null;
}

export interface BookingContext {
  title: string;
  dateRange: string;
  type: "listing" | "activity";
}

export interface LastMessageInfo {
  text: string;
  sender: string;
  sentAt: Date;
}

export interface FormattedConversation {
  _id: string;
  otherUser: ChatParticipant | null;
  listingId: string | null;
  activityId: string | null;
  bookingContext: BookingContext | null;
  lastMessage: LastMessageInfo | null;
  unreadCount: number;
  updatedAt: Date;
}

export interface FormattedMessage {
  _id: string;
  conversation: string;
  sender: ChatParticipant | null;
  type: string;
  text: string;
  mediaUrl: string | null;
  mediaType: string | null;
  fileName: string | null;
  fileSize: number | null;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SendMessageInput {
  text?: string;
  type?: string;
  mediaUrl?: string;
  mediaType?: string;
  fileName?: string;
  fileSize?: number;
}

// ──────────────────────── Helpers ────────────────────────

async function resolveBookingContext(
  listingId: string | null,
  activityId: string | null,
): Promise<{ title: string; dateRange: string; type: "listing" | "activity" } | null> {
  if (listingId) {
    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      select: { name: true },
    });
    if (listing) return { title: listing.name, dateRange: "", type: "listing" };
  }
  if (activityId) {
    const activity = await prisma.activity.findUnique({
      where: { id: activityId },
      select: { name: true },
    });
    if (activity) return { title: activity.name, dateRange: "", type: "activity" };
  }
  return null;
}

async function fetchParticipants(ids: string[]): Promise<Map<string, ChatParticipant>> {
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, email: true, avatar: true },
  });
  return new Map(users.map((u) => [u.id, { _id: u.id, name: u.name, email: u.email, avatar: u.avatar }]));
}

function formatSingleConversation(
  c: Record<string, unknown>,
  participants: ChatParticipant[],
): Record<string, unknown> {
  const unreadObj = (c.unreadCount && typeof c.unreadCount === "object" ? c.unreadCount : {}) as Record<string, number>;

  return {
    _id: c.id,
    participants,
    listingId: c.listingId,
    activityId: c.activityId,
    bookingContext: c.bookingTitle
      ? { title: c.bookingTitle, dateRange: (c.bookingDateRange as string) || "", type: c.bookingType }
      : null,
    lastMessage: c.lastMessageText
      ? { text: c.lastMessageText, sender: c.lastMessageSenderId, sentAt: c.lastMessageSentAt }
      : null,
    unreadCount: unreadObj,
    isActive: c.isActive,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function mapMessage(
  m: Record<string, unknown>,
  senderMap: Map<string, ChatParticipant>,
): FormattedMessage {
  return {
    _id: m.id as string,
    conversation: m.conversationId as string,
    sender: senderMap.get(m.senderId as string) || null,
    type: m.type as string,
    text: m.text as string,
    mediaUrl: (m.mediaUrl as string) || null,
    mediaType: (m.mediaType as string) || null,
    fileName: (m.fileName as string) || null,
    fileSize: (m.fileSize as number) || null,
    isRead: m.isRead as boolean,
    readAt: (m.readAt as Date) || null,
    createdAt: m.createdAt as Date,
    updatedAt: m.updatedAt as Date,
  };
}

// ──────────────────────── Service Functions ────────────────────────

export async function getOrCreateConversation(
  userId: string,
  participantId: string,
  listingId?: string | null,
  activityId?: string | null,
  bookingContext?: { title: string; dateRange: string; type: string } | null,
) {
  if (!participantId) {
    throw new BadRequestError("participantId is required.");
  }

  if (userId === participantId) {
    throw new BadRequestError("Cannot start a conversation with yourself.");
  }

  const participants = [userId, participantId].sort();

  let conversation = await prisma.conversation.findFirst({
    where: {
      participants: { equals: participants },
      listingId: listingId || null,
      activityId: activityId || null,
    },
  });

  if (!conversation) {
    const ctx = bookingContext || (await resolveBookingContext(listingId || null, activityId || null));

    conversation = await prisma.conversation.create({
      data: {
        participants,
        listingId: listingId || null,
        activityId: activityId || null,
        bookingTitle: ctx?.title || null,
        bookingDateRange: ctx?.dateRange || null,
        bookingType: ctx?.type || null,
        unreadCount: { [participantId]: 0, [userId]: 0 },
      },
    });
  }

  const participantUsers = await fetchParticipants(conversation.participants);
  const populatedParticipants = conversation.participants
    .map((pid) => participantUsers.get(pid))
    .filter(Boolean);

  return formatSingleConversation(
    conversation as unknown as Record<string, unknown>,
    populatedParticipants as ChatParticipant[],
  );
}

export async function getMyConversations(userId: string): Promise<FormattedConversation[]> {
  const conversations = await prisma.conversation.findMany({
    where: {
      participants: { has: userId },
      isActive: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  const userIds = Array.from(new Set(conversations.flatMap((c) => c.participants)));
  const userMap = await fetchParticipants(userIds);

  return conversations.map((c: any) => {
    const populatedParticipants = c.participants
      .map((pid: string) => userMap.get(pid))
      .filter(Boolean);

    const otherParticipant = populatedParticipants.find(
      (p: any) => p._id.toString() !== userId.toString(),
    );

    const unreadObj = (c.unreadCount && typeof c.unreadCount === "object" ? c.unreadCount : {}) as Record<string, number>;
    const unreadCount = unreadObj[userId] || 0;

    return {
      _id: c.id,
      otherUser: otherParticipant
        ? { _id: otherParticipant._id, name: otherParticipant.name, email: otherParticipant.email, avatar: otherParticipant.avatar }
        : null,
      listingId: c.listingId,
      activityId: c.activityId,
      bookingContext: c.bookingTitle
        ? {
            title: c.bookingTitle,
            dateRange: c.bookingDateRange || "",
            type: c.bookingType,
          }
        : null,
      lastMessage: c.lastMessageText
        ? {
            text: c.lastMessageText,
            sender: c.lastMessageSenderId,
            sentAt: c.lastMessageSentAt,
          }
        : null,
      unreadCount,
      updatedAt: c.updatedAt,
    };
  });
}

export async function getMessages(
  userId: string,
  conversationId: string,
  page: number,
  limit: number,
) {
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      participants: { has: userId },
    },
  });

  if (!conversation) {
    throw new NotFoundError("Conversation not found.");
  }

  const skip = (page - 1) * limit;
  const [messages, total] = await Promise.all([
    prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.message.count({ where: { conversationId } }),
  ]);

  const senderIds = Array.from(new Set(messages.map((m) => m.senderId)));
  const senders = await fetchParticipants(senderIds);

  const formattedMessages = messages.map((m) =>
    mapMessage(m as unknown as Record<string, unknown>, senders),
  );

  // Mark unread messages as read
  await prisma.message.updateMany({
    where: {
      conversationId,
      senderId: { not: userId },
      isRead: false,
    },
    data: {
      isRead: true,
      readAt: new Date(),
    },
  });

  // Reset unread count for this user
  const unreadObj = (
    conversation.unreadCount && typeof conversation.unreadCount === "object"
      ? { ...conversation.unreadCount }
      : {}
  ) as Record<string, number>;
  unreadObj[userId] = 0;

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { unreadCount: unreadObj },
  });

  return {
    messages: formattedMessages.reverse(), // chronological order
    page,
    totalPages: Math.ceil(total / limit),
    total,
  };
}

export async function sendMessage(
  userId: string,
  conversationId: string,
  data: SendMessageInput,
): Promise<FormattedMessage> {
  const { text, type = "text", mediaUrl, mediaType, fileName, fileSize } = data;

  if (!text && type === "text") {
    throw new BadRequestError("Message text is required.");
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      participants: { has: userId },
      isActive: true,
    },
  });

  if (!conversation) {
    throw new NotFoundError("Conversation not found or inactive.");
  }

  const message = await prisma.message.create({
    data: {
      conversationId,
      senderId: userId,
      type,
      text: text || "",
      mediaUrl: mediaUrl || null,
      mediaType: mediaType || null,
      fileName: fileName || null,
      fileSize: fileSize !== undefined ? Number(fileSize) : null,
    },
  });

  // Increment unread count for other participant
  const otherParticipant = conversation.participants.find(
    (p: string) => p.toString() !== userId.toString(),
  );
  const unreadObj = (
    conversation.unreadCount && typeof conversation.unreadCount === "object"
      ? { ...conversation.unreadCount }
      : {}
  ) as Record<string, number>;
  if (otherParticipant) {
    unreadObj[otherParticipant] = (unreadObj[otherParticipant] || 0) + 1;
  }

  const lastMsgText =
    text ||
    (type === "image" ? "📷 Image" : type === "file" ? "📎 File" : "");

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      lastMessageText: lastMsgText,
      lastMessageSenderId: userId,
      lastMessageSentAt: new Date(),
      unreadCount: unreadObj,
    },
  });

  const sender = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true },
  });

  return mapMessage(message as unknown as Record<string, unknown>, new Map(
    sender ? [[sender.id, { _id: sender.id, name: sender.name, email: sender.email }]] : [],
  ));
}

export async function markConversationRead(
  userId: string,
  conversationId: string,
): Promise<void> {
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      participants: { has: userId },
    },
  });

  if (!conversation) {
    throw new NotFoundError("Conversation not found.");
  }

  await prisma.message.updateMany({
    where: {
      conversationId,
      senderId: { not: userId },
      isRead: false,
    },
    data: {
      isRead: true,
      readAt: new Date(),
    },
  });

  const unreadObj = (
    conversation.unreadCount && typeof conversation.unreadCount === "object"
      ? { ...conversation.unreadCount }
      : {}
  ) as Record<string, number>;
  unreadObj[userId] = 0;

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { unreadCount: unreadObj },
  });
}

export async function getUnreadCount(userId: string): Promise<number> {
  const conversations = await prisma.conversation.findMany({
    where: {
      participants: { has: userId },
      isActive: true,
    },
  });

  let total = 0;
  for (const c of conversations) {
    const unreadObj = (
      c.unreadCount && typeof c.unreadCount === "object" ? c.unreadCount : {}
    ) as Record<string, number>;
    total += unreadObj[userId] || 0;
  }

  return total;
}