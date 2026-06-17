import dotenv from "dotenv";
dotenv.config();

import bcrypt from "bcryptjs";
import { prisma } from "./src/config/db.js";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@triptay.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin_triptay_2026_pass";
const ADMIN_NAME = process.env.ADMIN_NAME || "Aqib Khan";

async function seedAdmin() {
  try {
    console.log("🔌 Connecting to database...");
    
    const existing = await prisma.user.findFirst({
      where: {
        email: ADMIN_EMAIL.toLowerCase(),
        role: "Admin",
      },
    });

    if (existing) {
      console.log(
        `⚠️  Admin "${ADMIN_EMAIL}" already exists (role: ${existing.role}). Skipping creation.`
      );
    } else {
      const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 12);
      const admin = await prisma.user.create({
        data: {
          name: ADMIN_NAME,
          email: ADMIN_EMAIL.toLowerCase(),
          password: hashedPassword,
          role: "Admin",
          status: "Active",
          walletBalance: 0,
          kycStatus: "Not Submitted",
        },
      });

      console.log("✅ Superadmin seeded successfully.");
      console.log(`   ID:    ${admin.id}`);
      console.log(`   Email: ${admin.email}`);
      console.log(`   Role:  ${admin.role}`);
    }

    process.exit(0);
  } catch (err) {
    console.error("❌ Seeder failed:", err);
    process.exit(1);
  }
}

seedAdmin();