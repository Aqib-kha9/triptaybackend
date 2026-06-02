import mongoose, { type Document, type Model } from "mongoose";

export interface ITestimonial extends Document {
  name: string;
  role: string;
  text: string;
  image: string;
  order: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const testimonialSchema = new mongoose.Schema<ITestimonial>(
  {
    name: {
      type: String,
      required: [true, "Name is required."],
      trim: true,
      maxlength: [100, "Name cannot exceed 100 characters."],
    },
    role: {
      type: String,
      required: [true, "Role / designation is required."],
      trim: true,
      maxlength: [150, "Role cannot exceed 150 characters."],
    },
    text: {
      type: String,
      required: [true, "Testimonial text is required."],
      trim: true,
      maxlength: [1000, "Testimonial text cannot exceed 1000 characters."],
    },
    image: {
      type: String,
      default: "",
    },
    order: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

testimonialSchema.index({ isActive: 1, order: 1 });

export const Testimonial: Model<ITestimonial> =
  mongoose.models.Testimonial ||
  mongoose.model<ITestimonial>("Testimonial", testimonialSchema);