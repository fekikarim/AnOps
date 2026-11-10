import { describe, expect, it } from "vitest";
import { receiptEntrySchema, type ReceiptEntryLine } from "@/features/purchasing/schemas/purchasing.schema";

const ID_A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const ID_KG = "bbbbbbbbbbbbbbbbbbbbbbbb";
const warehouseId = "cccccccccccccccccccccccc";
const orderId = "dddddddddddddddddddddddd";

const lines: ReceiptEntryLine[] = [
  { id: ID_A, sku: "CMP-100", unitOfMeasure: "unit", remaining: "22.000" },
  { id: ID_KG, sku: "KG-900", unitOfMeasure: "kg", remaining: "4.500" },
];

function check(quantities: [string, string]) {
  return receiptEntrySchema(lines).safeParse({
    purchaseOrderId: orderId,
    warehouseId,
    lines: [
      { purchaseOrderLineId: ID_A, quantity: quantities[0] },
      { purchaseOrderLineId: ID_KG, quantity: quantities[1] },
    ],
  });
}

function messages(result: ReturnType<typeof check>): string[] {
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

describe("receipt entry rules", () => {
  it("treats blank lines as nothing received, as long as one line has a quantity", () => {
    expect(check(["10", ""]).success).toBe(true);
  });

  it("treats whitespace as blank", () => {
    expect(check([" ", "2"]).success).toBe(true);
  });

  it("asks for a warehouse before anything else", () => {
    const result = receiptEntrySchema(lines).safeParse({
      purchaseOrderId: orderId,
      warehouseId: "",
      lines: [{ purchaseOrderLineId: ID_A, quantity: "1" }],
    });
    expect(messages(result)).toEqual(["warehouseId: Choose the warehouse that receives these goods"]);
  });

  it("requires at least one received quantity", () => {
    expect(messages(check(["", ""]))).toEqual(["lines: Enter a received quantity for at least one line"]);
    expect(check(["0", "0.0"]).success).toBe(false);
  });

  it("accepts decimal quantities on weight units", () => {
    expect(check(["", "2.5"]).success).toBe(true);
    expect(check(["", "0.000001"]).success).toBe(true);
  });

  it("rejects fractions on countable units", () => {
    expect(messages(check(["2.5", ""]))).toEqual(["lines.0.quantity: CMP-100 is counted in whole units"]);
  });

  it.each(["-1", "+2", "1e3", "abc", "1,5", "NaN", "1.0000001", "1234567"])("rejects %j", (value) => {
    const result = check([value, "1"]);
    expect(result.success).toBe(false);
  });

  it("rejects more than the remaining quantity on the order line", () => {
    expect(messages(check(["23", ""]))).toEqual(["lines.0.quantity: Only 22.000 unit remain on this order line"]);
    expect(check(["22", ""]).success).toBe(true);
  });
});
