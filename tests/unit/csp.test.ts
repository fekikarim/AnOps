import { describe, expect, it } from "vitest";
import { buildCsp, createNonce } from "@/server/security/csp";

describe("content security policy", () => {
  it("allows only nonced scripts in production, with no unsafe script directives", () => {
    const csp = buildCsp("abc123", { secureRequest: true });
    const script = csp.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(script).toContain("'nonce-abc123'");
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("upgrade-insecure-requests");
    // Plain-HTTP deployments must not be told to upgrade (it would break every same-site request).
    expect(buildCsp("abc123")).not.toContain("upgrade-insecure-requests");
    expect(csp).not.toMatch(/(^|; )(script-src|default-src)[^;]*\*/);
  });

  it("only relaxes eval and websockets in development", () => {
    const dev = buildCsp("n", { development: true });
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).toContain("ws:");
    expect(dev).not.toContain("upgrade-insecure-requests");
    expect(buildCsp("n")).not.toContain("ws:");
  });

  it("lets Stripe receive form posts but nothing else third-party", () => {
    const csp = buildCsp("n");
    expect(csp).toContain("form-action 'self' https://checkout.stripe.com");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain("script-src 'self' https://");
  });

  it("creates a different 128-bit nonce each time", () => {
    const a = createNonce();
    const b = createNonce();
    expect(a).not.toBe(b);
    expect(atob(a)).toHaveLength(16);
  });
});
