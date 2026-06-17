import type { Response, NextFunction } from "express";
import { prisma } from "../config/db.js";

// ──────────────────────── Helper: Get booking context ────────────────────────

const resolveBookingContext = async (
  listingId: string | null,
  activityId: string | null
): Promise<{ title: string; dateRange: string; type: "listing" | "activity" } | null> => {
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
};

const formatSingleConversation = async (c: any) => {
  const users = await prisma.user.findMany({
    where: { id: { in: c.participants } },
    select: { id: true, name: true, email: true }
  });
  const populatedParticipants = users.map(u => ({
    _id: u.id,
    name: u.name,
    email: u.email
  }));

  const unreadObj = c.unreadCount && typeof c.unreadCount === "object" ? c.unreadCount : {};

  return {
    _id: c.id,
    participants: populatedParticipants,
    listingId: c.listingId,
    activityId: c.activityId,
    bookingContext: c.bookingTitle ? {
      title: c.bookingTitle,
      dateRange: c.bookingDateRange || "",
      type: c.bookingType
    } : null,
    lastMessage: c.lastMessageText ? {
      text: c.lastMessageText,
      sender: c.lastMessageSenderId,
      sentAt: c.lastMessageSentAt
    } : null,
    unreadCount: unreadObj,
    isActive: c.isActive,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt
  };
};

// ──────────────────────── Get or Create Conversation ────────────────────────

export const getOrCreateConversation = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user._id || req.user.id;
    const { participantId, listingId, activityId, bookingContext } = req.body;

    if (!participantId) {
      res.status(400).json({ status: "fail", message: "participantId is required." });
      return;
    }

    if (userId === participantId) {
      res.status(400).json({ status: "fail", message: "Cannot start a conversation with yourself." });
      return;
    }

    // Sort IDs for deterministic participant array
    const participants = [userId, participantId].sort();

    let conversation = await prisma.conversation.findFirst({
      where: {
        participants: { equals: participants },
        listingId: listingId || null,
        activityId: activityId || null,
      }
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
        }
      });
    }

    const formatted = await formatSingleConversation(conversation);

    res.status(200).json({ status: "success", data: formatted });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── Get My Conversations ────────────────────────

export const getMyConversations = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user._id || req.user.id;

    const conversations = await prisma.conversation.findMany({
      where: {
        participants: { has: userId },
        isActive: true,
      },
      orderBy: { updatedAt: "desc" },
    });

    // Format for frontend: include the other participant's info
    const userIds = Array.from(new Set(conversations.flatMap((c) => c.participants)));
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    });
    const userMap = new Map(users.map((u) => [u.id, { _id: u.id, name: u.name, email: u.email }]));

    const formatted = conversations.map((c: any) => {
      const populatedParticipants = c.participants.map((pid: string) => userMap.get(pid)).filter(Boolean);
      const otherParticipant = populatedParticipants.find(
        (p: any) => p._id.toString() !== userId.toString()
      );

      const unreadObj = c.unreadCount && typeof c.unreadCount === "object" ? c.unreadCount : {};
      const unreadCount = unreadObj[userId] || 0;

      return {
        _id: c.id,
        otherUser: otherParticipant
          ? { _id: otherParticipant._id, name: otherParticipant.name, email: otherParticipant.email }
          : null,
        listingId: c.listingId,
        activityId: c.activityId,
        bookingContext: c.bookingTitle ? {
          title: c.bookingTitle,
          dateRange: c.bookingDateRange || "",
          type: c.bookingType
        } : null,
        lastMessage: c.lastMessageText ? {
          text: c.lastMessageText,
          sender: c.lastMessageSenderId,
          sentAt: c.lastMessageSentAt
        } : null,
        unreadCount,
        updatedAt: c.updatedAt,
      };
    });

    res.status(200).json({ status: "success", count: formatted.length, data: formatted });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── Get Messages for a Conversation ────────────────────────

export const getMessages = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user._id || req.user.id;
    const { conversationId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 50);
    const skip = (page - 1) * limit;

    // Verify user is a participant
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        participants: { has: userId },
      }
    });

    if (!conversation) {
      res.status(404).json({ status: "fail", message: "Conversation not found." });
      return;
    }

    const messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    });

    const senderIds = Array.from(new Set(messages.map((m) => m.senderId)));
    const senders = await prisma.user.findMany({
      where: { id: { in: senderIds } },
      select: { id: true, name: true, email: true },
    });
    const senderMap = new Map(senders.map((s) => [s.id, { _id: s.id, name: s.name, email: s.email }]));

    const formattedMessages = messages.map((m) => ({
      _id: m.id,
      conversation: m.conversationId,
      sender: senderMap.get(m.senderId) || null,
      type: m.type,
      text: m.text,
      mediaUrl: m.mediaUrl,
      mediaType: m.mediaType,
      fileName: m.fileName,
      fileSize: m.fileSize,
      isRead: m.isRead,
      readAt: m.readAt,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    }));

    const total = await prisma.message.count({ where: { conversationId } });

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
    const unreadObj = (conversation.unreadCount && typeof conversation.unreadCount === "object"
      ? { ...conversation.unreadCount }
      : {}) as any;
    unreadObj[userId] = 0;

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { unreadCount: unreadObj },
    });

    res.status(200).json({
      status: "success",
      page,
      totalPages: Math.ceil(total / limit),
      total,
      data: formattedMessages.reverse(), // Send in chronological order
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── Send Message (REST fallback) ────────────────────────

export const sendMessage = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user._id || req.user.id;
    const { conversationId } = req.params;
    const { text, type = "text", mediaUrl, mediaType, fileName, fileSize } = req.body;

    if (!text && type === "text") {
      res.status(400).json({ status: "fail", message: "Message text is required." });
      return;
    }

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        participants: { has: userId },
        isActive: true,
      }
    });

    if (!conversation) {
      res.status(404).json({ status: "fail", message: "Conversation not found or inactive." });
      return;
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
      }
    });

    // Increment unread count for other participant
    const otherParticipant = conversation.participants.find(
      (p: any) => p.toString() !== userId.toString()
    );
    const unreadObj = (conversation.unreadCount && typeof conversation.unreadCount === "object"
      ? { ...conversation.unreadCount }
      : {}) as any;
    if (otherParticipant) {
      const current = unreadObj[otherParticipant] || 0;
      unreadObj[otherParticipant] = current + 1;
    }

    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageText: text || (type === "image" ? "📷 Image" : type === "file" ? "📎 File" : ""),
        lastMessageSenderId: userId,
        lastMessageSentAt: new Date(),
        unreadCount: unreadObj,
      }
    });

    const sender = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    });

    const formattedMessage = {
      _id: message.id,
      conversation: message.conversationId,
      sender: sender ? { _id: sender.id, name: sender.name, email: sender.email } : null,
      type: message.type,
      text: message.text,
      mediaUrl: message.mediaUrl,
      mediaType: message.mediaType,
      fileName: message.fileName,
      fileSize: message.fileSize,
      isRead: message.isRead,
      readAt: message.readAt,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    };

    res.status(201).json({ status: "success", data: formattedMessage });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── Mark Conversation as Read ────────────────────────

export const markConversationRead = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user._id || req.user.id;
    const { conversationId } = req.params;

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        participants: { has: userId },
      }
    });

    if (!conversation) {
      res.status(404).json({ status: "fail", message: "Conversation not found." });
      return;
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
      }
    });

    const unreadObj = (conversation.unreadCount && typeof conversation.unreadCount === "object"
      ? { ...conversation.unreadCount }
      : {}) as any;
    unreadObj[userId] = 0;

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { unreadCount: unreadObj },
    });

    res.status(200).json({ status: "success", message: "Conversation marked as read." });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── Get Total Unread Count ────────────────────────

export const getUnreadCount = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user._id || req.user.id;

    const conversations = await prisma.conversation.findMany({
      where: {
        participants: { has: userId },
        isActive: true,
      }
    });

    let total = 0;
    for (const c of conversations) {
      const unreadObj = (c.unreadCount && typeof c.unreadCount === "object" ? c.unreadCount : {}) as any;
      total += unreadObj[userId] || 0;
    }

    res.status(200).json({ status: "success", data: { unreadCount: total } });
  } catch (error) {
    next(error);
  }
};