import { Schema, model } from "mongoose";
import type { Document } from "mongoose";

export interface IOtp extends Document {
  identifier: string;
  code: string;
  expiresAt: Date;
}

const otpSchema = new Schema<IOtp>({
  identifier: { 
    type: String, 
    required: true, 
    lowercase: true, 
    trim: true 
  },
  code: { 
    type: String, 
    required: true 
  },
  expiresAt: { 
    type: Date, 
    required: true, 
    index: { expires: 0 } // TTL index: deletes document at the expiresAt timestamp
  }
}, {
  timestamps: true
});

// Compound unique index to ensure at most one active OTP code per identifier
otpSchema.index({ identifier: 1, code: 1 }, { unique: true });

export const Otp = model<IOtp>("Otp", otpSchema);
