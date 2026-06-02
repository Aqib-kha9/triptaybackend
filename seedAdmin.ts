import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { User } from "./src/models/User.js";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@triptay.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin_triptay_2026_pass";
const ADMIN_NAME = process.env.ADMIN_NAME || "Aqib Khan";
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/triptay";

async function seedAdmin() {
  try {
    console.log("🔌 Connecting to MongoDB...");
    await mongoose.connect(MONGO_URI);
    console.log("✅ MongoDB connected.");

    const existing = await User.findOne({
      email: ADMIN_EMAIL.toLowerCase(),
      role: "Admin",
    });

    if (existing) {
      console.log(
        `⚠️  Admin "${ADMIN_EMAIL}" already exists (role: ${existing.role}). Skipping creation.`
      );
    } else {
      const admin = await User.create({
        name: ADMIN_NAME,
        email: ADMIN_EMAIL.toLowerCase(),
        password: ADMIN_PASSWORD,
        role: "Admin",
        status: "Active",
        walletBalance: 0,
        kycStatus: "Not Submitted" as const,
      });

      console.log("✅ Superadmin seeded successfully.");
      console.log(`   ID:    ${admin._id}`);
      console.log(`   Email: ${admin.email}`);
      console.log(`   Role:  ${admin.role}`);
    }

    await mongoose.disconnect();
    console.log("🔌 Disconnected. Done.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Seeder failed:", err);
    process.exit(1);
  }
}

seedAdmin();