/**
 * Migrates data written by the earlier organization-based tenancy to the company tenancy.
 *
 *   node scripts/migrate-multi-tenant.mjs            # dry run: prints what would change, writes nothing
 *   node scripts/migrate-multi-tenant.mjs --apply    # performs the migration
 *
 * What it does (idempotent: safe to run twice):
 *   1. Legacy company documents (organizationId set, no ownerId) become company tenants.
 *      Their _id is kept, so inventory/purchasing/manufacturing references stay valid.
 *   2. Legacy memberships become company_members (owner -> owner, admin -> admin,
 *      operator -> manager, viewer -> employee).
 *   3. HR documents with no companyId (departments, job_titles, employees, leave_requests,
 *      attendance, payslips) are assigned to the default company "AnOps Technologies"
 *      (slug anops-technologies), created if it does not exist yet.
 *   4. The organizationId field is removed from tenant documents and audit events.
 *   5. The legacy organizations and memberships collections are renamed with a _legacy_ prefix.
 *      Nothing is deleted.
 *
 * Reads MONGODB_URI from the environment, or from .env when it is not set.
 * Run a dry run and review the output before using --apply on any database with real data.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { MongoClient, ObjectId } from "mongodb";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

const APPLY = process.argv.includes("--apply");
const TENANT_COLLECTIONS = [
  "inventory_categories",
  "inventory_products",
  "inventory_warehouses",
  "inventory_stock_balances",
  "inventory_stock_movements",
  "purchase_suppliers",
  "purchase_orders",
  "goods_receipts",
  "manufacturing_boms",
  "manufacturing_work_orders",
  "audit_events",
];
const HR_COLLECTIONS = ["departments", "job_titles", "employees", "leave_requests", "attendance", "payslips"];
const ROLE_MAP = { owner: "owner", admin: "admin", operator: "manager", viewer: "employee" };
// Same default as scripts/migrate-to-multitenant.mjs, so running either script never creates a second default.
const DEFAULT_COMPANY_NAME = "AnOps Technologies";
const DEFAULT_COMPANY_SLUG = "anops-technologies";

function loadUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  const envPath = path.join(SCRIPT_DIR, "..", ".env");
  if (fs.existsSync(envPath)) {
    const line = fs.readFileSync(envPath, "utf8").split("\n").find((l) => l.startsWith("MONGODB_URI="));
    if (line) return line.slice("MONGODB_URI=".length).replace(/^"|"$/g, "");
  }
  throw new Error("MONGODB_URI is not set");
}

function slugify(value) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "company";
}

async function uniqueSlug(db, base) {
  let slug = base;
  let n = 1;
  while (await db.collection("companies").findOne({ slug })) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
}

const report = [];
const note = (step, detail) => {
  report.push({ step, detail });
  console.log(`[${APPLY ? "apply" : "dry-run"}] ${step}: ${detail}`);
};

async function main() {
  const client = new MongoClient(loadUri(), { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db();
  console.log(`Database: ${db.databaseName}  mode: ${APPLY ? "APPLY" : "DRY RUN (no writes)"}`);

  const legacyOrgs = await db.collection("organizations").find({}).toArray();
  const legacyCompanies = await db
    .collection("companies")
    .find({ organizationId: { $exists: true }, ownerId: { $exists: false } })
    .toArray();
  const legacyMemberships = await db.collection("memberships").find({}).toArray();

  // 1. Company tenants
  const companyForOrg = new Map();
  for (const company of legacyCompanies) {
    const org = legacyOrgs.find((o) => String(o._id) === String(company.organizationId));
    const ownerId = org?.ownerUserId;
    const name = company.name || org?.name || "Company";
    const slug = await uniqueSlug(db, slugify(name));
    companyForOrg.set(String(company.organizationId), company._id);
    note("company", `${name} (${company._id}) -> company tenant, owner ${ownerId ? String(ownerId) : "UNKNOWN"}`);
    if (APPLY && ownerId) {
      await db.collection("companies").updateOne(
        { _id: company._id },
        {
          $set: { name, slug, ownerId, currency: company.currencyCode || "TND", industry: "General", updatedAt: new Date() },
          $unset: { organizationId: "", currencyCode: "", timezone: "", isActive: "" },
        }
      );
    }
  }

  // 2. Memberships -> company_members
  for (const m of legacyMemberships) {
    const companyId = companyForOrg.get(String(m.organizationId));
    if (!companyId) continue;
    const role = ROLE_MAP[m.role] || "employee";
    note("member", `user ${String(m.userId)} -> ${role} in company ${String(companyId)}`);
    if (APPLY) {
      await db.collection("company_members").updateOne(
        { companyId, userId: m.userId },
        {
          $setOnInsert: { companyId, userId: m.userId, createdAt: m.createdAt || new Date() },
          $set: { role, status: m.status === "active" ? "active" : "invited", updatedAt: new Date() },
        },
        { upsert: true }
      );
    }
  }

  // 3. Unscoped HR documents -> default company
  const unscoped = {};
  for (const name of HR_COLLECTIONS) {
    unscoped[name] = await db.collection(name).countDocuments({ companyId: { $exists: false } });
  }
  const unscopedTotal = Object.values(unscoped).reduce((a, b) => a + b, 0);
  if (unscopedTotal > 0) {
    const firstUser = await db.collection("users").findOne({}, { sort: { createdAt: 1 } });
    let defaultCompany = await db.collection("companies").findOne({ slug: DEFAULT_COMPANY_SLUG });
    if (!defaultCompany) {
      if (!firstUser) throw new Error("Cannot create a default company: no users exist");
      const id = new ObjectId();
      note("default-company", `create "${DEFAULT_COMPANY_NAME}" (${id}) owned by ${String(firstUser._id)}`);
      defaultCompany = { _id: id, name: DEFAULT_COMPANY_NAME, slug: DEFAULT_COMPANY_SLUG };
      if (APPLY) {
        await db.collection("companies").insertOne({
          _id: id,
          name: DEFAULT_COMPANY_NAME,
          slug: DEFAULT_COMPANY_SLUG,
          ownerId: firstUser._id,
          currency: "TND",
          industry: "Information Technology",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        await db.collection("company_members").insertOne({
          companyId: id,
          userId: firstUser._id,
          role: "owner",
          status: "active",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    }
    for (const [name, count] of Object.entries(unscoped)) {
      if (count === 0) continue;
      note("hr-scope", `${count} document(s) in ${name} -> company ${DEFAULT_COMPANY_NAME}`);
      if (APPLY) {
        await db.collection(name).updateMany({ companyId: { $exists: false } }, { $set: { companyId: defaultCompany._id } });
      }
    }
  }

  // 3b. Every company gets the same default departments and predefined job titles that createCompany
  // seeds (src/features/hr/defaults/company-structure.json). Companies that already have departments are left alone.
  const structure = JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, "..", "src", "features", "hr", "defaults", "company-structure.json"), "utf8"));
  const tenantCompanies = await db.collection("companies").find({ ownerId: { $exists: true } }).toArray();
  for (const company of tenantCompanies) {
    const deptCount = await db.collection("departments").countDocuments({ companyId: company._id });
    if (deptCount > 0) continue;
    note("default-structure", `${structure.departments.length} departments and ${structure.jobTitles.length} job titles -> company ${String(company._id)}`);
    if (APPLY) {
      const now = new Date();
      const inserted = await db.collection("departments").insertMany(
        structure.departments.map((d) => ({ ...d, companyId: company._id, createdAt: now, updatedAt: now }))
      );
      const deptIdByName = new Map(structure.departments.map((d, i) => [d.name, inserted.insertedIds[i]]));
      await db.collection("job_titles").insertMany(
        structure.jobTitles.map((t) => ({
          title: t.title,
          departmentId: deptIdByName.get(t.deptName)?.toString() ?? "",
          companyId: company._id,
          isPredefined: true,
          createdAt: now,
        }))
      );
    }
  }

  // 4. Remove organizationId from tenant documents
  for (const name of TENANT_COLLECTIONS) {
    const count = await db.collection(name).countDocuments({ organizationId: { $exists: true } });
    if (count === 0) continue;
    note("unset-organization", `${count} document(s) in ${name}`);
    if (APPLY) await db.collection(name).updateMany({ organizationId: { $exists: true } }, { $unset: { organizationId: "" } });
  }

  // 5. Rename legacy collections (non-destructive)
  for (const name of ["organizations", "memberships"]) {
    const exists = (await db.listCollections({ name }).toArray()).length > 0;
    if (!exists) continue;
    note("rename", `${name} -> _legacy_${name}`);
    if (APPLY) await db.collection(name).rename(`_legacy_${name}`);
  }

  // 6. Drop obsolete audit index that referenced organizationId
  if (APPLY) {
    const indexes = await db.collection("audit_events").indexes().catch(() => []);
    for (const idx of indexes) {
      if (idx.key && idx.key.organizationId !== undefined) {
        await db.collection("audit_events").dropIndex(idx.name);
        note("drop-index", `audit_events.${idx.name}`);
      }
    }
  }

  console.log(`\n${report.length} planned change(s). ${APPLY ? "Applied." : "Dry run: nothing was written. Re-run with --apply to migrate."}`);
  await client.close();
}

main().catch((error) => {
  console.error("Migration failed:", error.message);
  process.exit(1);
});
