import { describe, expect, it } from "vitest";
import { centsText, invoiceTotalsCents, lineTotalCents, money, parseAmountCents, parseDate, parsePositiveCents, parseQuantityInt, parseRate, toCents, todayTunis } from "@/server/ai/finance/money";

const bad = (fn: () => unknown) => {
  try {
    fn();
    return "OK";
  } catch (e) {
    return (e as Error).message;
  }
};

describe("amounts are parsed into whole cents and never rounded silently", () => {
  it("reads plain, French and padded amounts", () => {
    expect(parseAmountCents("1250.5")).toBe(125050);
    expect(parseAmountCents("1 250,50")).toBe(125050);
    expect(parseAmountCents("0.07")).toBe(7);
    expect(parseAmountCents(19.99)).toBe(1999);
    expect(parseAmountCents("12")).toBe(1200);
    expect(parseAmountCents("0")).toBe(0);
  });
  it("refuses ambiguity, extra decimals, negatives, exponents and words", () => {
    expect(bad(() => parseAmountCents("1,250.50"))).toMatch(/ambiguous/);
    expect(bad(() => parseAmountCents("12.345"))).toMatch(/at most 2 decimals/);
    expect(bad(() => parseAmountCents("-3"))).toMatch(/not a valid amount/);
    expect(bad(() => parseAmountCents("1e3"))).toMatch(/not a valid amount/);
    expect(bad(() => parseAmountCents("twelve"))).toMatch(/not a valid amount/);
    expect(bad(() => parseAmountCents(""))).toMatch(/not a valid amount/);
    expect(bad(() => parseAmountCents(undefined))).toMatch(/required/);
    expect(bad(() => parsePositiveCents("0.00"))).toMatch(/greater than zero/);
  });
  it("0.1 + 0.2 is exactly 30 cents because everything is compared as integers", () => {
    expect(parseAmountCents("0.1") + parseAmountCents("0.2")).toBe(parseAmountCents("0.30"));
    expect(toCents(0.1 + 0.2)).toBe(30);
  });
});

describe("rates, quantities and dates", () => {
  it("accepts percentages up to 100 with two decimals", () => {
    expect(parseRate("19")).toBe(19);
    expect(parseRate("7,5")).toBe(7.5);
    expect(parseRate("19%")).toBe(19);
    expect(parseRate("")).toBe(0);
    expect(bad(() => parseRate("101"))).toMatch(/above 100/);
    expect(bad(() => parseRate("5.555"))).toMatch(/percentage/);
  });
  it("quantities are whole numbers of at least one", () => {
    expect(parseQuantityInt("12")).toBe(12);
    for (const q of ["0", "1.5", "-2", "", "abc"]) expect(bad(() => parseQuantityInt(q))).toMatch(/whole number/);
  });
  it("dates must be real calendar days", () => {
    expect(parseDate("2026-02-28", "d")).toBe("2026-02-28");
    expect(bad(() => parseDate("2026-02-30", "d"))).toMatch(/real date/);
    expect(bad(() => parseDate("tomorrow", "d"))).toMatch(/date like/);
    expect(todayTunis(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01"); // Tunis is UTC+1
  });
});

describe("totals come from the module's own function and always add up", () => {
  it("rounds tax per line to the cent exactly as the service stores it", () => {
    const lines = [{ quantity: 3, unitPrice: 19.99, taxRate: 19 }, { quantity: 2, unitPrice: 10, taxRate: 0 }];
    expect(invoiceTotalsCents(lines)).toEqual({ subtotal: 7997, tax: 1139, total: 9136 });
    expect(lineTotalCents(lines[0]) + lineTotalCents(lines[1])).toBe(9136);
  });
  it("many small lines never drift", () => {
    const lines = Array.from({ length: 50 }, () => ({ quantity: 1, unitPrice: 0.1, taxRate: 19 }));
    const t = invoiceTotalsCents(lines);
    expect(t.subtotal).toBe(500);
    expect(t.total).toBe(t.subtotal + t.tax);
    expect(lines.reduce((s, l) => s + lineTotalCents(l), 0)).toBe(t.total);
  });
  it("formats with two decimals and the currency", () => {
    expect(centsText(5)).toBe("0.05");
    expect(centsText(-1250)).toBe("-12.50");
    expect(money(123456, "EUR")).toBe("1234.56 EUR");
  });
});
