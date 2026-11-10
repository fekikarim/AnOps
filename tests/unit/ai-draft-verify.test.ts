import { describe, expect, it } from "vitest";
import { parseRows, serializeRows, MAX_LINE_ROWS } from "@/server/ai/draft/draft-lines";
import { appears, cleanNumeric, numbersIn, statedProvenance } from "@/server/ai/draft/verify";

describe("draft verification helpers", () => {
  it("only strips a currency or unit from a clearly numeric value, never from identifiers", () => {
    expect(cleanNumeric("12 TND")).toBe("12");
    expect(cleanNumeric("1,5 kg")).toBe("1.5");
    expect(cleanNumeric("OIL-001")).toBe("OIL-001");
    expect(cleanNumeric("T-1")).toBe("T-1");
    expect(cleanNumeric("2026-12-01")).toBe("2026-12-01".replace(/[^0-9.,-]/g, "").replace(",", ".")); // date-like text is numeric-looking: callers only clean critical numeric fields
  });

  it("a value is the person's own only when their words contain it", () => {
    const text = "Order 50 steel bolts, 12 TND each, SKU BOLT-1";
    expect(statedProvenance("50", "stated", "50 steel bolts", text)).toBe("you");
    expect(statedProvenance("12", "stated", undefined, text)).toBe("you");
    expect(statedProvenance("99", "stated", "99 bolts", text)).toBe("inferred");
    expect(statedProvenance("BOLT-1", "stated", undefined, text)).toBe("you");
    expect(statedProvenance("50", "assumed", "50", text)).toBe("inferred"); // the model's own admission wins
    expect(numbersIn("1,5 and 20")).toEqual([1.5, 20]);
    expect(appears("x", "xyz")).toBe(false); // one character is not evidence
  });
});

describe("line item rows", () => {
  it("round-trips string maps and discards everything else", () => {
    const rows = [{ productId: "a", quantity: "5" }, { productId: "b", quantity: "2" }];
    expect(parseRows(serializeRows(rows))).toEqual(rows);
    expect(parseRows("not json")).toEqual([]);
    expect(parseRows('{"a":1}')).toEqual([]);
    expect(parseRows(undefined)).toEqual([]);
    expect(parseRows('[1,"x",null,[2],{"q":"1","nested":{"a":1},"n":3}]')).toEqual([{ q: "1", n: "3" }]); // objects only; nested objects dropped, numbers stringified
  });

  it("bounds the number of rows and the size of every cell", () => {
    const many = JSON.stringify(Array.from({ length: 500 }, (_, i) => ({ n: String(i) })));
    expect(parseRows(many)).toHaveLength(MAX_LINE_ROWS);
    const long = parseRows(JSON.stringify([{ note: "x".repeat(5000) }]));
    expect(long[0].note).toHaveLength(300);
  });
});
