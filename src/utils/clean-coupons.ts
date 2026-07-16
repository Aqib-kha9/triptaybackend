import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Clear all coupon usage history to allow clean testing of per-user limits
  const deletedUsages = await prisma.couponUsage.deleteMany({});
  console.log(`Deleted ${deletedUsages.count} coupon usage tracking records.`);

  // Reset usedCount counter on all coupons
  const updatedCoupons = await prisma.coupon.updateMany({
    data: { usedCount: 0 },
  });
  console.log(`Reset usedCount on all coupons to 0.`);
}

main()
  .catch((e) => {
    console.error("Cleanup failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
