import { describe, expect, it } from "vitest";
import { isDuplicateKeyError, mapMongoError } from "@/server/db/transactions";
import { AppError } from "@/shared/lib/errors";

describe("duplicate key detection", () => {
  it("recognises the raw driver error and the one already translated by withTransaction", () => {
    const raw = Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
    expect(isDuplicateKeyError(raw)).toBe(true);
    expect(isDuplicateKeyError(mapMongoError(raw))).toBe(true);
  });

  it("does not mistake other conflicts or errors for it", () => {
    expect(isDuplicateKeyError(new AppError("CONFLICT", "Reload the page to see the latest version."))).toBe(false);
    expect(isDuplicateKeyError(new Error("boom"))).toBe(false);
    expect(isDuplicateKeyError(null)).toBe(false);
  });
});
