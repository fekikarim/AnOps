import { describe, expect, it } from "vitest";
import { consumeRateLimit } from "@/server/security/rate-limit";
import { AppError } from "@/shared/lib/errors";

describe("consumeRateLimit", () => {
  it("allows up to the limit and then rejects with RATE_LIMITED", () => {
    const key = `test-${Math.random()}`;
    consumeRateLimit(key, 2, 60_000);
    consumeRateLimit(key, 2, 60_000);
    expect(() => consumeRateLimit(key, 2, 60_000)).toThrow(AppError);
    try {
      consumeRateLimit(key, 2, 60_000);
    } catch (error) {
      expect((error as AppError).code).toBe("RATE_LIMITED");
      expect((error as AppError).status).toBe(429);
    }
  });

  it("resets after the window elapses", async () => {
    const key = `window-${Math.random()}`;
    consumeRateLimit(key, 1, 20);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(() => consumeRateLimit(key, 1, 20)).not.toThrow();
  });
});
