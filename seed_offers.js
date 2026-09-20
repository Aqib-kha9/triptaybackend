import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const OFFERS = [
  {
    title: "Domestic Stays",
    discount: "Flat 25% OFF",
    desc: "Valid on all villa bookings",
    image: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&q=80&w=400",
    bgClass: "bg-blue-50/50",
    tag: "Limited",
    order: 1
  },
  {
    title: "Activity Bundles",
    discount: "Save ₹2,000",
    desc: "On 2+ adventure activities",
    image: "https://images.unsplash.com/photo-1533240332313-0db49b459ad6?auto=format&fit=crop&q=80&w=400",
    bgClass: "bg-orange-50/50",
    tag: "Limited",
    order: 2
  },
  {
    title: "Early Bird Deal",
    discount: "15% Extra OFF",
    desc: "30 days in advance",
    image: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&q=80&w=400",
    bgClass: "bg-emerald-50/50",
    tag: "Limited",
    order: 3
  }
];

async function main() {
  console.log("Seeding offers...");
  for (const offer of OFFERS) {
    await prisma.offer.create({
      data: offer
    });
  }
  console.log("Offers seeded successfully.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
