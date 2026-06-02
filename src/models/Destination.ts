import mongoose, { Schema, type Document } from "mongoose";

export interface IDestination extends Document {
  name: string;
  slug: string;
  state: string;
  city: string;
  image: string;
  category: "Nature" | "Adventure" | "Historical" | "Spiritual";
  coordinates: {
    lat: number;
    lng: number;
  };
  description: string;
  isActive: boolean;
  popularityScore: number;
  createdAt: Date;
  updatedAt: Date;
}

const DestinationSchema = new Schema<IDestination>(
  {
    name: {
      type: String,
      required: [true, "Destination name is required"],
      trim: true,
      maxlength: [100, "Destination name cannot exceed 100 characters"],
    },
    slug: {
      type: String,
      required: [true, "Destination slug is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    state: {
      type: String,
      required: [true, "State is required"],
      trim: true,
    },
    city: {
      type: String,
      required: [true, "City/region is required"],
      trim: true,
    },
    image: {
      type: String,
      required: [true, "Image URL is required"],
      trim: true,
    },
    category: {
      type: String,
      required: [true, "Category is required"],
      enum: ["Nature", "Adventure", "Historical", "Spiritual"],
    },
    coordinates: {
      lat: { type: Number, required: [true, "Latitude is required"] },
      lng: { type: Number, required: [true, "Longitude is required"] },
    },
    description: {
      type: String,
      default: "",
      maxlength: [2000, "Description cannot exceed 2000 characters"],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    popularityScore: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Index for slug lookups
DestinationSchema.index({ slug: 1 });
// Index for category filtering
DestinationSchema.index({ category: 1, isActive: 1 });
// Index for popularity sorting (popular destinations section)
DestinationSchema.index({ isActive: 1, popularityScore: -1 });
// Compound index for geospatial queries
DestinationSchema.index({ "coordinates.lat": 1, "coordinates.lng": 1 });

const Destination =
  mongoose.models.Destination ||
  mongoose.model<IDestination>("Destination", DestinationSchema);

export default Destination;