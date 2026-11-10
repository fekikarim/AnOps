import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { AudienceRuleDoc } from "@/server/marketing/documents";
import {
  compileAudienceFilter,
  isValidStoredRule,
  safeFromStoredRule,
} from "@/server/marketing/audience.service";

/**
 * Legacy or damaged audience documents must not crash a list page, and must never be
 * interpreted as a permissive rule. They are reported as unusable and refused at compile time.
 */
describe("stored audience rules", () => {
  const valid: AudienceRuleDoc = {
    match: "all",
    conditions: [
      { type: "lifecycle_stage", values: ["lead", "prospect"] },
      { type: "tags", tagIds: [new ObjectId()], match: "any" },
      { type: "created_after", date: new Date("2026-01-31T00:00:00.000Z") },
    ],
  };

  it("converts a valid stored rule for display", () => {
    const rule = safeFromStoredRule(valid);
    expect(rule?.match).toBe("all");
    expect(rule?.conditions).toHaveLength(3);
    expect(rule?.conditions[1]).toMatchObject({ type: "tags", match: "any" });
    expect(rule?.conditions[2]).toEqual({ type: "created_after", date: "2026-01-31" });
  });

  it("returns null for a missing rule instead of throwing", () => {
    expect(safeFromStoredRule(null)).toBeNull();
    expect(safeFromStoredRule(undefined)).toBeNull();
  });

  it("returns null for rules that do not satisfy the current schema", () => {
    expect(safeFromStoredRule({ match: "all" } as never)).toBeNull();
    expect(safeFromStoredRule({ match: "some", conditions: [] } as never)).toBeNull();
    expect(safeFromStoredRule({ match: "all", conditions: [] } as never)).toBeNull();
    expect(safeFromStoredRule({ match: "all", conditions: [{ type: "tags", tagIds: ["not-an-id"], match: "any" }] } as never)).toBeNull();
  });

  it("reports validity without converting twice at call sites", () => {
    expect(isValidStoredRule(valid)).toBe(true);
    expect(isValidStoredRule(null)).toBe(false);
  });

  it("refuses to compile a missing rule, so approval cannot select everyone", async () => {
    await expect(compileAudienceFilter({} as never, new ObjectId(), null as never)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});
