import { prisma } from "../config/db.js";
import { logger } from "../core/logger.js";
import { BadRequestError, NotFoundError } from "../core/errors.js";

// ─── Seed default templates if database is empty ───
export async function seedDefaultTemplates(): Promise<void> {
  try {
    const count = await prisma.campaignTemplate.count();
    if (count > 0) return;

    logger.info("[SEEDED] Seeding default message and email templates...");
    await prisma.campaignTemplate.createMany({
      data: [
        {
          name: "Monsoon Rafting Flash Sale",
          type: "email",
          subject: "Get Flat 20% Off Ganga River Rafting This Weekend!",
          body: "Hey {{name}},\n\nAdventure is calling! Rishikesh river rafting is now 20% cheaper for this weekend only. Use coupon code RAFT20 at checkout.\n\nCheers,\nTeam Triptay",
        },
        {
          name: "Weekend Cottage Stay Flash Sale",
          type: "email",
          subject: "Exclusive Stay Offer: Wake Up in the Mountains!",
          body: "Hello {{name}},\n\nEscape the heat! Book Whispering Pines Cottage or any premium Himalayan stay this weekend and get a flat 15% discount automatically.\n\nBook now:\nTeam Triptay",
        },
        {
          name: "Host Onboarding Welcome Package",
          type: "email",
          subject: "Welcome to Triptay: Your Host Account is Active!",
          body: "Dear {{name}},\n\nCongratulations! Your KYC validation has been approved. You are now officially a Triptay Host. Start listing your cottages and experiences today!\n\nBest regards,\nOperations Control Console",
        },
        {
          name: "Native WhatsApp Flash Trek Promo",
          type: "whatsapp",
          body: "Weekend Trek Flash Sale: Get flat ₹1000 off on all Rishikesh trekking experiences! Reply TREK to activate your code instantly.",
        },
        {
          name: "Loyalty Coins Reward Blast Alert",
          type: "whatsapp",
          body: "Good news! We have credited 500 Triptay Loyalty Coins (worth ₹500) to your Triptay wallet. Use them to book stays or adventures today!",
        },
        {
          name: "Firebase Push Alert: Room Released",
          type: "push",
          body: "Hurry up! A room just opened up at Whispering Pines Cottage for this weekend. Book now before it's gone!",
        }
      ],
    });
    logger.info("[SEEDED] Default templates populated successfully.");
  } catch (err: any) {
    logger.error("Failed to seed default campaign templates:", err.message);
  }
}

// ─── CRUD Services ───

export async function listTemplates() {
  return prisma.campaignTemplate.findMany({
    orderBy: { name: "asc" },
  });
}

export async function createTemplate(data: { name: string; type: string; subject?: string; body: string }) {
  const existing = await prisma.campaignTemplate.findUnique({
    where: { name: data.name },
  });
  if (existing) {
    throw new BadRequestError(`Template with name "${data.name}" already exists.`);
  }

  return prisma.campaignTemplate.create({
    data: {
      name: data.name,
      type: data.type,
      subject: data.subject || null,
      body: data.body,
    },
  });
}

export async function updateTemplate(id: string, data: { name?: string; type?: string; subject?: string; body?: string }) {
  const template = await prisma.campaignTemplate.findUnique({ where: { id } });
  if (!template) {
    throw new NotFoundError("Campaign template not found.");
  }

  if (data.name && data.name !== template.name) {
    const existing = await prisma.campaignTemplate.findUnique({ where: { name: data.name } });
    if (existing) {
      throw new BadRequestError(`Template with name "${data.name}" already exists.`);
    }
  }

  return prisma.campaignTemplate.update({
    where: { id },
    data: {
      name: data.name,
      type: data.type,
      subject: data.subject !== undefined ? data.subject : undefined,
      body: data.body,
    },
  });
}

export async function deleteTemplate(id: string) {
  const template = await prisma.campaignTemplate.findUnique({ where: { id } });
  if (!template) {
    throw new NotFoundError("Campaign template not found.");
  }

  return prisma.campaignTemplate.delete({ where: { id } });
}
