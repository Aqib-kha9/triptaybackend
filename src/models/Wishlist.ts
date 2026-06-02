import { Schema, model } from "mongoose";
import type { Document } from "mongoose";

export interface IWishlist extends Document {
  userId: Schema.Types.ObjectId;
  itemId: Schema.Types.ObjectId;
  itemType: "stay" | "activity";
}

const wishlistSchema = new Schema<IWishlist>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    itemId: { type: Schema.Types.ObjectId, required: true },
    itemType: { type: String, enum: ["stay", "activity"], required: true },
  },
  { timestamps: true }
);

// A user can only save a specific item once
wishlistSchema.index({ userId: 1, itemId: 1, itemType: 1 }, { unique: true });

export const Wishlist = model<IWishlist>("Wishlist", wishlistSchema);