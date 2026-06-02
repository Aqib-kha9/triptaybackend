import type { Response, NextFunction } from "express";
import { Conversation } from "../models/Conversation.js";
import { Message } from "../models/Message.js";
import { Listing } from "../models/Listing.js";
import { Activity } from "../models/Activity.js";

// ──────────────────────── Helper: Get booking context ────────────────────────

const resolveBookingContext = async (
  listingId: string | null,
  activityId: string | null
): Promise<{ title: string; dateRange: string; type: "listing" | "activity" } | null> => {
  if (listingId) {
    const listing = await Listing.findById(listingId).select("name").lean();
    if (listing) return { title: listing.name, dateRange: "", type: "listing" };
  }
  if (activityId) {
    const activity = await Activity.findById(activityId).select("name").lean();
    if (activity) return { title: activity.name, dateRange: "", type: "activity" };
  }
  return null;
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

    let conversation = await Conversation.findOne({
      participants: { $all: participants, $size: 2 },
      listingId: listingId || null,
      activityId: activityId || null,
    });

    if (!conversation) {
      const ctx = bookingContext || (await resolveBookingContext(listingId || null, activityId || null));

      conversation = await Conversation.create({
        participants,
        listingId: listingId || null,
        activityId: activityId || null,
        bookingContext: ctx,
        unreadCount: { [participantId]: 0, [userId]: 0 },
      });

      // Populate participants
      await conversation.populate("participants", "name email");
    }

    res.status(200).json({ status: "success", data: conversation });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── Get My Conversations ────────────────────────

export const getMyConversations = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user._id || req.user.id;

    const conversations = await Conversation.find({
      participants: userId,
      isActive: true,
    })
      .populate("participants", "name email")
      .sort({ updatedAt: -1 })
      .lean();

    // Format for frontend: include the other participant's info
    const formatted = conversations.map((c: any) => {
      const otherParticipant = c.participants.find(
        (p: any) => p._id.toString() !== userId.toString()
      );

      return {
        _id: c._id,
        otherUser: otherParticipant
          ? { _id: otherParticipant._id, name: otherParticipant.name, email: otherParticipant.email }
          : null,
        listingId: c.listingId,
        activityId: c.activityId,
        bookingContext: c.bookingContext,
        lastMessage: c.lastMessage,
        unreadCount: c.unreadCount?.[userId] || 0,
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
    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: userId,
    });

    if (!conversation) {
      res.status(404).json({ status: "fail", message: "Conversation not found." });
      return;
    }

    const messages = await Message.find({ conversation: conversationId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("sender", "name email")
      .lean();

    const total = await Message.countDocuments({ conversation: conversationId });

    // Mark unread messages as read
    await Message.updateMany(
      { conversation: conversationId, sender: { $ne: userId }, isRead: false },
      { isRead: true, readAt: new Date() }
    );

    // Reset unread count for this user
    conversation.unreadCount.set(userId.toString(), 0);
    await conversation.save();

    res.status(200).json({
      status: "success",
      page,
      totalPages: Math.ceil(total / limit),
      total,
      data: messages.reverse(), // Send in chronological order
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

    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: userId,
      isActive: true,
    });

    if (!conversation) {
      res.status(404).json({ status: "fail", message: "Conversation not found or inactive." });
      return;
    }

    const message = await Message.create({
      conversation: conversationId,
      sender: userId,
      type,
      text: text || "",
      mediaUrl: mediaUrl || null,
      mediaType: mediaType || null,
      fileName: fileName || null,
      fileSize: fileSize || null,
    });

    // Update conversation's last message
    conversation.lastMessage = {
      text: text || (type === "image" ? "📷 Image" : type === "file" ? "📎 File" : ""),
      sender: userId,
      sentAt: new Date(),
    };

    // Increment unread count for other participant
    const otherParticipant = conversation.participants.find(
      (p: any) => p.toString() !== userId.toString()
    );
    if (otherParticipant) {
      const current = conversation.unreadCount.get(otherParticipant.toString()) || 0;
      conversation.unreadCount.set(otherParticipant.toString(), current + 1);
    }

    await conversation.save();

    await message.populate("sender", "name email");

    res.status(201).json({ status: "success", data: message });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── Mark Conversation as Read ────────────────────────

export const markConversationRead = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user._id || req.user.id;
    const { conversationId } = req.params;

    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: userId,
    });

    if (!conversation) {
      res.status(404).json({ status: "fail", message: "Conversation not found." });
      return;
    }

    await Message.updateMany(
      { conversation: conversationId, sender: { $ne: userId }, isRead: false },
      { isRead: true, readAt: new Date() }
    );

    conversation.unreadCount.set(userId.toString(), 0);
    await conversation.save();

    res.status(200).json({ status: "success", message: "Conversation marked as read." });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── Get Total Unread Count ────────────────────────

export const getUnreadCount = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user._id || req.user.id;

    const conversations = await Conversation.find({
      participants: userId,
      isActive: true,
    }).lean();

    let total = 0;
    for (const c of conversations) {
      total += (c.unreadCount as any)?.[userId.toString()] || 0;
    }

    res.status(200).json({ status: "success", data: { unreadCount: total } });
  } catch (error) {
    next(error);
  }
};