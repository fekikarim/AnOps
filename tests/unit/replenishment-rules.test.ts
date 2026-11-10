import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { computeReplenishmentLines } from "@/server/purchasing/replenishment.service";
import { checkRationale, parseRationales, type RationaleFacts } from "@/server/purchasing/replenishment-rationale";
import { calculationStatements } from "@/shared/domain/replenishment-calculation";
import { replenishmentConvertSchema, replenishmentGenerateSchema } from "@/features/purchasing/schemas/purchasing.schema";
import { QTY_SCALE } from "@/shared/lib/fixed-point";

const MICRO = QTY_SCALE;

function product(sku: string, unitOfMeasure: "unit" | "kg", reorderPoint: number) {
  return {
    _id: new ObjectId(),
    sku,
    name: `Item ${sku}`,
    unitOfMeasure,
    reorderPointMicro: reorderPoint * MICRO,
  } as const;
}

describe("computeReplenishmentLines", () => {
  it("projects average daily use over the horizon and adds the reorder point", () => {
    const item = product("A", "unit", 5);
    // 30 units consumed in the 30-day lookback: 1 per day. Horizon 14 days: need 14 + reorder 5 = 19.
    // On hand 10, so the shortfall is 9.
    const lines = computeReplenishmentLines({
      products: [item],
      onHandByProduct: new Map([[item._id.toHexString(), 10 * MICRO]]),
      consumedByProduct: new Map([[item._id.toHexString(), 30 * MICRO]]),
      lookbackDays: 30,
      horizonDays: 14,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      forecastDailyUsageMicro: MICRO,
      onHandMicro: 10 * MICRO,
      consumedMicro: 30 * MICRO,
      suggestedMicro: 9 * MICRO,
      rationale: null,
    });
  });

  it("omits products that already cover the target", () => {
    const item = product("B", "unit", 2);
    const lines = computeReplenishmentLines({
      products: [item],
      onHandByProduct: new Map([[item._id.toHexString(), 50 * MICRO]]),
      consumedByProduct: new Map(),
      lookbackDays: 30,
      horizonDays: 7,
    });
    expect(lines).toEqual([]);
  });

  it("rounds a countable shortfall up to whole units", () => {
    const item = product("C", "unit", 0);
    // 10 consumed over 30 days is 0.333 per day. Over 7 days that is 2.333, so the shortfall rounds up to 3.
    const lines = computeReplenishmentLines({
      products: [item],
      onHandByProduct: new Map(),
      consumedByProduct: new Map([[item._id.toHexString(), 10 * MICRO]]),
      lookbackDays: 30,
      horizonDays: 7,
    });
    expect(lines[0].suggestedMicro).toBe(3 * MICRO);
  });

  it("keeps fractional quantities for weight units", () => {
    const item = product("D", "kg", 1);
    const lines = computeReplenishmentLines({
      products: [item],
      onHandByProduct: new Map([[item._id.toHexString(), Math.round(0.25 * MICRO)]]),
      consumedByProduct: new Map(),
      lookbackDays: 30,
      horizonDays: 7,
    });
    expect(lines[0].suggestedMicro).toBe(MICRO - Math.round(0.25 * MICRO));
  });
});

describe("parseRationales and checkRationale", () => {
  const aId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const facts = (overrides: Partial<RationaleFacts> = {}): RationaleFacts => ({
    productId: aId,
    sku: "REP-A",
    name: "Widget A",
    unit: "unit",
    countable: true,
    lookbackDays: 30,
    horizonDays: 14,
    consumed: "30",
    dailyUsage: "1",
    projectedUse: "14",
    reorderPoint: "5",
    onHand: "10",
    requirement: "9",
    suggested: "9",
    ...overrides,
  });
  const known = new Map([[aId, facts()]]);
  const payload = (rationale: string, productId = aId) => JSON.stringify({ items: [{ productId, rationale }] });

  it("accepts a sentence that quotes only supplied figures", () => {
    const text = "Recorded use is 30 units in the last 30 days, or 1 per day. Projected use over 14 days is 14, so the suggested quantity is 9.";
    expect(parseRationales(payload(text), known).accepted.get(aId)).toBe(text);
  });

  it("drops products that were not sent, with a reason code", () => {
    const parsed = parseRationales(payload("Suggested 9 units.", "ffffffffffffffffffffffff"), known);
    expect(parsed.accepted.size).toBe(0);
    expect(parsed.rejected.get("ffffffffffffffffffffffff")).toBe("unknown_product");
  });

  it.each([
    ["a safety buffer", "Keep a safety buffer of 9 units."],
    ["a lead time", "With a lead time of 14 days, order 9."],
    ["a supplier", "The supplier can deliver 9 units."],
    ["seasonality", "Seasonal demand suggests 9 units."],
    ["a trend", "Use is rising, so order 9 units."],
    ["a forecast", "The forecast of 14 supports ordering 9."],
    ["a steadiness claim", "Consumption is steady at 1 per day, so order 9."],
    ["a cause", "Stock fell 10 because of a delay."],
  ])("rejects an unsupported claim about %s", (_label, text) => {
    expect(checkRationale(text, facts())).toBe("unsupported_claim");
  });

  it("rejects a figure that is not among the supplied facts", () => {
    expect(checkRationale("Recorded use is 45 units, so order 9.", facts())).toBe("figure_not_in_facts");
  });

  it("rejects text that quotes no fact at all", () => {
    expect(checkRationale("Stock is below the target.", facts())).toBe("no_fact_reference");
  });

  it("rejects an over-long explanation", () => {
    expect(checkRationale("Order 9 units. ".repeat(20), facts())).toBe("too_long");
  });

  it("compares numbers by value, so 10.00 matches 10", () => {
    expect(checkRationale("On hand is 10.00 units; order 9.", facts())).toBeNull();
  });

  it("rejects malformed JSON and wrong shapes", () => {
    expect(parseRationales("not json", known).accepted.size).toBe(0);
    expect(parseRationales('{"items":"nope"}', known).accepted.size).toBe(0);
  });

  it("keeps the first explanation when a product id repeats", () => {
    const text = JSON.stringify({
      items: [
        { productId: aId, rationale: "Order 9 units from 14 days of use." },
        { productId: aId, rationale: "Order 8 units from 14 days of use." },
      ],
    });
    expect(parseRationales(text, known).accepted.get(aId)).toBe("Order 9 units from 14 days of use.");
  });
});

describe("calculationStatements", () => {
  const base = {
    unitOfMeasure: "unit" as const,
    lookbackDays: 30,
    horizonDays: 14,
    onHandMicro: 16 * MICRO,
    reorderPointMicro: 10 * MICRO,
    consumedMicro: 60 * MICRO,
    forecastDailyUsageMicro: 2 * MICRO,
    suggestedMicro: 22 * MICRO,
  };

  it("separates history, projection, reorder point, requirement, and suggestion", () => {
    const text = calculationStatements(base).join("\n");
    expect(text).toContain("Recorded consumption: 60 unit in the last 30 days, an average of 2 per day.");
    expect(text).toContain("2 × 14 = 28 unit. This applies the recorded average; it is not a forecast.");
    expect(text).toContain("Reorder point 10 unit; on hand 16 unit.");
    expect(text).toContain("Requirement: 28 + 10 − 16 = 22 unit.");
    expect(text).toContain("Suggested quantity: 22 unit.");
  });

  it("says when no consumption was recorded", () => {
    const text = calculationStatements({ ...base, consumedMicro: 0, forecastDailyUsageMicro: 0, suggestedMicro: 10 * MICRO, onHandMicro: 0 }).join("\n");
    expect(text).toContain("none in the last 30 days, so projected use is 0");
  });

  it("notes rounding up for countable units only", () => {
    const fractional = { ...base, unitOfMeasure: "unit" as const, forecastDailyUsageMicro: 333_333, consumedMicro: 9_999_990, onHandMicro: 0, reorderPointMicro: 0, suggestedMicro: 3 * MICRO };
    expect(calculationStatements(fractional).join("\n")).toContain("rounded up to whole units");
    const weight = { ...fractional, unitOfMeasure: "kg" as const, suggestedMicro: 2_333_333 };
    expect(calculationStatements(weight).join("\n")).not.toContain("rounded up");
  });
});

describe("replenishment input schemas", () => {
  it("bounds the forecast horizon", () => {
    const warehouseId = "aaaaaaaaaaaaaaaaaaaaaaaa";
    expect(replenishmentGenerateSchema.safeParse({ warehouseId, horizonDays: 14 }).success).toBe(true);
    expect(replenishmentGenerateSchema.safeParse({ warehouseId, horizonDays: "14" }).success).toBe(true);
    expect(replenishmentGenerateSchema.safeParse({ warehouseId, horizonDays: 0 }).success).toBe(false);
    expect(replenishmentGenerateSchema.safeParse({ warehouseId, horizonDays: 91 }).success).toBe(false);
    expect(replenishmentGenerateSchema.safeParse({ warehouseId, horizonDays: 7.5 }).success).toBe(false);
    expect(replenishmentGenerateSchema.safeParse({ warehouseId, horizonDays: 7, companyId: "x" }).success).toBe(false);
  });

  it("rejects extra fields on conversion so the client cannot set prices or status", () => {
    const base = { supplierId: "aaaaaaaaaaaaaaaaaaaaaaaa", expectedVersion: 1 };
    expect(replenishmentConvertSchema.safeParse(base).success).toBe(true);
    expect(replenishmentConvertSchema.safeParse({ ...base, unitCost: "0.001" }).success).toBe(false);
    expect(replenishmentConvertSchema.safeParse({ ...base, status: "approved" }).success).toBe(false);
  });
});

describe("insufficient history", () => {
  it("suggests only the reorder point when a product has no recorded consumption", () => {
    const item = product("E", "unit", 6);
    const lines = computeReplenishmentLines({
      products: [item],
      onHandByProduct: new Map([[item._id.toHexString(), 2 * MICRO]]),
      consumedByProduct: new Map(),
      lookbackDays: 30,
      horizonDays: 14,
    });
    // No history means zero daily use, so the only need is 6 (reorder point) minus 2 on hand.
    expect(lines[0]).toMatchObject({ forecastDailyUsageMicro: 0, consumedMicro: 0, suggestedMicro: 4 * MICRO });
  });
});
