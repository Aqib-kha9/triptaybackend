import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  await prisma.otp.deleteMany({});
  
  try {
    await prisma.passwordReset.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.review.deleteMany({});
    await prisma.wishlist.deleteMany({});
    await prisma.fcmToken.deleteMany({});
    await prisma.commission.deleteMany({});
    await prisma.couponUsage.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.booking.deleteMany({});
    
    await prisma.user.deleteMany({});
    console.log("Successfully deleted users and related data.");
  } catch (e) {
    console.error("Error deleting users:", e);
  }
}
main();
