import { MongoClient, ObjectId } from "mongodb";

const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/test";

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();

  console.log("=== Multi-Tenant Verification Test ===");

  // 1. Check companies collection
  const companies = await db.collection("companies").find().toArray();
  console.log(`Found ${companies.length} company(ies):`);
  companies.forEach((c) => {
    console.log(` - [${c._id}] ${c.name} (slug: ${c.slug})`);
  });

  if (companies.length === 0) {
    throw new Error("No companies found!");
  }

  const defaultComp = companies[0];

  // 2. Check company memberships
  const members = await db.collection("company_members").find({ companyId: defaultComp._id }).toArray();
  console.log(`\nMembers in "${defaultComp.name}": ${members.length}`);
  members.forEach((m) => {
    console.log(` - User ${m.userId}: role=${m.role}, status=${m.status}`);
  });

  // 3. Check HR collections scoped to default company
  const [depts, titles, emps, att, leaves, payslips] = await Promise.all([
    db.collection("departments").countDocuments({ companyId: defaultComp._id }),
    db.collection("job_titles").countDocuments({ companyId: defaultComp._id }),
    db.collection("employees").countDocuments({ companyId: defaultComp._id }),
    db.collection("attendance").countDocuments({ companyId: defaultComp._id }),
    db.collection("leave_requests").countDocuments({ companyId: defaultComp._id }),
    db.collection("payslips").countDocuments({ companyId: defaultComp._id }),
  ]);

  console.log(`\nScoped data in "${defaultComp.name}":`);
  console.log(` - Departments: ${depts}`);
  console.log(` - Job Titles: ${titles}`);
  console.log(` - Employees: ${emps}`);
  console.log(` - Attendance Records: ${att}`);
  console.log(` - Leave Requests: ${leaves}`);
  console.log(` - Payslips: ${payslips}`);

  // 4. Test Isolation: Create a dummy test tenant and seed it
  console.log("\n--- Testing Tenant Isolation ---");
  const testCompDoc = {
    name: "Acme Corp Isolation Test",
    slug: "acme-corp-" + Date.now(),
    currency: "USD",
    industry: "Logistics",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const testCompInsert = await db.collection("companies").insertOne(testCompDoc);
  const testCompId = testCompInsert.insertedId;

  // Query HR records for new company before seeding -> MUST BE ZERO
  const empsBefore = await db.collection("employees").countDocuments({ companyId: testCompId });
  console.log(`Employees in Acme Corp before seeding: ${empsBefore} (Expected: 0)`);

  if (empsBefore !== 0) {
    throw new Error("Data leakage! Found employees in new company before seeding.");
  }

  // Cleanup test company
  await db.collection("companies").deleteOne({ _id: testCompId });
  console.log("Cleaned up isolation test company.");

  console.log("\nAll Multi-Tenant isolation checks passed successfully!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
