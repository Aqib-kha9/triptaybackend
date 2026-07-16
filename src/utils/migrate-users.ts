import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany();
  console.log(`Found ${users.length} users in database.`);

  let updatedCount = 0;

  for (const user of users) {
    const email = user.email.trim();
    
    // Check if the email field contains only digits (phone number format)
    const isPhone = /^\d{10,15}$/.test(email);

    if (isPhone) {
      const virtualEmail = `${email}@triptay.com`;
      const phoneVal = user.phone || email;

      console.log(`Migrating user ID: ${user.id} (${user.name})`);
      console.log(`  Email: "${user.email}" -> "${virtualEmail}"`);
      console.log(`  Phone: "${user.phone}" -> "${phoneVal}"`);

      // Check if another user already has the target virtual email to avoid constraint error
      const conflict = await prisma.user.findUnique({ where: { email: virtualEmail } });
      if (conflict) {
        console.warn(`  ⚠️ Conflict: User with email "${virtualEmail}" already exists. Skipping.`);
        continue;
      }

      await prisma.user.update({
        where: { id: user.id },
        data: {
          email: virtualEmail,
          phone: phoneVal,
        },
      });

      updatedCount++;
    }
  }

  console.log(`Successfully migrated ${updatedCount} users.`);
}

main()
  .catch((e) => {
    console.error("Migration failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
