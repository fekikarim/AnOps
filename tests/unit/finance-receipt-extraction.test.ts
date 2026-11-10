import { describe, expect, it } from "vitest";
import { matchCategory, modelReceiptSchema, parseModelJson, reviewExtraction } from "@/server/finance/receipt-extraction";
import { sniffReceiptType } from "@/server/finance/receipt-storage";

const categories = [
  { id: "c1", name: "Office & Supplies" },
  { id: "c2", name: "Meals & Entertainment" },
  { id: "c3", name: "Travel & Transport" },
];
const opts = { today: "2026-11-07", defaultCurrency: "TND", categories };
const review = (raw: Record<string, unknown>) => reviewExtraction(modelReceiptSchema.parse(raw), opts);
const codes = (raw: Record<string, unknown>) => review(raw).warnings.map((w) => w.code);

describe("receipt extraction review", () => {
  it("a clean Tunisian receipt passes with no warnings and keeps the model's confidence", () => {
    const r = review({ vendor: "Monoprix", date: "12/10/2026", currency: "DT", subtotal: 71.01, tax: 13.49, total: 84.5, category: "Office & Supplies", confidence: 0.93 });
    expect(r.warnings).toEqual([]);
    expect(r.proposed).toMatchObject({ vendor: "Monoprix", date: "2026-10-12", currency: "TND", amount: 71.01, tax: 13.49, total: 84.5, categoryId: "c1", confidence: 0.93 });
  });

  it("accepts the 1 TND timbre fiscal and keeps it in tax, so amount + tax is what was paid", () => {
    const r = review({ vendor: "STEG", date: "2026-10-01", currency: "TND", subtotal: 100, tax: 19, total: 120, confidence: 0.9 });
    expect(r.warnings).toEqual([]);
    expect(r.proposed).toMatchObject({ amount: 100, tax: 20, total: 120 });
    expect(r.proposed.notes).toMatch(/timbre fiscal/);
    expect(codes({ vendor: "Shop", date: "2026-10-01", currency: "TND", subtotal: 100, tax: 19, total: 125, confidence: 0.9 })).toContain("totals_mismatch");
  });

  it("whatever the receipt shape, amount + tax equals the total when a total is known", () => {
    for (const raw of [
      { vendor: "A", date: "2026-10-01", currency: "TND", subtotal: 71.01, tax: 13.49, total: 85.5, confidence: 1 },
      { vendor: "A", date: "2026-10-01", total: 50, tax: 8, confidence: 1 },
      { vendor: "A", date: "2026-10-01", subtotal: 42, tax: 8, confidence: 1 },
      { vendor: "A", date: "2026-10-01", total: 5, tax: 9, confidence: 1 },
    ]) {
      const p = review(raw).proposed;
      expect(Math.round(((p.amount ?? 0) + (p.tax ?? 0)) * 100)).toBe(Math.round((p.total ?? 0) * 100));
    }
  });

  it("never invents confidence: no model score means null, and failed checks lower a given score", () => {
    expect(review({ vendor: "X", date: "2026-10-01", total: 10 }).proposed.confidence).toBeNull();
    const low = review({ date: "2099-01-01", total: 10, confidence: 0.9 });
    expect(low.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["future_date", "no_vendor", "currency_guessed"]));
    expect(low.proposed.confidence).toBeLessThan(0.9);
  });

  it("derives the missing side of amount / total from the other, and rejects tax larger than the total", () => {
    expect(review({ vendor: "A", date: "2026-10-01", total: 50, tax: 8, confidence: 1 }).proposed).toMatchObject({ amount: 42, total: 50 });
    expect(review({ vendor: "A", date: "2026-10-01", subtotal: 42, tax: 8, confidence: 1 }).proposed).toMatchObject({ amount: 42, total: 50 });
    const bad = review({ vendor: "A", date: "2026-10-01", total: 5, tax: 9, confidence: 1 });
    expect(bad.warnings.map((w) => w.code)).toContain("tax_exceeds_total");
    expect(bad.proposed).toMatchObject({ amount: 5, tax: 0, total: 5 });
  });

  it("flags missing totals, unreadable dates and non-receipts", () => {
    expect(codes({ vendor: "A", date: "2026-10-01" })).toContain("no_total");
    expect(codes({ vendor: "A", date: "31/02/2026", total: 3 })).toContain("bad_date");
    expect(codes({ isReceipt: false, vendor: "A", date: "2026-10-01", total: 3 })).toContain("not_a_receipt");
  });

  it("reads numbers written with commas, spaces and currency marks", () => {
    expect(review({ vendor: "A", date: "2026-10-01", total: "1 234,50 DT", confidence: 1 }).proposed.total).toBe(1234.5);
    expect(review({ vendor: "A", date: "2026-10-01", total: "12.500", confidence: 1 }).proposed.total).toBe(12.5);
  });

  it("matches the suggested category to the company's own categories, or none", () => {
    expect(matchCategory("meals & entertainment", categories)?.id).toBe("c2");
    expect(matchCategory("Travel", categories)?.id).toBe("c3");
    expect(matchCategory("Quantum Physics", categories)).toBeNull();
  });

  it("parses JSON wrapped in code fences or prose, and returns null for garbage", () => {
    expect(parseModelJson('Here you go:\n```json\n{"vendor":"A"}\n```')).toEqual({ vendor: "A" });
    expect(parseModelJson("no json here")).toBeNull();
  });
});

describe("receipt file type comes from the bytes, not the name", () => {
  const bytes = (...xs: Array<number | string>) => new Uint8Array(xs.flatMap((x) => (typeof x === "string" ? [...x].map((c) => c.charCodeAt(0)) : [x])));
  it("recognises JPEG, PNG, WEBP, PDF and HEIC", () => {
    expect(sniffReceiptType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffReceiptType(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(sniffReceiptType(bytes("RIFF", 0, 0, 0, 0, "WEBP"))).toBe("image/webp");
    expect(sniffReceiptType(bytes("%PDF-1.7"))).toBe("application/pdf");
    expect(sniffReceiptType(bytes(0, 0, 0, 0x18, "ftypheic"))).toBe("image/heic");
  });
  it("rejects anything else, whatever its name says", () => {
    expect(sniffReceiptType(bytes("MZ", 0x90, 0, 3, 0))).toBeNull();
    expect(sniffReceiptType(bytes("<svg xmlns"))).toBeNull();
    expect(sniffReceiptType(new Uint8Array())).toBeNull();
  });
});
