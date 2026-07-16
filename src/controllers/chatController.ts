import type { Response, NextFunction } from "express";
import * as chatService from "../services/chat.service.js";

// ──────────────────────── Controllers ────────────────────────

// @desc    Get or create a conversation
// @route   POST /api/chat/conversations
// @access  Private
export const getOrCreateConversation = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { participantId, listingId, activityId, bookingContext } = req.body;
    const conversation = await chatService.getOrCreateConversation(
      req.user.id,
      participantId,
      listingId || null,
      activityId || null,
      bookingContext || null,
    );

    res.status(200).json({
      status: "success",
      data: { conversation },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all conversations for current user
// @route   GET /api/chat/conversations
// @access  Private
export const getMyConversations = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const conversations = await chatService.getMyConversations(req.user.id);

    res.status(200).json({
      status: "success",
      results: conversations.length,
      data: { conversations },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get messages for a conversation
// @route   GET /api/chat/conversations/:id/messages
// @access  Private
export const getMessages = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 30));

    const result = await chatService.getMessages(req.user.id, req.params.id, page, limit);

    res.status(200).json({
      status: "success",
      results: result.messages.length,
      page: result.page,
      totalPages: result.totalPages,
      total: result.total,
      data: {
        messages: result.messages,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Send a message
// @route   POST /api/chat/conversations/:id/messages
// @access  Private
export const sendMessage = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const message = await chatService.sendMessage(req.user.id, req.params.id, req.body);

    res.status(201).json({
      status: "success",
      data: { message },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Mark conversation as read
// @route   PATCH /api/chat/conversations/:id/read
// @access  Private
export const markConversationRead = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    await chatService.markConversationRead(req.user.id, req.params.id);

    res.status(200).json({
      status: "success",
      message: "Conversation marked as read.",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get unread message count
// @route   GET /api/chat/unread-count
// @access  Private
export const getUnreadCount = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const count = await chatService.getUnreadCount(req.user.id);

    res.status(200).json({
      status: "success",
      data: { unreadCount: count },
    });
  } catch (error) {
    next(error);
  }
};