import { Schema, model } from "mongoose";
import type { Document } from "mongoose";

export interface ILastMessage {
  text: string;
  sender: Schema.Types.ObjectId;
  sentAt: Date;
}

export interface IConversation extends Document {
  participants: Schema.Types.ObjectId[];
  listingId?: Schema.Types.ObjectId;
  activityId?: Schema.Types.ObjectId;
  bookingContext?: {
    title: string;
    dateRange: string;
    type: "listing" | "activity";
  };
  lastMessage?: ILastMessage;
  unreadCount: Map<string, number>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const conversationSchema = new Schema<IConversation>(
  {
    participants: {
      type: [{ type: Schema.Types.ObjectId, ref: "User" }],
      required: true,
      validate: {
        validator: (v: any[]) => v.length === 2,
        message: "A conversation must have exactly 2 participants.",
      },
    },
    listingId: {
      type: Schema.Types.ObjectId,
      ref: "Listing",
      default: null,
    },
    activityId: {
      type: Schema.Types.ObjectId,
      ref: "Activity",
      default: null,
    },
    bookingContext: {
      title: { type: String },
      dateRange: { type: String },
      type: { type: String, enum: ["listing", "activity"] },
    },
    lastMessage: {
      text: { type: String },
      sender: { type: Schema.Types.ObjectId, ref: "User" },
      sentAt: { type: Date },
    },
    unreadCount: {
      type: Map,
      of: Number,
      default: {},
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Compound unique index to prevent duplicate conversations
conversationSchema.index({ participants: 1 });
conversationSchema.index({ listingId: 1 });
conversationSchema.index({ activityId: 1 });
conversationSchema.index({ updatedAt: -1 });

export const Conversation = model<IConversation>(
  "Conversation",
  conversationSchema
);