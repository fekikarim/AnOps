import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ObjectId } from "mongodb";
import { createHarness, type TestHarness } from "../helpers/workspace";
import { pngBytes } from "../helpers/images";

const shared = vi.hoisted(() => ({ db: null as unknown, userId: null as string | null, sent: [] as unknown[] }));
vi.mock("@/server/db/client", () => ({ default: Promise.resolve({ db: () => shared.db }) }));
vi.mock("@/server/auth", () => ({ auth: async () => (shared.userId ? { user: { id: shared.userId } } : null) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: () => undefined }));
vi.mock("@/server/tenant/context", () => ({ getActiveTenant: async () => null }));
vi.mock("@/server/email/client", () => ({ sendMail: async (m: unknown) => (shared.sent.push(m), { delivered: true }) }));

const { registerOrganization } = await import("@/server/platform/registration.service");
const { activateOrganization } = await import("@/server/platform/activation.service");
const { setOrganizationLogo } = await import("@/server/platform/organization-logo.service");
const { GET } = await import("@/app/api/v1/organizations/[orgId]/logo/route");

let h: TestHarness;
beforeAll(async () => {
  h = await createHarness();
  shared.db = h.db;
});
afterAll(async () => h.cleanup());

let seq = 0;
async function makeOrg() {
  const reg = await registerOrganization(h.db, { firstName: "A", lastName: "B", organizationName: `Route Co ${++seq}`, email: `route${seq}.${Date.now()}@example.test`, phone: "+216 20 123 456", currency: "TND", password: "Secure1234", confirmPassword: "Secure1234", acceptTerms: true, apps: ["finance", "inventory"] }, { ip: `10.2.0.${seq}`, requestId: "r" });
  const token = /activate\?token=([A-Za-z0-9_-]{43})/.exec(JSON.stringify(shared.sent.at(-1)))?.[1] ?? "";
  if (token) await activateOrganization(h.db, token, "req");
  return reg as { companyId: ObjectId; userId: ObjectId };
}
const call = (orgId: ObjectId) => GET(new Request("http://localhost/x"), { params: Promise.resolve({ orgId: orgId.toHexString() }) });

describe("GET /api/v1/organizations/[orgId]/logo", () => {
  it("serves the logo to members only, with safe headers; others get the same 404 as a missing logo", async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    const bytes = pngBytes(256, 256);
    await setOrganizationLogo({ ctx: { db: h.db, companyId: a.companyId, userId: a.userId, requestId: "r" }, companyRole: "owner", entitlements: { aiFeatures: true } } as never, `data:image/png;base64,${bytes.toString("base64")}`);

    shared.userId = a.userId.toHexString();
    const ok = await call(a.companyId);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    expect(ok.headers.get("content-security-policy")).toContain("sandbox");
    expect(ok.headers.get("cache-control")).toContain("private");
    expect(Buffer.from(await ok.arrayBuffer()).equals(bytes)).toBe(true);

    // Owner of another organization asks for A's logo by id: 404, no information.
    shared.userId = b.userId.toHexString();
    expect((await call(a.companyId)).status).toBe(404);
    // Their own organization has no logo yet: same answer.
    expect((await call(b.companyId)).status).toBe(404);

    shared.userId = null;
    expect((await call(a.companyId)).status).toBe(401);
  });

  it("rejects ids that are not organization ids", async () => {
    shared.userId = (await makeOrg()).userId.toHexString();
    const res = await GET(new Request("http://localhost/x"), { params: Promise.resolve({ orgId: "not-an-id" }) });
    expect(res.status).toBe(404);
  });
});
