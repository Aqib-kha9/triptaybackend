import { Schema, model } from "mongoose";
import type { Document, Types } from "mongoose";

// ──────────────────────── TypeScript Interfaces ────────────────────────

export interface IActivityEquipment {
  name: string;
  provided: boolean; // true = provided by vendor, false = guest must bring
}

export interface IActivityInclusion {
  text: string;
  type: "included" | "excluded";
}

export interface IActivitySlot {
  startTime: string; // "6:00 AM"
  endTime?: string;
  maxParticipants?: number;
}

export interface INearbyPlace {
  name: string;
  distanceKm: number;
  category: "Restaurant" | "Cafe" | "Market" | "Hospital" | "Pharmacy" | "ATM" | "Bus Stop" | "Railway Station" | "Airport" | "Tourist Spot" | "Trek" | "Lake" | "Temple" | "Other";
  description?: string;
}

export interface IHouseRule {
  rule: string;
  icon?: string;
}

export interface IMediaItem {
  url: string;
  publicId: string;
  type: "photo" | "video";
  caption?: string;
  isCover: boolean;
  order: number;
}

export interface ISeasonalPrice {
  seasonName: string;
  startDate: Date;
  endDate: Date;
  pricePerPerson: number;
}

export interface IActivity extends Document {
  // ── Owner ──
  host: Types.ObjectId;

  // ── Core Details ──
  name: string;
  slug: string;
  description: string;
  summary: string;

  // ── Classification ──
  activityType: "Rafting" | "Trekking" | "Paragliding" | "Camping" | "Bungee Jumping" | "Skiing" | "Scuba Diving" | "Safari" | "Cycling" | "Kayaking" | "Rock Climbing" | "Zip Lining" | "Hot Air Balloon" | "Wildlife Safari" | "Cultural Tour" | "Photography Tour" | "Fishing" | "Surfing" | "Caving" | "Other";
  difficulty: "Easy" | "Moderate" | "Challenging" | "Extreme";

  // ── Location ──
  address: string;
  city: string;
  state: string;
  country: string;
  zipCode: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  landmark?: string;
  meetingPoint?: string;

  // ── Duration & Schedule ──
  durationHours: number;
  durationDays: number;
  startTimes: string[];
  availability: "Daily" | "Weekdays" | "Weekends" | "Custom";
  availabilityNotes?: string;
  minAge: number;
  maxGroupSize: number;
  minGroupSize: number;

  // ── Pricing (all in INR) ──
  basePrice: number; // per person
  weekendPrice?: number;
  childPrice?: number;
  foreignerPrice?: number;
  seasonalPrices: ISeasonalPrice[];
  taxes: number;
  securityDeposit: number;

  // ── Safety & Equipment ──
  equipmentProvided: string[];
  equipmentRequired: string[];
  safetyGuidelines: string;
  hasInsurance: boolean;
  certifiedGuides: boolean;
  guideRatio?: string; // e.g., "1:5"

  // ── Inclusions & Exclusions ──
  included: string[];
  excluded: string[];

  // ── Rules & Policies ──
  houseRules: IHouseRule[];
  cancellationPolicy: "Flexible" | "Moderate" | "Strict" | "Non-Refundable";
  cancellationDetails?: string;
  isPetFriendly: boolean;
  petRules?: string;
  restrictions?: string; // medical, weight, height restrictions

  // ── Nearby Places ──
  nearbyPlaces: INearbyPlace[];

  // ── Media ──
  media: IMediaItem[];
  videoTourUrl?: string;

  // ── Booking Settings ──
  instantBook: boolean;
  advanceNoticeHours: number;
  maxGuestsPerBooking: number;

  // ── Status & Visibility ──
  status: "draft" | "published" | "unlisted" | "rejected";
  isActive: boolean;
  isFeatured: boolean;
  adminNotes?: string;

  // ── Ratings ──
  avgRating: number;
  totalReviews: number;

  // ── Languages ──
  languagesSpoken: string[];

  // ── Timestamps ──
  createdAt: Date;
  updatedAt: Date;
}

// ──────────────────────── Mongoose Schemas ────────────────────────

const nearbyPlaceSchema = new Schema<INearbyPlace>(
  {
    name: { type: String, required: true },
    distanceKm: { type: Number, required: true, min: 0 },
    category: {
      type: String,
      enum: [
        "Restaurant", "Cafe", "Market", "Hospital", "Pharmacy",
        "ATM", "Bus Stop", "Railway Station", "Airport",
        "Tourist Spot", "Trek", "Lake", "Temple", "Other",
      ],
      required: true,
    },
    description: { type: String, maxlength: 300 },
  },
  { _id: false }
);

const houseRuleSchema = new Schema<IHouseRule>(
  {
    rule: { type: String, required: true },
    icon: { type: String },
  },
  { _id: false }
);

const mediaItemSchema = new Schema<IMediaItem>(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    type: { type: String, enum: ["photo", "video"], default: "photo" },
    caption: { type: String, maxlength: 200 },
    isCover: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
  },
  { _id: true }
);

const seasonalPriceSchema = new Schema<ISeasonalPrice>(
  {
    seasonName: { type: String, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    pricePerPerson: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const activitySchema = new Schema<IActivity>(
  {
    // ── Owner ──
    host: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // ── Core Details ──
    name: {
      type: String,
      required: [true, "Activity name is required."],
      trim: true,
      maxlength: [120, "Activity name cannot exceed 120 characters."],
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
    },
    description: {
      type: String,
      required: [true, "Description is required."],
      maxlength: [5000, "Description cannot exceed 5000 characters."],
    },
    summary: {
      type: String,
      required: [true, "A short summary is required."],
      maxlength: [200, "Summary cannot exceed 200 characters."],
    },

    // ── Classification ──
    activityType: {
      type: String,
      enum: [
        "Rafting", "Trekking", "Paragliding", "Camping", "Bungee Jumping",
        "Skiing", "Scuba Diving", "Safari", "Cycling", "Kayaking",
        "Rock Climbing", "Zip Lining", "Hot Air Balloon", "Wildlife Safari",
        "Cultural Tour", "Photography Tour", "Fishing", "Surfing", "Caving", "Other",
      ],
      required: [true, "Activity type is required."],
    },
    difficulty: {
      type: String,
      enum: ["Easy", "Moderate", "Challenging", "Extreme"],
      required: [true, "Difficulty level is required."],
    },

    // ── Location ──
    address: {
      type: String,
      required: [true, "Address is required."],
      maxlength: [500, "Address cannot exceed 500 characters."],
    },
    city: {
      type: String,
      required: [true, "City is required."],
      maxlength: [100, "City cannot exceed 100 characters."],
    },
    state: {
      type: String,
      required: [true, "State is required."],
      maxlength: [100, "State cannot exceed 100 characters."],
    },
    country: {
      type: String,
      required: [true, "Country is required."],
      default: "India",
      maxlength: [100, "Country cannot exceed 100 characters."],
    },
    zipCode: {
      type: String,
      required: [true, "Zip/Postal code is required."],
      maxlength: [10, "Zip code cannot exceed 10 characters."],
    },
    coordinates: {
      lat: { type: Number, required: [true, "Latitude is required."], min: -90, max: 90 },
      lng: { type: Number, required: [true, "Longitude is required."], min: -180, max: 180 },
    },
    landmark: { type: String, maxlength: [200, "Landmark cannot exceed 200 characters."] },
    meetingPoint: { type: String, maxlength: [500, "Meeting point cannot exceed 500 characters."] },

    // ── Duration & Schedule ──
    durationHours: { type: Number, required: [true, "Duration in hours is required."], min: 0 },
    durationDays: { type: Number, default: 0, min: 0 },
    startTimes: [{ type: String, trim: true }],
    availability: {
      type: String,
      enum: ["Daily", "Weekdays", "Weekends", "Custom"],
      default: "Daily",
    },
    availabilityNotes: { type: String, maxlength: [300, "Availability notes cannot exceed 300 characters."] },
    minAge: { type: Number, default: 0, min: 0 },
    maxGroupSize: { type: Number, required: [true, "Max group size is required."], min: 1 },
    minGroupSize: { type: Number, default: 1, min: 1 },

    // ── Pricing ──
    basePrice: { type: Number, required: [true, "Base price per person is required."], min: 0 },
    weekendPrice: { type: Number, min: 0 },
    childPrice: { type: Number, min: 0 },
    foreignerPrice: { type: Number, min: 0 },
    seasonalPrices: [seasonalPriceSchema],
    taxes: { type: Number, default: 0, min: 0, max: 100 },
    securityDeposit: { type: Number, default: 0, min: 0 },

    // ── Safety & Equipment ──
    equipmentProvided: [{ type: String, trim: true }],
    equipmentRequired: [{ type: String, trim: true }],
    safetyGuidelines: {
      type: String,
      maxlength: [3000, "Safety guidelines cannot exceed 3000 characters."],
    },
    hasInsurance: { type: Boolean, default: false },
    certifiedGuides: { type: Boolean, default: false },
    guideRatio: { type: String },

    // ── Inclusions & Exclusions ──
    included: [{ type: String, trim: true }],
    excluded: [{ type: String, trim: true }],

    // ── Rules & Policies ──
    houseRules: [houseRuleSchema],
    cancellationPolicy: {
      type: String,
      enum: ["Flexible", "Moderate", "Strict", "Non-Refundable"],
      default: "Moderate",
    },
    cancellationDetails: { type: String, maxlength: [1000, "Cancellation details cannot exceed 1000 characters."] },
    isPetFriendly: { type: Boolean, default: false },
    petRules: { type: String, maxlength: [300, "Pet rules cannot exceed 300 characters."] },
    restrictions: { type: String, maxlength: [1000, "Restrictions cannot exceed 1000 characters."] },

    // ── Nearby Places ──
    nearbyPlaces: [nearbyPlaceSchema],

    // ── Media ──
    media: [mediaItemSchema],
    videoTourUrl: { type: String },

    // ── Booking Settings ──
    instantBook: { type: Boolean, default: true },
    advanceNoticeHours: { type: Number, default: 0, min: 0 },
    maxGuestsPerBooking: { type: Number, min: 1 },

    // ── Status & Visibility ──
    status: {
      type: String,
      enum: ["draft", "published", "unlisted", "rejected"],
      default: "draft",
    },
    isActive: { type: Boolean, default: true },
    isFeatured: { type: Boolean, default: false },
    adminNotes: { type: String },

    // ── Ratings ──
    avgRating: { type: Number, default: 0, min: 0, max: 5 },
    totalReviews: { type: Number, default: 0, min: 0 },

    // ── Languages ──
    languagesSpoken: [{ type: String, trim: true }],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ──────────────────────── Indexes ────────────────────────

activitySchema.index({ status: 1, isActive: 1 });
activitySchema.index({ city: 1, state: 1, country: 1 });
activitySchema.index({ "coordinates.lat": 1, "coordinates.lng": 1 });
activitySchema.index({ basePrice: 1 });
activitySchema.index({ avgRating: -1 });
activitySchema.index({ activityType: 1 });
activitySchema.index({ difficulty: 1 });

// ──────────────────────── Slug Generation ────────────────────────

activitySchema.pre<IActivity>("save", function () {
  if (this.isModified("name") || !this.slug) {
    const baseSlug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .trim();

    const randomSuffix = Math.random().toString(36).substring(2, 7);
    this.slug = `${baseSlug}-${randomSuffix}`;
  }
});

// ──────────────────────── Virtual: Computed Weekend Price ────────────────────────

activitySchema.virtual("effectiveWeekendPrice").get(function (this: IActivity) {
  if (this.weekendPrice && this.weekendPrice > 0) return this.weekendPrice;
  return Math.round(this.basePrice * 1.3);
});

export const Activity = model<IActivity>("Activity", activitySchema);