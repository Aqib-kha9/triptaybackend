import dotenv from "dotenv";
dotenv.config();

import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import type { Socket } from "socket.io";
import jwt from "jsonwebtoken";
import app from "./app.js";
import { connectDB } from "./config/db.js";
import { Message } from "./models/Message.js";
import { Conversation } from "./models/Conversation.js";

const PORT = process.env.PORT || 5000;

// ──────────────────────── Create HTTP Server ────────────────────────

const httpServer = createServer(app);

// ──────────────────────── Socket.IO Setup ────────────────────────

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: [
      process.env.CLIENT_URL || "http://localhost:3001",
      "http://localhost:3000",
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
        const conversation = await Conversation.findOne({
          _id: conversationId,
          participants: userId,
          isActive: true,
        });

        if (!conversation) {
          callback({ ok: false, error: "Conversation not found or inactive." });
          return;
        }

        // Create message
        const message = await (Message.create as any)({
          conversation: conversationId,
          sender: userId,
          type,
          text: text || "",
          mediaUrl: mediaUrl || undefined,
          mediaType: mediaType || undefined,
          fileName: fileName || undefined,
          fileSize: fileSize || undefined,
        });

        await (message as any).populate("sender", "name email");

        // Update conversation
        const displayText = text || (type === "image" ? "📷 Image" : type === "file" ? "📎 File" : "");

        conversation.lastMessage = {
          text: displayText,
          sender: userId as any,
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

        // Emit to the conversation room
        io.to(conversationId).emit("message:new", { message });

        callback({ ok: true, data: message });
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
      await Message.updateMany(
        { conversation: conversationId, sender: { $ne: userId }, isRead: false } as any,
        { isRead: true, readAt: new Date() }
      );

      const conversation = await Conversation.findById(conversationId);
      if (conversation) {
        conversation.unreadCount.set(userId.toString(), 0);
        await conversation.save();
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
