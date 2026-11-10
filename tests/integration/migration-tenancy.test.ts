import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import path from "path";
import { MongoClient, ObjectId } from "mongodb";

/**
 * Runs scripts/migrate-multi-tenant.mjs against a database seeded with the legacy organization model
 * and checks the company-tenant result. Also checks that a second run changes nothing.
 */
const BASE_URI = process.env.MONGODB_TEST_URI ?? "mongodb://127.0.0.1:27018/?replicaSet=rs0&directConnection=true";
const DB_NAME = `anops_migration_test_${new ObjectId().toHexString()}`;
const url = new URL(BASE_URI);
url.pathname = `/${DB_NAME}`;
const uri = url.toString();
const script = path.join(process.cwd(), "scripts", "migrate-multi-tenant.mjs");

const client = new MongoClient(BASE_URI, { serverSelectionTimeoutMS: 5000 });
const db = () => client.db(DB_NAME);

const userId = new ObjectId();
const orgId = new ObjectId();
const companyId = new ObjectId();
const productId = new ObjectId();
const departmentId = new ObjectId();

function runMigration(...args: string[]) {
  return execFileSync(process.execPath, [script, ...args], {
    env: { ...process.env, MONGODB_URI: uri },
    encoding: "utf8",
  });
}

beforeAll(async () => {
  await client.connect();
  const now = new Date();
  await db().collection("users").insertOne({ _id: userId, email: "owner@legacy.test", emailVerified: now, status: "active", createdAt: now });
  await db().collection("organizations").insertOne({ _id: orgId, name: "Legacy Co", slug: "legacy-co", ownerUserId: userId, status: "active", createdAt: now });
  await db().collection("companies").insertOne({ _id: companyId, organizationId: orgId, name: "Legacy Co", currencyCode: "EUR", timezone: "Europe/Paris", isActive: true, createdAt: now });
  await db().collection("memberships").insertOne({ _id: new ObjectId(), organizationId: orgId, userId, role: "owner", status: "active", isPersonal: true, createdAt: now });
  await db().collection("inventory_products").insertOne({ organizationId: orgId, companyId, sku: "LEGACY-1", normalizedSku: "LEGACY-1", name: "Legacy item", isActive: true, isStorable: true, unitOfMeasure: "unit", costMilli: 0, salePriceMilli: 0, reorderPointMicro: 0, createdAt: now, updatedAt: now, version: 1 });
  await db().collection("departments").insertOne({ _id: departmentId, name: "Unassigned", createdAt: now });
});

afterAll(async () => {
  await db().dropDatabase().catch(() => undefined);
  await client.close();
});

describe("tenancy migration", () => {
  it("dry run writes nothing", async () => {
    const output = runMigration();
    expect(output).toContain("Dry run");
    const company = await db().collection("companies").findOne({ _id: companyId });
    expect(company?.organizationId).toBeDefined();
  });

  it("turns the legacy company into a company tenant with its owner and keeps the id", async () => {
    runMigration("--apply");
    const company = await db().collection("companies").findOne({ _id: companyId });
    expect(company?.ownerId).toEqual(userId);
    expect(company?.currency).toBe("EUR");
    expect(company?.organizationId).toBeUndefined();

    const member = await db().collection("company_members").findOne({ companyId, userId });
    expect(member?.role).toBe("owner");
  });

  it("removes organizationId from tenant documents without changing their companyId", async () => {
    const product = await db().collection("inventory_products").findOne({ sku: "LEGACY-1" });
    expect(product?.organizationId).toBeUndefined();
    expect(product?.companyId).toEqual(companyId);
  });

  it("assigns unscoped HR documents to the default company", async () => {
    const dept = await db().collection("departments").findOne({ _id: departmentId });
    const defaultCompany = await db().collection("companies").findOne({ slug: "anops-technologies" });
    expect(defaultCompany).not.toBeNull();
    expect(dept?.companyId).toEqual(defaultCompany?._id);
  });

  it("keeps the legacy collections under a _legacy_ name", async () => {
    const names = (await db().listCollections().toArray()).map((c) => c.name);
    expect(names).toContain("_legacy_organizations");
    expect(names).not.toContain("organizations");
  });

  it("is idempotent: a second run changes nothing", async () => {
    const before = await db().collection("company_members").countDocuments({});
    runMigration("--apply");
    expect(await db().collection("company_members").countDocuments({})).toBe(before);
    expect(await db().collection("companies").countDocuments({ slug: "anops-technologies" })).toBe(1);
  });
});
