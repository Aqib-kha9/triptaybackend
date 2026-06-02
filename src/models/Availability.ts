import { Schema, model } from "mongoose";
import type { Document, Types } from "mongoose";

// ──────────────────────── TypeScript Interfaces ────────────────────────

export interface IAvailability extends Document {
  // ── Owner ──
  host: Types.ObjectId;

  // ── Item Reference ──
  itemId: Types.ObjectId; // Listing or Activity _id
  itemType: "listing" | "activity";

  // ── Blocked Dates ──
  // Stored as ISO date strings (YYYY-MM-DD) for easy querying and comparison
  blockedDates: string[];

  // ── Notes (optional) ──
  notes?: string;

  // ── Timestamps ──
  createdAt: Date;
  updatedAt: Date;
}

// ──────────────────────── Mongoose Schema ────────────────────────

const availabilitySchema = new Schema<IAvailability>(
  {
    host: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    itemId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    itemType: {
      type: String,
      enum: ["listing", "activity"],
      required: true,
    },
    blockedDates: {
      type: [String],
      default: [],
      validate: {
        validator: (dates: string[]) => {
          // Validate each date is in YYYY-MM-DD format
          const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
          return dates.every((d) => isoDateRegex.test(d) && !isNaN(Date.parse(d)));
        },
        message: "All blocked dates must be valid YYYY-MM-DD strings.",
      },
    },
    notes: {
      type: String,
      maxlength: [500, "Notes cannot exceed 500 characters."],
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ──────────────────────── Indexes ────────────────────────

// One availability document per item (listing or activity)
availabilitySchema.index({ itemId: 1, itemType: 1 }, { unique: true });
availabilitySchema.index({ host: 1, itemType: 1 });
availabilitySchema.index({ blockedDates: 1 });

// ──────────────────────── Static helpers ────────────────────────

// Format a Date object to YYYY-MM-DD
availabilitySchema.statics.formatDate = function (date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

// Get all dates in a range (inclusive)
availabilitySchema.statics.dateRange = function (start: string, end: string): string[] {
  const dates: string[] = [];
  const current = new Date(start);
  const endDate = new Date(end);
  while (current <= endDate) {
    dates.push(this.formatDate(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
};

// Get all weekends (Sat & Sun) in a month
availabilitySchema.statics.weekendsInMonth = function (year: number, month: number): string[] {
  const dates: string[] = [];
  const date = new Date(year, month, 1);
  while (date.getMonth() === month) {
    const day = date.getDay();
    if (day === 0 || day === 6) {
      dates.push(this.formatDate(date));
    }
    date.setDate(date.getDate() + 1);
  }
  return dates;
};

// Get all weekdays (Mon-Fri) in a month
availabilitySchema.statics.weekdaysInMonth = function (year: number, month: number): string[] {
  const dates: string[] = [];
  const date = new Date(year, month, 1);
  while (date.getMonth() === month) {
    const day = date.getDay();
    if (day !== 0 && day !== 6) {
      dates.push(this.formatDate(date));
    }
    date.setDate(date.getDate() + 1);
  }
  return dates;
};

export const Availability = model<IAvailability>("Availability", availabilitySchema);