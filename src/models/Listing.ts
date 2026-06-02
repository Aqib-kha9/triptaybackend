import { Schema, model } from "mongoose";
import type { Document, Types } from "mongoose";

// ──────────────────────── TypeScript Interfaces ────────────────────────

export interface IMealOption {
  mealType: "Breakfast" | "Lunch" | "Dinner" | "Snacks" | "All Meals";
  included: boolean;
  extraPrice: number; // in INR, 0 if included
  description?: string;
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
  publicId: string; // Cloudinary public_id for deletion
  type: "photo" | "video";
  caption?: string;
  isCover: boolean;
  order: number;
}

export interface ISeasonalPrice {
  seasonName: string;
  startDate: Date;
  endDate: Date;
  pricePerNight: number;
}

export interface IListing extends Document {
  // ── Owner ──
  host: Types.ObjectId;

  // ── Core Details ──
  name: string;
  slug: string;
  description: string;
  summary: string; // short 1-liner for cards

  // ── Property Classification ──
  propertyType: "Villa" | "Apartment" | "Cottage" | "Farmhouse" | "Homestay" | "Bungalow" | "Tent" | "Treehouse" | "Cabin" | "Houseboat" | "Other";
  floorNumber?: number;
  totalFloors?: number;
  propertySizeSqFt?: number;
  yearBuilt?: number;
  isEntirePlace: boolean; // entire place vs private room vs shared room

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

  // ── Capacity ──
  maxGuests: number;
  bedrooms: number;
  beds: number;
  bathrooms: number;
  extraMattresses?: number;

  // ── Pricing (all in INR) ──
  basePrice: number; // per night
  weekendPrice?: number; // per night, defaults to basePrice + 30%
  seasonalPrices: ISeasonalPrice[];
  cleaningFee: number;
  securityDeposit: number;
  extraGuestPrice: number; // per extra guest beyond standard occupancy
  taxes: number; // percentage, e.g., 12 for 12% GST

  // ── Stay Configuration ──
  minStay: number; // minimum nights
  maxStay: number; // maximum nights (0 = no limit)
  checkInTime: string; // "12:00 PM"
  checkOutTime: string; // "11:00 AM"
  flexibleCheckIn: boolean;
  flexibleCheckOut: boolean;

  // ── Amenities ──
  amenities: string[];

  // ── Food & Dining ──
  meals: IMealOption[];
  hasKitchen: boolean;
  kitchenDetails?: string;

  // ── House Rules ──
  houseRules: IHouseRule[];
  cancellationPolicy: "Flexible" | "Moderate" | "Strict" | "Non-Refundable";
  cancellationDetails?: string;
  isPetFriendly: boolean;
  petRules?: string;
  isSmokingAllowed: boolean;
  isPartyAllowed: boolean;
  quietHoursStart?: string; // "10:00 PM"
  quietHoursEnd?: string; // "7:00 AM"

  // ── Nearby Places ──
  nearbyPlaces: INearbyPlace[];

  // ── Media ──
  media: IMediaItem[];
  videoTourUrl?: string; // YouTube/Vimeo embed

  // ── Booking Settings ──
  instantBook: boolean;
  advanceNoticeHours: number; // min hours before check-in needed to book
  maxGuestsPerBooking: number;

  // ── Status & Visibility ──
  status: "draft" | "published" | "unlisted" | "rejected";
  isActive: boolean;
  isFeatured: boolean;
  adminNotes?: string;

  // ── Ratings (computed, denormalized) ──
  avgRating: number;
  totalReviews: number;

  // ── Languages Spoken by Host ──
  languagesSpoken: string[];

  // ── Timestamps ──
  createdAt: Date;
  updatedAt: Date;
}

// ──────────────────────── Mongoose Schema ────────────────────────

const mealOptionSchema = new Schema<IMealOption>(
  {
    mealType: {
      type: String,
      enum: ["Breakfast", "Lunch", "Dinner", "Snacks", "All Meals"],
      required: true,
    },
    included: { type: Boolean, default: false },
    extraPrice: { type: Number, default: 0, min: 0 },
    description: { type: String, maxlength: 200 },
  },
  { _id: false }
);

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
    pricePerNight: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const listingSchema = new Schema<IListing>(
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
      required: [true, "Property name is required."],
      trim: true,
      maxlength: [120, "Property name cannot exceed 120 characters."],
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

    // ── Property Classification ──
    propertyType: {
      type: String,
      enum: [
        "Villa", "Apartment", "Cottage", "Farmhouse", "Homestay",
        "Bungalow", "Tent", "Treehouse", "Cabin", "Houseboat", "Other",
      ],
      required: [true, "Property type is required."],
    },
    floorNumber: { type: Number, min: 0 },
    totalFloors: { type: Number, min: 1 },
    propertySizeSqFt: { type: Number, min: 1 },
    yearBuilt: { type: Number, min: 1900, max: new Date().getFullYear() },
    isEntirePlace: { type: Boolean, default: true },

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

    // ── Capacity ──
    maxGuests: { type: Number, required: [true, "Max guest capacity is required."], min: 1, max: 100 },
    bedrooms: { type: Number, required: [true, "Number of bedrooms is required."], min: 0, max: 50 },
    beds: { type: Number, required: [true, "Number of beds is required."], min: 1, max: 100 },
    bathrooms: { type: Number, required: [true, "Number of bathrooms is required."], min: 0, max: 50 },
    extraMattresses: { type: Number, min: 0, max: 20, default: 0 },

    // ── Pricing ──
    basePrice: { type: Number, required: [true, "Base price per night is required."], min: 0 },
    weekendPrice: { type: Number, min: 0 },
    seasonalPrices: [seasonalPriceSchema],
    cleaningFee: { type: Number, default: 0, min: 0 },
    securityDeposit: { type: Number, default: 0, min: 0 },
    extraGuestPrice: { type: Number, default: 0, min: 0 },
    taxes: { type: Number, default: 0, min: 0, max: 100 },

    // ── Stay Configuration ──
    minStay: { type: Number, default: 1, min: 1 },
    maxStay: { type: Number, default: 0, min: 0 },
    checkInTime: { type: String, default: "12:00 PM" },
    checkOutTime: { type: String, default: "11:00 AM" },
    flexibleCheckIn: { type: Boolean, default: false },
    flexibleCheckOut: { type: Boolean, default: false },

    // ── Amenities ──
    amenities: [{ type: String, trim: true }],

    // ── Food & Dining ──
    meals: [mealOptionSchema],
    hasKitchen: { type: Boolean, default: false },
    kitchenDetails: { type: String, maxlength: [500, "Kitchen details cannot exceed 500 characters."] },

    // ── House Rules ──
    houseRules: [houseRuleSchema],
    cancellationPolicy: {
      type: String,
      enum: ["Flexible", "Moderate", "Strict", "Non-Refundable"],
      default: "Moderate",
    },
    cancellationDetails: { type: String, maxlength: [1000, "Cancellation details cannot exceed 1000 characters."] },
    isPetFriendly: { type: Boolean, default: false },
    petRules: { type: String, maxlength: [300, "Pet rules cannot exceed 300 characters."] },
    isSmokingAllowed: { type: Boolean, default: false },
    isPartyAllowed: { type: Boolean, default: false },
    quietHoursStart: { type: String },
    quietHoursEnd: { type: String },

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

listingSchema.index({ status: 1, isActive: 1 });
listingSchema.index({ city: 1, state: 1, country: 1 });
listingSchema.index({ "coordinates.lat": 1, "coordinates.lng": 1 });
listingSchema.index({ basePrice: 1 });
listingSchema.index({ avgRating: -1 });
listingSchema.index({ propertyType: 1 });
listingSchema.index({ amenities: 1 });

// ──────────────────────── Slug Generation ────────────────────────

listingSchema.pre<IListing>("save", function () {
  if (this.isModified("name") || !this.slug) {
    const baseSlug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .trim();

    // Ensure uniqueness by appending a short random suffix
    const randomSuffix = Math.random().toString(36).substring(2, 7);
    this.slug = `${baseSlug}-${randomSuffix}`;
  }
});

// ──────────────────────── Virtual: Computed Weekend Price ────────────────────────

listingSchema.virtual("effectiveWeekendPrice").get(function (this: IListing) {
  if (this.weekendPrice && this.weekendPrice > 0) return this.weekendPrice;
  // Default: basePrice + 30%
  return Math.round(this.basePrice * 1.3);
});

export const Listing = model<IListing>("Listing", listingSchema);