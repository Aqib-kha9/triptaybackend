import { Server as SocketIOServer } from "socket.io";
import type { Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { prisma } from "../config/db.js";
import { config } from "../core/config.js";
import { logger } from "../core/logger.js";

// ──────────────────────── Types ────────────────────────

interface SendMessagePayload {
  conversationId: string;
  text?: string;
  type?: "text" | "image" | "file" | "system";
  mediaUrl?: string;
  mediaType?: string;
  fileName?: string;
  fileSize?: number;
}

interface AckCallback {
  (response: { ok: boolean; data?: unknown; error?: string }): void;
}

// ──────────────────────── Online Users Tracker ────────────────────────

const onlineUsers = new Map<string, Set<string>>();

// ──────────────────────── Socket.IO Setup ────────────────────────

export function createSocketServer(httpServer: import("http").Server): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: config.cors.allowedOrigins,
      methods: ["GET", "POST"],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    connectTimeout: 45000,
  });

  // ── Auth Middleware ──
  io.use(async (socket: Socket, next) => {
    try {
      const token = socket.handshake.auth.token;

      if (!token) {
        return next(new Error("Authentication required: no token provided."));
      }

      const decoded = jwt.verify(token, config.jwt.secret) as {
        id: string;
        email: string;
        role: string;
      };

      socket.data.userId = decoded.id;
      socket.data.userRole = decoded.role;
      next();
    } catch {
      next(new Error("Authentication failed: invalid token."));
    }
  });

  // ── Connection Handler ──
  io.on("connection", (socket: Socket) => {
    handleConnection(io, socket);
  });

  return io;
}

// ──────────────────────── Connection Handler ────────────────────────

function handleConnection(io: SocketIOServer, socket: Socket): void {
  const userId = socket.data.userId as string;
  const userRole = socket.data.userRole as string;

  logger.info(`Socket connected: ${userId} (${socket.id})`);
  
  // Join a private room for this user
  socket.join(userId);

  if (userRole === "Admin" || userRole === "admin") {
    socket.join("admin-room");
  }

  // Track online status
  if (!onlineUsers.has(userId)) {
    onlineUsers.set(userId, new Set());
  }
  onlineUsers.get(userId)!.add(socket.id);

  // Broadcast online status to conversation participants
  socket.broadcast.emit("user:online", { userId });

  // Send list of currently online users to the newly connected socket
  socket.emit("users:online", Array.from(onlineUsers.keys()));

  // ── Event Handlers ──

  socket.on("conversation:join", (conversationId: string) => {
    socket.join(conversationId);
    logger.debug(`User ${userId} joined room: ${conversationId}`);
  });

  socket.on("conversation:leave", (conversationId: string) => {
    socket.leave(conversationId);
    logger.debug(`User ${userId} left room: ${conversationId}`);
  });

  socket.on("message:send", (data: SendMessagePayload, callback: AckCallback) => {
    handleSendMessage(io, socket, data, callback);
  });

  socket.on("typing:start", (conversationId: string) => {
    socket.to(conversationId).emit("typing:update", { conversationId, userId, isTyping: true });
  });

  socket.on("typing:stop", (conversationId: string) => {
    socket.to(conversationId).emit("typing:update", { conversationId, userId, isTyping: false });
  });

  socket.on("messages:read", (conversationId: string) => {
    handleMessagesRead(io, socket, conversationId);
  });

  socket.on("disconnect", () => {
    handleDisconnect(io, socket);
  });
}

// ──────────────────────── Message Handler ────────────────────────

async function handleSendMessage(
  io: SocketIOServer,
  socket: Socket,
  data: SendMessagePayload,
  callback: AckCallback,
): Promise<void> {
  try {
    const userId = socket.data.userId as string;
    const { conversationId, text, type = "text", mediaUrl, mediaType, fileName, fileSize } = data;

    if (!text && type === "text") {
      callback({ ok: false, error: "Message text is required." });
      return;
    }

    // Verify user is participant
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        participants: { has: userId },
        isActive: true,
      },
    });

    if (!conversation) {
      callback({ ok: false, error: "Conversation not found or inactive." });
      return;
    }

    // Create message
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

    const sender = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    });

    const populatedMessage = {
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

    // Update conversation metadata
    const displayText = text || (type === "image" ? "📷 Image" : type === "file" ? "📎 File" : "");

    const unreadObj = (
      conversation.unreadCount && typeof conversation.unreadCount === "object"
        ? { ...conversation.unreadCount }
        : {}
    ) as Record<string, number>;

    const otherParticipant = conversation.participants.find(
      (p: string) => p.toString() !== userId.toString(),
    );
    if (otherParticipant) {
      unreadObj[otherParticipant] = (unreadObj[otherParticipant] || 0) + 1;
    }

    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageText: displayText,
        lastMessageSenderId: userId,
        lastMessageSentAt: new Date(),
        unreadCount: unreadObj,
      },
    });

    // Emit to the conversation room
    io.to(conversationId).emit("message:new", { message: populatedMessage });

    callback({ ok: true, data: populatedMessage });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Socket message:send error:", { error: message });
    callback({ ok: false, error: "Failed to send message." });
  }
}

// ──────────────────────── Messages Read Handler ────────────────────────

async function handleMessagesRead(
  io: SocketIOServer,
  socket: Socket,
  conversationId: string,
): Promise<void> {
  try {
    const userId = socket.data.userId as string;

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

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (conversation) {
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

    socket.to(conversationId).emit("messages:read", { conversationId, readBy: userId });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Socket messages:read error:", { error: message });
  }
}

// ──────────────────────── Disconnect Handler ────────────────────────

function handleDisconnect(io: SocketIOServer, socket: Socket): void {
  const userId = socket.data.userId as string;

  logger.info(`Socket disconnected: ${userId} (${socket.id})`);

  const sockets = onlineUsers.get(userId);
  if (sockets) {
    sockets.delete(socket.id);
    if (sockets.size === 0) {
      onlineUsers.delete(userId);
      socket.broadcast.emit("user:offline", { userId });
    }
  }
}