import { Schema, model } from "mongoose";
import type { Document } from "mongoose";
import bcrypt from "bcryptjs";

export interface IUser extends Document {
  name: string;
  email: string;
  password: string;
  phone?: string;
  avatar?: string;
  website?: string;
  role: "Guest" | "Vendor" | "Dual Mode" | "Admin";
  status: "Active" | "Blocked";
  walletBalance: number;
  panNumber?: string;
  gstin?: string;
  bankAccount?: string;
  bankIFSC?: string;
  kycStatus: "Pending" | "Approved" | "Rejected" | "Not Submitted";
  aadharFront?: string;
  aadharBack?: string;
  panCardImage?: string;
  comparePassword: (password: string) => Promise<boolean>;
}

const userSchema = new Schema<IUser>({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  phone: { type: String },
  avatar: { type: String },
  website: { type: String },
  role: { type: String, enum: ["Guest", "Vendor", "Dual Mode", "Admin"], default: "Guest" },
  status: { type: String, enum: ["Active", "Blocked"], default: "Active" },
  walletBalance: { type: Number, default: 0 },
  panNumber: { type: String },
  gstin: { type: String },
  bankAccount: { type: String },
  bankIFSC: { type: String },
  kycStatus: { type: String, enum: ["Pending", "Approved", "Rejected", "Not Submitted"], default: "Not Submitted" },
  aadharFront: { type: String },
  aadharBack: { type: String },
  panCardImage: { type: String }
}, {
  timestamps: true
});

userSchema.pre<IUser>("save", async function(this: IUser) {
  if (!this.isModified("password")) return;
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  } catch (error: any) {
    throw error;
  }
});

userSchema.methods.comparePassword = async function(this: IUser, candidatePassword: string): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

export const User = model<IUser>("User", userSchema);
