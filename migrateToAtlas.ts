/**
 * migrateToAtlas.ts
 * Exports all data from local MongoDB (127.0.0.1:27017/triptay)
 * and imports it into MongoDB Atlas cluster.
 *
 * Usage: npx tsx migrateToAtlas.ts
 */

import mongoose from "mongoose";

const LOCAL_URI = "mongodb://127.0.0.1:27017/triptay";
const ATLAS_URI = "mongodb+srv://aqibkha9x:DkyucQ2Ccjs4EwHD@cluster0.skvdstf.mongodb.net/triptay";

const COLLECTIONS = [
  "listings",
  "notifications",
  "conversations",
  "availabilities",
  "otps",
  "messages",
  "users",
  "destinations",
  "activities",
];

async function migrate() {
  console.log("Connecting to LOCAL MongoDB...");
  const localConn = await mongoose.createConnection(LOCAL_URI).asPromise();
  console.log("✅ Connected to local MongoDB");

  console.log("Connecting to ATLAS MongoDB...");
  const atlasConn = await mongoose.createConnection(ATLAS_URI).asPromise();
  console.log("✅ Connected to Atlas MongoDB");

  for (const colName of COLLECTIONS) {
    try {
      const localCol = localConn.collection(colName);
      const atlasCol = atlasConn.collection(colName);

      const docs = await localCol.find({}).toArray();
      if (docs.length === 0) {
        console.log(`  ⏭️  ${colName}: empty, skipping`);
        continue;
      }

      // Clear existing data in Atlas for this collection
      await atlasCol.deleteMany({});

      // Insert into Atlas
      await atlasCol.insertMany(docs);
      console.log(`  ✅ ${colName}: migrated ${docs.length} documents`);
    } catch (err: any) {
      console.error(`  ❌ ${colName}: ${err.message}`);
    }
  }

  console.log("\n🎉 Migration complete! Disconnecting...");
  await localConn.close();
  await atlasConn.close();
  process.exit(0);
}

migrate();