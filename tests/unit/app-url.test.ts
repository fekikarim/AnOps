import { describe, expect, it } from "vitest";
import { isLocalOnlyUrl, resolveAppUrl } from "@/config/env";

/**
 * Emailed links (verification, reset, unsubscribe) are built from the app base URL.
 * A production campaign must never ship a link that only works on the server itself.
 */
describe("app base URL", () => {
  it("prefers APP_URL over NEXTAUTH_URL", () => {
    expect(resolveAppUrl({ appUrl: "https://app.example.com", nextAuthUrl: "http://internal:3000" })).toBe(
      "https://app.example.com"
    );
  });

  it("falls back to NEXTAUTH_URL and then to localhost", () => {
    expect(resolveAppUrl({ nextAuthUrl: "https://auth.example.com" })).toBe("https://auth.example.com");
    expect(resolveAppUrl({})).toBe("http://localhost:3000");
  });

  it("removes trailing slashes because callers append paths", () => {
    expect(resolveAppUrl({ appUrl: "https://app.example.com///" })).toBe("https://app.example.com");
  });

  it("treats loopback, private, link-local and .local hosts as unreachable for recipients", () => {
    for (const url of [
      "http://localhost:3000",
      "http://app.localhost",
      "https://127.0.0.1",
      "http://10.1.2.3",
      "http://172.20.0.4",
      "http://192.168.1.48:3000",
      "http://169.254.10.1",
      "http://[::1]:3000",
      "http://printer.local",
      "not-a-url",
    ]) {
      expect(isLocalOnlyUrl(url), url).toBe(true);
    }
  });

  it("accepts public hostnames and addresses", () => {
    for (const url of ["https://app.example.com", "https://anops.tn", "https://[2001:db8::1]"]) {
      expect(isLocalOnlyUrl(url), url).toBe(false);
    }
  });
});
