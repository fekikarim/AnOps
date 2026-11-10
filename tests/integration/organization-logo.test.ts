import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GridFSBucket, ObjectId, type Db } from "mongodb";
import { createHarness, type TestHarness } from "../helpers/workspace";
import { jpegBytes, pngBytes } from "../helpers/images";

const shared = vi.hoisted(() => ({ db: null as unknown, sent: [] as unknown[] }));
vi.mock("@/server/db/client", () => ({ default: Promise.resolve({ db: () => shared.db }) }));
vi.mock("@/server/auth", () => ({ auth: async () => null }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: () => undefined }));
vi.mock("@/server/tenant/context", () => ({ getActiveTenant: async () => null }));
vi.mock("@/server/email/client", () => ({ sendMail: async (m: unknown) => (shared.sent.push(m), { delivered: true }) }));

const { registerOrganization } = await import("@/server/platform/registration.service");
const { activateOrganization } = await import("@/server/platform/activation.service");
const { generateLogoCandidate, setOrganizationLogo, openOrganizationLogo, getLogoStudioStatus, buildLogoPrompt, logoRequestSchema, LOGO_BUCKET } = await import("@/server/platform/organization-logo.service");
const { ImageProviderError } = await import("@/server/ai/image/gemini-image.provider");

type Access = Parameters<typeof generateLogoCandidate>[0];
let h: TestHarness;
beforeAll(async () => {
  h = await createHarness();
  shared.db = h.db;
});
afterAll(async () => h.cleanup());
beforeEach(() => {
  delete process.env.AI_KILL_SWITCH;
});

let seq = 0;
async function makeOrg(apps = ["finance", "inventory"]) {
  const email = `logo.owner${++seq}.${Date.now()}@example.test`;
  const reg = await registerOrganization(h.db, { firstName: "Amira", lastName: "Ben Salah", organizationName: `Logo Co ${seq}`, email, phone: "+216 20 123 456", currency: "TND", password: "Secure1234", confirmPassword: "Secure1234", acceptTerms: true, apps }, { ip: `10.1.0.${seq}`, requestId: "r" });
  const token = /activate\?token=([A-Za-z0-9_-]{43})/.exec(JSON.stringify(shared.sent.at(-1)))?.[1] ?? "";
  if (token) await activateOrganization(h.db, token, "req");
  return reg;
}
const accessFor = (db: Db, companyId: ObjectId, userId: ObjectId, role: "owner" | "admin" | "manager" | "employee" = "owner", aiFeatures = true): Access =>
  ({ ctx: { db, companyId, userId, requestId: "req-logo" }, companyRole: role, entitlements: { aiFeatures } }) as unknown as Access;

const okProvider = (bytes = jpegBytes(1024, 1024)) => {
  const generate = vi.fn(async () => ({ bytes, mimeType: "image/jpeg" as const, model: "mock-model" }));
  return { generate, configured: true, status: () => ({}) } as unknown as Parameters<typeof generateLogoCandidate>[2] extends infer D ? (D extends { provider?: infer P } ? P : never) : never;
};
const brief = { mode: "new", description: "A simple window frame made of two overlapping squares" };
const toDataUrl = (bytes: Buffer, mime = "image/png") => `data:${mime};base64,${bytes.toString("base64")}`;
const code = (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string }) => e.code ?? "ERR");
async function logoOf(companyId: ObjectId) {
  return (await h.db.collection("companies").findOne({ _id: companyId })) as { logoUrl?: string; logoFileId?: ObjectId } | null;
}
const filesInBucket = () => h.db.collection(`${LOGO_BUCKET}.files`).countDocuments();

describe("generation", () => {
  it("returns a candidate for the owner and sends a text-only brief that never asks Gemini for the name", async () => {
    const reg = await makeOrg();
    const provider = okProvider();
    const out = await generateLogoCandidate(accessFor(h.db, reg.companyId, reg.userId), { ...brief, style: "geometric", colors: "green and lime", industry: "Manufacturing" }, { provider });
    expect(out).toMatchObject({ mimeType: "image/jpeg", model: "mock-model" });
    expect(Buffer.from(out.dataBase64, "base64").length).toBeGreaterThan(0);
    const prompt = (provider.generate as ReturnType<typeof vi.fn>).mock.calls[0][0].prompt as string;
    expect(prompt).toContain("two overlapping squares");
    expect(prompt).toContain("geometric");
    expect(prompt).toContain("Do not include any text");
    expect(prompt).not.toContain("Logo Co");
    // Nothing was stored and the organization's logo is untouched.
    expect((await logoOf(reg.companyId))?.logoUrl).toBeUndefined();
    expect(await h.db.collection("audit_events").findOne({ companyId: reg.companyId, action: "organization.logo_generated" })).toMatchObject({ metadata: { mode: "new", model: "mock-model" } });
    expect(JSON.stringify(await h.db.collection("audit_events").find({ companyId: reg.companyId }).toArray())).not.toContain("overlapping squares");
  });

  it("edits an existing image with a new instruction", async () => {
    const reg = await makeOrg();
    const provider = okProvider();
    await generateLogoCandidate(accessFor(h.db, reg.companyId, reg.userId), { mode: "edit", instruction: "make the shapes rounder", image: { mimeType: "image/png", dataBase64: pngBytes(900, 900).toString("base64") } }, { provider });
    const call = (provider.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.prompt).toContain("make the shapes rounder");
    expect(call.image).toMatchObject({ mimeType: "image/png" });
  });

  it("only the owner may generate; admins, managers and employees are refused before Gemini is called", async () => {
    const reg = await makeOrg();
    const provider = okProvider();
    for (const role of ["admin", "manager", "employee"] as const) {
      expect(await code(generateLogoCandidate(accessFor(h.db, reg.companyId, reg.userId, role), brief, { provider }))).toBe("FORBIDDEN");
    }
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it("requires a plan with AI features and respects the platform kill switch", async () => {
    const free = await makeOrg(["finance"]); // one application: permanent free plan, no AI
    const provider = okProvider();
    expect(await code(generateLogoCandidate(accessFor(h.db, free.companyId, free.userId), brief, { provider }))).toBe("FORBIDDEN");
    const paid = await makeOrg();
    process.env.AI_KILL_SWITCH = "true";
    expect(await code(generateLogoCandidate(accessFor(h.db, paid.companyId, paid.userId), brief, { provider }))).toBe("FORBIDDEN");
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it("validates the request and the source image", async () => {
    const reg = await makeOrg();
    const provider = okProvider();
    const a = accessFor(h.db, reg.companyId, reg.userId);
    expect(await code(generateLogoCandidate(a, { mode: "new", description: "short" }, { provider }))).toBe("VALIDATION_ERROR");
    expect(await code(generateLogoCandidate(a, { mode: "edit", instruction: "x", image: { mimeType: "image/png", dataBase64: "abc" } }, { provider }))).toBe("VALIDATION_ERROR");
    expect(await code(generateLogoCandidate(a, { mode: "edit", instruction: "make it blue", image: { mimeType: "image/png", dataBase64: Buffer.from("<svg>" + "x".repeat(200) + "</svg>").toString("base64") } }, { provider }))).toBe("VALIDATION_ERROR");
    expect(provider.generate).not.toHaveBeenCalled();
    expect(logoRequestSchema.safeParse({ mode: "new", description: "A\u0000B\n\n   logo   concept here" }).data).toMatchObject({ description: "A B logo concept here" });
  });

  it("limits how often one person can generate (cost control) and answers with a clear message", async () => {
    const reg = await makeOrg();
    const provider = okProvider();
    const a = accessFor(h.db, reg.companyId, reg.userId);
    for (let i = 0; i < 6; i++) await generateLogoCandidate(a, brief, { provider });
    expect(await code(generateLogoCandidate(a, brief, { provider }))).toBe("RATE_LIMITED");
    expect(provider.generate).toHaveBeenCalledTimes(6);
  });

  it("allows only one generation at a time per organization and releases the lock after a failure", async () => {
    const reg = await makeOrg();
    let release!: () => void;
    const slow = { configured: true, generate: vi.fn(() => new Promise((resolve) => (release = () => resolve({ bytes: jpegBytes(), mimeType: "image/jpeg", model: "m" })))) } as never;
    const a = accessFor(h.db, reg.companyId, reg.userId);
    const first = generateLogoCandidate(a, brief, { provider: slow });
    await vi.waitFor(() => expect((slow as { generate: ReturnType<typeof vi.fn> }).generate).toHaveBeenCalled());
    expect(await code(generateLogoCandidate(a, brief, { provider: okProvider() }))).toBe("CONFLICT");
    release();
    await first;
    // After a provider failure the lock is gone: the owner can try again at once.
    const failing = { configured: true, generate: vi.fn(async () => { throw new ImageProviderError("unavailable", "down"); }) } as never;
    expect(await code(generateLogoCandidate(a, brief, { provider: failing }))).toBe("INTERNAL");
    expect(await code(generateLogoCandidate(a, brief, { provider: okProvider() }))).toBe("OK");
  });

  it("turns every provider failure into an actionable message and keeps the logo untouched", async () => {
    const reg = await makeOrg();
    const a = accessFor(h.db, reg.companyId, reg.userId);
    const cases: Array<[ConstructorParameters<typeof ImageProviderError>[0], string, RegExp]> = [
      ["not_configured", "PROVIDER_NOT_CONFIGURED", /GEMINI_API_KEYS/],
      ["billing_required", "PROVIDER_NOT_CONFIGURED", /billing/i],
      ["invalid_credentials", "PROVIDER_NOT_CONFIGURED", /rejected/],
      ["rate_limited", "RATE_LIMITED", /try again/i],
      ["blocked", "VALIDATION_ERROR", /Rephrase/],
      ["invalid_request", "VALIDATION_ERROR", /Adjust/],
      ["timeout", "INTERNAL", /too long/],
      ["unavailable", "INTERNAL", /temporarily unavailable/],
      ["bad_response", "INTERNAL", /usable image/],
    ];
    for (const [kind, expectedCode, message] of cases) {
      const provider = { configured: true, generate: async () => { throw new ImageProviderError(kind, "x", 120); } } as never;
      const error = await generateLogoCandidate(a, brief, { provider }).then(() => null, (e: { code: string; message: string }) => e);
      expect(error?.code, kind).toBe(expectedCode);
      expect(error?.message, kind).toMatch(message);
      // Even a failing provider must never leak a key or an upstream detail.
      expect(error?.message).not.toMatch(/AQ\.|AIza|upstream/);
      await h.db.collection("organization_logo_locks").deleteMany({});
      await h.db.collection("rate_limits").deleteMany({ key: /^logo:gen:user/ });
    }
    expect((await logoOf(reg.companyId))?.logoUrl).toBeUndefined();
  });

  it("tells the studio when it is not available and why", async () => {
    const owner = await makeOrg();
    const provider = okProvider();
    expect(await getLogoStudioStatus(accessFor(h.db, owner.companyId, owner.userId), provider)).toMatchObject({ available: true });
    expect(await getLogoStudioStatus(accessFor(h.db, owner.companyId, owner.userId, "admin"), provider)).toMatchObject({ available: false, reason: "not_owner" });
    expect(await getLogoStudioStatus(accessFor(h.db, owner.companyId, owner.userId, "owner", false), provider)).toMatchObject({ available: false, reason: "plan" });
    expect(await getLogoStudioStatus(accessFor(h.db, owner.companyId, owner.userId), { configured: false } as never)).toMatchObject({ available: false, reason: "not_configured" });
  });

  it("brief builder: concept, optional preferences, and never the organization name", () => {
    const text = buildLogoPrompt({ mode: "new", description: "a leaf", style: "minimal", colors: "teal" });
    expect(text).toMatch(/Concept: a leaf/);
    expect(text).toMatch(/Visual style: minimal/);
    expect(text).toMatch(/Preferred colors: teal/);
    expect(text).not.toMatch(/Industry/);
  });
});

describe("confirming a logo", () => {
  it("stores the image, points the organization at it, serves it back and shows it for the right organization only", async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    const bytes = pngBytes(512, 512);
    const result = await setOrganizationLogo(accessFor(h.db, a.companyId, a.userId), toDataUrl(bytes));
    const company = await logoOf(a.companyId);
    expect(result.logoUrl).toBe(company?.logoUrl);
    expect(result.logoUrl).toMatch(new RegExp(`^/api/v1/organizations/${a.companyId.toHexString()}/logo\\?v=[0-9a-f]{24}$`));
    const file = await openOrganizationLogo(h.db, a.companyId);
    expect(file).toMatchObject({ mimeType: "image/png", size: bytes.length });
    const chunks: Buffer[] = [];
    for await (const chunk of file!.stream) chunks.push(Buffer.from(chunk as Buffer));
    expect(Buffer.concat(chunks).equals(bytes)).toBe(true);
    expect(await h.db.collection("audit_events").findOne({ companyId: a.companyId, action: "organization.logo_updated" })).toBeTruthy();
    // The other organization is untouched and has no logo to read.
    expect((await logoOf(b.companyId))?.logoUrl).toBeUndefined();
    expect(await openOrganizationLogo(h.db, b.companyId)).toBeNull();
  });

  it("only the owner may confirm", async () => {
    const reg = await makeOrg();
    for (const role of ["admin", "manager", "employee"] as const) expect(await code(setOrganizationLogo(accessFor(h.db, reg.companyId, reg.userId, role), toDataUrl(pngBytes())))).toBe("FORBIDDEN");
    expect((await logoOf(reg.companyId))?.logoUrl).toBeUndefined();
  });

  it("cannot be pointed at another organization: the change always lands on the caller's own organization", async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    await setOrganizationLogo(accessFor(h.db, a.companyId, a.userId), toDataUrl(pngBytes()));
    expect((await logoOf(b.companyId))?.logoFileId).toBeUndefined();
    // A file that does not belong to the company is never served, even if a record points at it.
    const aFile = (await logoOf(a.companyId))!.logoFileId!;
    await h.db.collection("companies").updateOne({ _id: b.companyId }, { $set: { logoFileId: aFile } });
    expect(await openOrganizationLogo(h.db, b.companyId)).toBeNull();
  });

  it("replaces the previous logo only after the new one is saved, and removes the old file", async () => {
    const reg = await makeOrg();
    const a = accessFor(h.db, reg.companyId, reg.userId);
    await setOrganizationLogo(a, toDataUrl(pngBytes(300, 300)));
    const first = (await logoOf(reg.companyId))!;
    const before = await filesInBucket();
    await setOrganizationLogo(a, toDataUrl(jpegBytes(400, 400), "image/jpeg"));
    const second = (await logoOf(reg.companyId))!;
    expect(second.logoFileId?.equals(first.logoFileId!)).toBe(false);
    expect(second.logoUrl).not.toBe(first.logoUrl);
    expect(await filesInBucket()).toBe(before); // one in, one out
    expect(await new GridFSBucket(h.db, { bucketName: LOGO_BUCKET }).find({ _id: first.logoFileId }).toArray()).toHaveLength(0);
  });

  it("rejects wrong types, fake extensions, tiny, huge and oversized images, and keeps the current logo", async () => {
    const reg = await makeOrg();
    const a = accessFor(h.db, reg.companyId, reg.userId);
    await setOrganizationLogo(a, toDataUrl(pngBytes(256, 256)));
    const keep = (await logoOf(reg.companyId))!.logoUrl;
    const bad: Array<[string, string]> = [
      ["svg", toDataUrl(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'.padEnd(200, " ")), "image/svg+xml")],
      ["html renamed to png", toDataUrl(Buffer.from("<html>" + "x".repeat(300) + "</html>"), "image/png")],
      ["pdf", toDataUrl(Buffer.from("%PDF-1.7 " + "x".repeat(300)), "application/pdf")],
      ["too small", toDataUrl(pngBytes(64, 64))],
      ["too large side", toDataUrl(pngBytes(9000, 9000))],
      ["too wide", toDataUrl(pngBytes(3000, 300))],
      ["over 3 MB", toDataUrl(pngBytes(512, 512, 3 * 1024 * 1024 + 10))],
      ["empty", ""],
    ];
    for (const [name, image] of bad) expect(await code(setOrganizationLogo(a, image)), name).toBe("VALIDATION_ERROR");
    expect((await logoOf(reg.companyId))!.logoUrl).toBe(keep);
  });

  it("if saving fails the previous logo stays, the half-saved file is removed, and the owner can retry", async () => {
    const reg = await makeOrg();
    const good = accessFor(h.db, reg.companyId, reg.userId);
    await setOrganizationLogo(good, toDataUrl(pngBytes(256, 256)));
    const before = (await logoOf(reg.companyId))!;
    const files = await filesInBucket();
    // The organization record cannot be updated (simulated database failure).
    const failingDb = new Proxy(h.db, {
      get(target, prop, receiver) {
        if (prop !== "collection") return Reflect.get(target, prop, receiver);
        return (name: string) => {
          const collection = target.collection(name);
          return name === "companies" ? new Proxy(collection, { get: (c, p, r) => (p === "updateOne" ? async () => { throw new Error("db down"); } : Reflect.get(c, p, r)) }) : collection;
        };
      },
    }) as Db;
    const error = await setOrganizationLogo(accessFor(failingDb, reg.companyId, reg.userId), toDataUrl(pngBytes(300, 300))).then(() => null, (e: { code: string; message: string }) => e);
    expect(error?.code).toBe("INTERNAL");
    expect(error?.message).toMatch(/previous logo is unchanged/);
    expect(await filesInBucket()).toBe(files);
    expect((await logoOf(reg.companyId))!.logoUrl).toBe(before.logoUrl);
    // Retry with the healthy connection works.
    await setOrganizationLogo(good, toDataUrl(pngBytes(300, 300)));
    expect((await logoOf(reg.companyId))!.logoUrl).not.toBe(before.logoUrl);
  });

  it("limits how often the logo can be changed", async () => {
    const reg = await makeOrg();
    const a = accessFor(h.db, reg.companyId, reg.userId);
    for (let i = 0; i < 20; i++) await setOrganizationLogo(a, toDataUrl(pngBytes(256 + i, 256)));
    expect(await code(setOrganizationLogo(a, toDataUrl(pngBytes(300, 300))))).toBe("RATE_LIMITED");
  });
});
