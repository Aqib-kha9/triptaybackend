import dotenv from "dotenv";
dotenv.config();

import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import type { Socket } from "socket.io";
import jwt from "jsonwebtoken";
import app from "./app.js";
import { connectDB, prisma } from "./config/db.js";

const PORT = process.env.PORT || 5000;

// ──────────────────────── Create HTTP Server ────────────────────────

const httpServer = createServer(app);

// ──────────────────────── Socket.IO Setup ────────────────────────

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: [
      process.env.CLIENT_URL || "http://localhost:3001",
      "http://localhost:3000",
      "http://192.168.31.191:3000",
    ],
    methods: ["GET", "POST"],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  connectTimeout: 45000,
});

// ──────────────────────── Auth Middleware for Socket.IO ────────────────────────

io.use(async (socket: Socket, next) => {
  try {
    const token = socket.handshake.auth.token;

    if (!token) {
      return next(new Error("Authentication required: no token provided."));
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "super_secret_triptay_key_2026"
    ) as { id: string; email: string; role: string };

    socket.data.userId = decoded.id;
    socket.data.userRole = decoded.role;
    next();
  } catch (err: any) {
    next(new Error("Authentication failed: invalid token."));
  }
});

// ──────────────────────── Connection Handler ────────────────────────

// Track online users: userId -> Set<socketId>
const onlineUsers = new Map<string, Set<string>>();

io.on("connection", (socket: Socket) => {
  const userId = socket.data.userId;

  console.log(`[Socket.IO] User connected: ${userId} (${socket.id})`);

  // Track online status
  if (!onlineUsers.has(userId)) {
    onlineUsers.set(userId, new Set());
  }
  onlineUsers.get(userId)!.add(socket.id);

  // Broadcast online status to conversation participants
  socket.broadcast.emit("user:online", { userId });

  // ──────────────────────── Join Conversation Room ────────────────────────

  socket.on("conversation:join", (conversationId: string) => {
    socket.join(conversationId);
    console.log(`[Socket.IO] User ${userId} joined room: ${conversationId}`);
  });

  socket.on("conversation:leave", (conversationId: string) => {
    socket.leave(conversationId);
    console.log(`[Socket.IO] User ${userId} left room: ${conversationId}`);
  });

  // ──────────────────────── Send Message ────────────────────────

  socket.on(
    "message:send",
    async (
      data: {
        conversationId: string;
        text?: string;
        type?: "text" | "image" | "file" | "system";
        mediaUrl?: string;
        mediaType?: string;
        fileName?: string;
        fileSize?: number;
      },
      callback: (response: { ok: boolean; data?: any; error?: string }) => void
    ) => {
      try {
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
          }
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
          }
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

        // Update conversation
        const displayText = text || (type === "image" ? "📷 Image" : type === "file" ? "📎 File" : "");

        const unreadObj = (conversation.unreadCount && typeof conversation.unreadCount === "object"
          ? { ...conversation.unreadCount }
          : {}) as any;
        const otherParticipant = conversation.participants.find(
          (p: any) => p.toString() !== userId.toString()
        );
        if (otherParticipant) {
          const current = unreadObj[otherParticipant] || 0;
          unreadObj[otherParticipant] = current + 1;
        }

        await prisma.conversation.update({
          where: { id: conversationId },
          data: {
            lastMessageText: displayText,
            lastMessageSenderId: userId,
            lastMessageSentAt: new Date(),
            unreadCount: unreadObj,
          }
        });

        // Emit to the conversation room
        io.to(conversationId).emit("message:new", { message: populatedMessage });

        callback({ ok: true, data: populatedMessage });
      } catch (error: any) {
        console.error("[Socket.IO] message:send error:", error.message);
        callback({ ok: false, error: "Failed to send message." });
      }
    }
  );

  // ──────────────────────── Typing Indicators ────────────────────────

  socket.on("typing:start", (conversationId: string) => {
    socket.to(conversationId).emit("typing:update", { conversationId, userId, isTyping: true });
  });

  socket.on("typing:stop", (conversationId: string) => {
    socket.to(conversationId).emit("typing:update", { conversationId, userId, isTyping: false });
  });

  // ──────────────────────── Mark as Read ────────────────────────

  socket.on("messages:read", async (conversationId: string) => {
    try {
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

      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId }
      });
      if (conversation) {
        const unreadObj = (conversation.unreadCount && typeof conversation.unreadCount === "object"
          ? { ...conversation.unreadCount }
          : {}) as any;
        unreadObj[userId] = 0;
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { unreadCount: unreadObj }
        });
      }

      socket.to(conversationId).emit("messages:read", { conversationId, readBy: userId });
    } catch (error: any) {
      console.error("[Socket.IO] messages:read error:", error.message);
    }
  });

  // ──────────────────────── Disconnect ────────────────────────

  socket.on("disconnect", () => {
    console.log(`[Socket.IO] User disconnected: ${userId} (${socket.id})`);

    const sockets = onlineUsers.get(userId);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        onlineUsers.delete(userId);
        socket.broadcast.emit("user:offline", { userId });
      }
    }
  });
});

// ──────────────────────── Start Server ────────────────────────

const startServer = async () => {
  await connectDB();

  httpServer.listen(PORT, () => {
    console.log(`🚀 Server running in production-ready mode on port ${PORT}`);
    console.log(`🔌 Socket.IO ready for real-time communication`);
  });
};

startServer();

export { io };

