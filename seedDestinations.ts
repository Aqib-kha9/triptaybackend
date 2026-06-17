import dotenv from "dotenv";
dotenv.config();

import { prisma } from "./src/config/db.js";

interface SeedDest {
  name: string;
  slug: string;
  state: string;
  city: string;
  image: string;
  category: "Nature" | "Adventure" | "Historical" | "Spiritual";
  coordinates: {
    lat: number;
    lng: number;
  };
  description: string;
  popularityScore: number;
}

const destinations: SeedDest[] = [
  {
    name: "Manali",
    slug: "manali",
    state: "Himachal Pradesh",
    city: "Manali",
    image: "https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?w=800&q=80",
    category: "Nature",
    coordinates: { lat: 32.2432, lng: 77.1892 },
    description: "Nestled in the Beas River Valley, Manali is a paradise for nature lovers and adventure seekers. Surrounded by snow-capped peaks, lush pine forests, and roaring rivers, it offers trekking, paragliding, and serene escapes.",
    popularityScore: 95,
  },
  {
    name: "Rishikesh",
    slug: "rishikesh",
    state: "Uttarakhand",
    city: "Rishikesh",
    image: "https://images.unsplash.com/photo-1609949279531-cf48d64bed89?w=800&q=80",
    category: "Spiritual",
    coordinates: { lat: 30.0869, lng: 78.2676 },
    description: "The Yoga Capital of the World, Rishikesh sits on the banks of the holy Ganges. Known for its iconic suspension bridges, ashrams, white-water rafting, and the evening Ganga Aarti at Triveni Ghat.",
    popularityScore: 92,
  },
  {
    name: "Goa",
    slug: "goa",
    state: "Goa",
    city: "Panaji",
    image: "https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?w=800&q=80",
    category: "Nature",
    coordinates: { lat: 15.4909, lng: 73.8278 },
    description: "India's beach paradise — Goa is famous for its golden sands, vibrant nightlife, Portuguese heritage, and delicious seafood. From the bustling Baga Beach to the serene Palolem, there's a beach for every mood.",
    popularityScore: 98,
  },
  {
    name: "Kasol",
    slug: "kasol",
    state: "Himachal Pradesh",
    city: "Kasol",
    image: "https://images.unsplash.com/photo-1566837945700-30057527ade0?w=800&q=80",
    category: "Adventure",
    coordinates: { lat: 32.0100, lng: 77.3148 },
    description: "A quaint village in Parvati Valley, Kasol is a haven for backpackers and trekkers. Known as 'Mini Israel', it offers stunning riverside camping, the Kheerganga trek, and a unique blend of cultures.",
    popularityScore: 88,
  },
  {
    name: "Jaipur",
    slug: "jaipur",
    state: "Rajasthan",
    city: "Jaipur",
    image: "https://images.unsplash.com/photo-1477587458883-47145ed94245?w=800&q=80",
    category: "Historical",
    coordinates: { lat: 26.9124, lng: 75.7873 },
    description: "The Pink City of India, Jaipur is a majestic blend of royal heritage and vibrant culture. Explore the magnificent Amber Fort, Hawa Mahal, City Palace, and bustling bazaars filled with handicrafts.",
    popularityScore: 90,
  },
  {
    name: "Varanasi",
    slug: "varanasi",
    state: "Uttar Pradesh",
    city: "Varanasi",
    image: "https://images.unsplash.com/photo-1561361513-2d000a50f0dc?w=800&q=80",
    category: "Spiritual",
    coordinates: { lat: 25.3176, lng: 82.9739 },
    description: "One of the world's oldest living cities, Varanasi is the spiritual heart of India. The ghats along the Ganges, the mesmerizing Ganga Aarti, and narrow winding alleys create an unforgettable experience.",
    popularityScore: 93,
  },
  {
    name: "Udaipur",
    slug: "udaipur",
    state: "Rajasthan",
    city: "Udaipur",
    image: "https://images.unsplash.com/photo-1587474260584-136574528ed5?w=800&q=80",
    category: "Historical",
    coordinates: { lat: 24.5854, lng: 73.7125 },
    description: "The City of Lakes, Udaipur is a romantic destination with stunning palaces, serene boat rides on Lake Pichola, and the majestic City Palace complex. A true gem of Rajasthan.",
    popularityScore: 87,
  },
  {
    name: "Munnar",
    slug: "munnar",
    state: "Kerala",
    city: "Munnar",
    image: "https://images.unsplash.com/photo-1593196145026-3b3b1e285f1f?w=800&q=80",
    category: "Nature",
    coordinates: { lat: 10.0889, lng: 77.0595 },
    description: "Rolling hills covered in emerald tea plantations, misty valleys, and exotic wildlife — Munnar is Kerala's most popular hill station. Perfect for nature walks, tea tasting, and photography.",
    popularityScore: 89,
  },
  {
    name: "Agra",
    slug: "agra",
    state: "Uttar Pradesh",
    city: "Agra",
    image: "https://images.unsplash.com/photo-1564507592333-c60657eea523?w=800&q=80",
    category: "Historical",
    coordinates: { lat: 27.1751, lng: 78.0421 },
    description: "Home to the iconic Taj Mahal, Agra is a testament to Mughal architecture and love. Beyond the Taj, explore the majestic Agra Fort and the deserted city of Fatehpur Sikri.",
    popularityScore: 96,
  },
  {
    name: "Leh Ladakh",
    slug: "leh-ladakh",
    state: "Ladakh",
    city: "Leh",
    image: "https://images.unsplash.com/photo-1582654454409-778f6619ddc8?w=800&q=80",
    category: "Adventure",
    coordinates: { lat: 34.1526, lng: 77.5771 },
    description: "A high-altitude desert with surreal landscapes, ancient monasteries, and thrilling mountain passes. Leh Ladakh is the ultimate adventure destination — from the Khardung La pass to Pangong Lake.",
    popularityScore: 94,
  },
  {
    name: "Solang Valley",
    slug: "solang-valley",
    state: "Himachal Pradesh",
    city: "Manali",
    image: "https://images.unsplash.com/photo-1580651315530-69c8e0026377?w=800&q=80",
    category: "Adventure",
    coordinates: { lat: 32.3167, lng: 77.1500 },
    description: "A stunning valley between Solang village and Beas Kund, offering world-class skiing in winter and paragliding, zorbing, and horse riding in summer. Panoramic views of glaciers and snow-capped peaks.",
    popularityScore: 85,
  },
  {
    name: "Jodhpur",
    slug: "jodhpur",
    state: "Rajasthan",
    city: "Jodhpur",
    image: "https://images.unsplash.com/photo-1640172438892-6bdb103b7e5b?w=800&q=80",
    category: "Historical",
    coordinates: { lat: 26.2389, lng: 73.0243 },
    description: "The Blue City of Rajasthan, Jodhpur is dominated by the mighty Mehrangarh Fort overlooking a sea of blue-painted houses. Explore the bustling Sardar Market and taste the famous Jodhpuri mirchi vada.",
    popularityScore: 82,
  },
  {
    name: "Darjeeling",
    slug: "darjeeling",
    state: "West Bengal",
    city: "Darjeeling",
    image: "https://images.unsplash.com/photo-1587825140708-dfaf72ae4b04?w=800&q=80",
    category: "Nature",
    coordinates: { lat: 27.0410, lng: 88.2663 },
    description: "The Queen of the Hills, Darjeeling is famous for its tea plantations, the UNESCO-listed Himalayan Railway, and breathtaking views of Kanchenjunga. Wake up early for a magical sunrise at Tiger Hill.",
    popularityScore: 84,
  },
  {
    name: "Jaisalmer",
    slug: "jaisalmer",
    state: "Rajasthan",
    city: "Jaisalmer",
    image: "https://images.unsplash.com/photo-1598890777032-bde835ba27c2?w=800&q=80",
    category: "Historical",
    coordinates: { lat: 26.9157, lng: 70.9083 },
    description: "The Golden City rises from the Thar Desert like a mirage. The living fort, camel safaris at sunset, and desert camping under star-filled skies make Jaisalmer an unforgettable experience.",
    popularityScore: 86,
  },
  {
    name: "Coorg",
    slug: "coorg",
    state: "Karnataka",
    city: "Madikeri",
    image: "https://images.unsplash.com/photo-1625505826533-5c80aca7d157?w=800&q=80",
    category: "Nature",
    coordinates: { lat: 12.3375, lng: 75.8070 },
    description: "The Scotland of India, Coorg is a lush hill station with coffee plantations, misty hills, and stunning waterfalls like Abbey Falls. Trek through the Western Ghats and sample authentic Kodava cuisine.",
    popularityScore: 83,
  },
  {
    name: "Amritsar",
    slug: "amritsar",
    state: "Punjab",
    city: "Amritsar",
    image: "https://images.unsplash.com/photo-1593181629936-11ceee7e1b36?w=800&q=80",
    category: "Spiritual",
    coordinates: { lat: 31.6340, lng: 74.8723 },
    description: "The spiritual and cultural center of Sikhism, Amritsar is home to the magnificent Golden Temple. Witness the Wagah Border ceremony and indulge in the legendary Amritsari kulcha and lassi.",
    popularityScore: 91,
  },
];

async function seedDestinations() {
  try {
    console.log("🔌 Connecting to database...");

    let created = 0;
    let skipped = 0;

    for (const dest of destinations) {
      const existing = await prisma.destination.findFirst({
        where: { slug: dest.slug },
      });
      if (existing) {
        console.log(`⏭️  "${dest.name}" already exists — skipping.`);
        skipped++;
        continue;
      }

      await prisma.destination.create({
        data: {
          name: dest.name,
          slug: dest.slug,
          state: dest.state,
          city: dest.city,
          image: dest.image,
          category: dest.category,
          lat: dest.coordinates.lat,
          lng: dest.coordinates.lng,
          description: dest.description,
          popularityScore: dest.popularityScore,
        }
      });
      console.log(`✅ "${dest.name}" created (${dest.category}, ${dest.state})`);
      created++;
    }

    console.log(`\n🎉 Done! Created: ${created}, Skipped: ${skipped}, Total: ${destinations.length}`);
    process.exit(0);
  } catch (err) {
    console.error("❌ Seeder failed:", err);
    process.exit(1);
  }
}

seedDestinations();