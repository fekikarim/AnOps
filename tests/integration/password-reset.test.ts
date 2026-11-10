import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { createHash } from "crypto";
import { createHarness, type TestHarness } from "../helpers/workspace";

const shared = vi.hoisted(() => ({ db: null as unknown, sent: [] as Array<{ to: string; subject: string; html: string; text: string }> }));
vi.mock("@/server/db/client", () => ({ default: Promise.resolve({ db: () => shared.db }) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/server/email/client", () => ({ sendMail: async (m: (typeof shared.sent)[number]) => (shared.sent.push(m), { delivered: true }) }));

const { requestPasswordReset } = await import("@/features/auth/actions/password-reset-request.action");
const { resetPassword } = await import("@/features/auth/actions/password-reset.action");
const { registerUser } = await import("@/features/auth/actions/register.action");
const { hashResetToken, generateResetToken, maskEmail, safeEqual } = await import("@/server/auth/reset-token");

let h: TestHarness;
beforeAll(async () => {
  h = await createHarness();
  shared.db = h.db;
});
afterAll(async () => h.cleanup());
beforeEach(() => {
  shared.sent.length = 0;
});

const users = () => h.db.collection("users");
let seq = 0;
async function makeUser() {
  const email = `reset${++seq}@example.test`;
  await users().insertOne({ name: "Reset User", email, password: await bcrypt.hash("OldPassword1", 4), role: "employee", status: "active", emailVerified: new Date(), createdAt: new Date(), updatedAt: new Date() });
  return email;
}
const tokenFromMail = () => decodeURIComponent(shared.sent.at(-1)!.text.match(/reset-password\?token=([^\s"<&]+)/)![1]);
const NEW_PASSWORD = "NewPassword123";

describe("password reset tokens", () => {
  it("emails a token but stores only its SHA-256 hash", async () => {
    const email = await makeUser();
    await requestPasswordReset({ email });
    const token = tokenFromMail();
    const doc = await users().findOne({ email });
    expect(token.length).toBeGreaterThanOrEqual(43); // 256 bits, base64url
    expect(doc?.passwordResetToken).toBeUndefined();
    expect(doc?.passwordResetTokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(doc)).not.toContain(token);
  });

  it("changes the password with a valid token, exactly once", async () => {
    const email = await makeUser();
    await requestPasswordReset({ email });
    const token = tokenFromMail();
    expect(await resetPassword({ token, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })).toMatchObject({ ok: true });
    const after = await users().findOne({ email });
    expect(await bcrypt.compare(NEW_PASSWORD, after!.password as string)).toBe(true);
    expect(after?.passwordResetTokenHash).toBeUndefined();
    expect(after?.passwordResetExpires).toBeUndefined();
    // Reused token fails and changes nothing.
    const reuse = await resetPassword({ token, password: "AnotherPassword9", confirmPassword: "AnotherPassword9" });
    expect(reuse.ok).toBe(false);
    expect(await bcrypt.compare(NEW_PASSWORD, (await users().findOne({ email }))!.password as string)).toBe(true);
  });

  it("lets only one of two simultaneous requests use the token", async () => {
    const email = await makeUser();
    await requestPasswordReset({ email });
    const token = tokenFromMail();
    const results = await Promise.all([1, 2, 3].map(() => resetPassword({ token, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("rejects expired, unknown and plain-text-stored tokens", async () => {
    const email = await makeUser();
    await requestPasswordReset({ email });
    const token = tokenFromMail();
    await users().updateOne({ email }, { $set: { passwordResetExpires: new Date(Date.now() - 1000) } });
    expect((await resetPassword({ token, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })).ok).toBe(false);
    expect((await resetPassword({ token: generateResetToken(), password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })).ok).toBe(false);
    // A leaked hash cannot be replayed as a token.
    const doc = await users().findOne({ email });
    await users().updateOne({ email }, { $set: { passwordResetExpires: new Date(Date.now() + 60_000) } });
    expect((await resetPassword({ token: doc!.passwordResetTokenHash as string, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })).ok).toBe(false);
    // An old-format plain token in the database no longer works.
    await users().updateOne({ email }, { $set: { passwordResetToken: "legacy-plain-token-value-1234567890", passwordResetExpires: new Date(Date.now() + 60_000) } });
    expect((await resetPassword({ token: "legacy-plain-token-value-1234567890", password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })).ok).toBe(false);
  });

  it("a newer request replaces the older link", async () => {
    const email = await makeUser();
    await requestPasswordReset({ email });
    const first = tokenFromMail();
    await requestPasswordReset({ email });
    const second = tokenFromMail();
    expect(second).not.toBe(first);
    expect((await resetPassword({ token: first, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })).ok).toBe(false);
    expect((await resetPassword({ token: second, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })).ok).toBe(true);
  });

  it("answers the same for unknown accounts and sends nothing", async () => {
    const result = await requestPasswordReset({ email: "nobody@example.test" });
    expect(result).toMatchObject({ ok: true, message: "If an account exists, a reset link has been sent." });
    expect(shared.sent).toHaveLength(0);
  });
});

describe("auth helpers", () => {
  it("masks e-mail addresses for logs and compares secrets without leaking length", () => {
    expect(maskEmail("jane.doe@example.com")).toBe("j***@example.com");
    expect(maskEmail("not-an-email")).toBe("***");
    expect(hashResetToken("a")).toHaveLength(64);
    expect(safeEqual("secret", "secret")).toBe(true);
    expect(safeEqual("secret", "secreT")).toBe(false);
    expect(safeEqual("short", "a-much-longer-value")).toBe(false);
  });
});

describe("legacy registration", () => {
  it("gives the same answer for new and already-registered addresses (no account enumeration)", async () => {
    const taken = await makeUser();
    const fresh = `fresh${++seq}@example.test`;
    const a = await registerUser({ name: "Someone Else", email: taken, password: "StrongPassw0rd", confirmPassword: "StrongPassw0rd" });
    const mailsForTaken = shared.sent.length;
    const b = await registerUser({ name: "New Person", email: fresh, password: "StrongPassw0rd", confirmPassword: "StrongPassw0rd" });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(a.message).toBe(b.message);
    expect(a.email).toEqual(b.email);
    // The verified account is untouched and received nothing; only the new address got a verification mail.
    expect(mailsForTaken).toBe(0);
    expect(shared.sent).toHaveLength(1);
    expect(shared.sent[0].to).toBe(fresh);
  });
});
