import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";

if (process.loadEnvFile) {
  try {
    process.loadEnvFile(".env");
  } catch {}
}

const uri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const client = new MongoClient(uri);

async function run() {
  try {
    await client.connect();
    const db = client.db("test");

    const adminEmail = (process.env.ADMIN_EMAIL || "admin@anops.internal").toLowerCase().trim();
    const adminPassword = process.env.ADMIN_PASSWORD || "AdminPass123!";
    const adminName = process.env.ADMIN_NAME || "System Administrator";

    console.log("Ensuring admin account for:", adminEmail);
    const existing = await db.collection("users").findOne({ email: adminEmail });
    if (!existing) {
      const hashedPassword = await bcrypt.hash(adminPassword, 12);
      await db.collection("users").insertOne({
        name: adminName,
        email: adminEmail,
        password: hashedPassword,
        role: "hr_admin",
        status: "active",
        emailVerified: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      console.log("Created admin user successfully in users collection.");
    } else {
      await db.collection("users").updateOne(
        { _id: existing._id },
        { $set: { role: "hr_admin", status: "active", emailVerified: existing.emailVerified || new Date() } }
      );
      console.log("Admin user updated to role: hr_admin in users collection.");
    }

    // Set all other existing users without a role to role: 'employee'
    const updateOthers = await db.collection("users").updateMany(
      { email: { $ne: adminEmail }, role: { $exists: false } },
      { $set: { role: "employee" } }
    );
    console.log("Updated other users without role to 'employee':", updateOthers.modifiedCount);

    const users = await db.collection("users").find({}, { projection: { password: 0 } }).toArray();
    console.log("All DB Users:", JSON.stringify(users, null, 2));
  } catch (err) {
    console.error("Sync error:", err);
  } finally {
    await client.close();
  }
}

run();
