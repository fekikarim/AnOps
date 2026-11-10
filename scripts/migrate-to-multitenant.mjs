import { MongoClient, ObjectId } from "mongodb";

if (process.loadEnvFile) {
  try {
    process.loadEnvFile(".env");
  } catch {}
}

const uri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const client = new MongoClient(uri);

async function migrate() {
  try {
    await client.connect();
    const db = client.db("test");

    console.log("=== Multi-Tenant Data Migration ===");

    // Find the admin user
    const adminEmail = (process.env.ADMIN_EMAIL || "admin@anops.internal").toLowerCase().trim();
    let admin = await db.collection("users").findOne({ email: adminEmail });

    if (!admin) {
      admin = await db.collection("users").findOne({});
    }

    if (!admin) {
      console.error("No users found to assign as default company owner.");
      return;
    }

    // Check if default company already exists
    let defaultCompany = await db.collection("companies").findOne({ slug: "anops-technologies" });

    if (!defaultCompany) {
      const now = new Date();
      const insertComp = await db.collection("companies").insertOne({
        name: "AnOps Technologies",
        slug: "anops-technologies",
        ownerId: admin._id,
        currency: "TND",
        industry: "Information Technology",
        createdAt: now,
        updatedAt: now,
      });

      defaultCompany = { _id: insertComp.insertedId, name: "AnOps Technologies" };
      console.log("Created default company:", defaultCompany._id.toString());

      // Assign admin as owner
      await db.collection("company_members").insertOne({
        companyId: defaultCompany._id,
        userId: admin._id,
        role: "owner",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      console.log("Added admin as owner of default company.");

      // Add all other existing users as members of the default company
      const otherUsers = await db.collection("users").find({ _id: { $ne: admin._id } }).toArray();
      for (const u of otherUsers) {
        await db.collection("company_members").updateOne(
          { companyId: defaultCompany._id, userId: u._id },
          {
            $setOnInsert: {
              companyId: defaultCompany._id,
              userId: u._id,
              role: u.role === "hr_admin" ? "admin" : "employee",
              status: "active",
              createdAt: now,
              updatedAt: now,
            },
          },
          { upsert: true }
        );
      }
      console.log(`Added ${otherUsers.length} existing users to default company.`);
    }

    const companyId = defaultCompany._id;

    // Migrate all collections to include companyId where missing
    const collectionsToMigrate = [
      "departments",
      "job_titles",
      "employees",
      "attendance",
      "leave_requests",
      "payslips",
    ];

    for (const colName of collectionsToMigrate) {
      const res = await db.collection(colName).updateMany(
        { companyId: { $exists: false } },
        { $set: { companyId: companyId } }
      );
      console.log(`Migrated ${colName}: updated ${res.modifiedCount} documents with companyId.`);
    }

    // Create compound indexes for performance and multi-tenant security
    await db.collection("company_members").createIndex({ companyId: 1, userId: 1 }, { unique: true });
    await db.collection("employees").createIndex({ companyId: 1, email: 1 });
    await db.collection("departments").createIndex({ companyId: 1, name: 1 });
    await db.collection("job_titles").createIndex({ companyId: 1, title: 1 });
    await db.collection("attendance").createIndex({ companyId: 1, employeeId: 1, date: 1 });
    await db.collection("leave_requests").createIndex({ companyId: 1, employeeId: 1 });
    await db.collection("payslips").createIndex({ companyId: 1, employeeId: 1, period: 1 });

    console.log("Indexes created successfully.");
    console.log("=== Migration Completed Successfully! ===");
  } catch (err) {
    console.error("Migration error:", err);
  } finally {
    await client.close();
  }
}

migrate();
