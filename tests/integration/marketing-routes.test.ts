import { describe, expect, it, vi } from "vitest";
import { signWebhookPayload } from "@/server/marketing/webhook-signature";

const SECRET = "w".repeat(40);
const WORKER = "k".repeat(40);

vi.mock("@/server/marketing/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/marketing/config")>();
  return { ...actual, getWebhookSecret: () => SECRET, getWorkerSecret: () => WORKER };
});

// No session by default. The callback test overrides this per case.
const authMock = vi.hoisted(() => ({
  auth: vi.fn(async (): Promise<{ user: { id: string } } | null> => null),
}));
vi.mock("@/server/auth", () => ({ auth: authMock.auth }));

const eventBody = JSON.stringify({
  eventId: "route-evt-1",
  type: "delivered",
  providerMessageId: "route-message-that-does-not-exist",
  occurredAt: "2026-10-26T10:00:00.000Z",
});

describe("worker endpoint", () => {
  it("rejects requests without the bearer secret", async () => {
    const { POST } = await import("@/app/api/v1/marketing/worker/route");
    const response = await POST(new Request("http://localhost/api/v1/marketing/worker", { method: "POST" }));
    expect(response.status).toBe(401);
  });

  it("rejects a wrong secret of the same length without running jobs", async () => {
    const { POST } = await import("@/app/api/v1/marketing/worker/route");
    const response = await POST(
      new Request("http://localhost/api/v1/marketing/worker", { method: "POST", headers: { authorization: `Bearer ${"x".repeat(40)}` } })
    );
    expect(response.status).toBe(401);
  });

  it("runs a bounded batch for the correct secret and returns only counters", async () => {
    const { POST } = await import("@/app/api/v1/marketing/worker/route");
    const response = await POST(
      new Request("http://localhost/api/v1/marketing/worker", { method: "POST", headers: { authorization: `Bearer ${WORKER}` } })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Record<string, number>; meta: { requestId: string } };
    expect(Object.keys(body.data).sort()).toEqual(["claimed", "dead", "requeued", "retried", "succeeded"]);
    expect(body.meta.requestId).toBeTruthy();
  });
});

describe("delivery webhook", () => {
  it("rejects an unsigned request before parsing it", async () => {
    const { POST } = await import("@/app/api/v1/marketing/webhooks/delivery/route");
    const response = await POST(new Request("http://localhost/api/v1/marketing/webhooks/delivery", { method: "POST", body: eventBody }));
    expect(response.status).toBe(401);
  });

  it("rejects a valid signature over a body that was altered afterwards", async () => {
    const { POST } = await import("@/app/api/v1/marketing/webhooks/delivery/route");
    const signature = signWebhookPayload(eventBody, SECRET, Math.floor(Date.now() / 1000));
    const response = await POST(
      new Request("http://localhost/api/v1/marketing/webhooks/delivery", {
        method: "POST",
        headers: { "x-anops-signature": signature },
        body: eventBody.replace("route-evt-1", "route-evt-2"),
      })
    );
    expect(response.status).toBe(401);
  });

  it("accepts a correctly signed event and reports unmatched messages without leaking anything", async () => {
    const { POST } = await import("@/app/api/v1/marketing/webhooks/delivery/route");
    const signature = signWebhookPayload(eventBody, SECRET, Math.floor(Date.now() / 1000));
    const response = await POST(
      new Request("http://localhost/api/v1/marketing/webhooks/delivery", {
        method: "POST",
        headers: { "x-anops-signature": signature },
        body: eventBody,
      })
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ data: { outcome: "unmatched" } });
  });

  it("refuses a payload that tries to set the company", async () => {
    const { POST } = await import("@/app/api/v1/marketing/webhooks/delivery/route");
    const body = JSON.stringify({ ...JSON.parse(eventBody), companyId: "64b000000000000000000001" });
    const signature = signWebhookPayload(body, SECRET, Math.floor(Date.now() / 1000));
    const response = await POST(
      new Request("http://localhost/api/v1/marketing/webhooks/delivery", { method: "POST", headers: { "x-anops-signature": signature }, body })
    );
    expect(response.status).toBe(400);
  });
});

describe("social OAuth callback", () => {
  it("sends an anonymous browser to sign-in and never starts a connection", async () => {
    authMock.auth.mockResolvedValueOnce(null);
    const { GET } = await import("@/app/api/v1/marketing/social/callback/route");
    const response = await GET(
      new Request("http://localhost/api/v1/marketing/social/callback?state=abcdefghijklmnopqrstuvwxyz&code=abc") as never
    );
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.headers.get("location") ?? "").toContain("/login");
  });

  it("rejects a malformed callback with a result code and no provider detail", async () => {
    authMock.auth.mockResolvedValueOnce({ user: { id: "64b000000000000000000001" } });
    const { GET } = await import("@/app/api/v1/marketing/social/callback/route");
    const response = await GET(new Request("http://localhost/api/v1/marketing/social/callback?state=x&code="));
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("error=INVALID_CALLBACK");
    expect(location).not.toMatch(/token|secret/i);
  });
});
