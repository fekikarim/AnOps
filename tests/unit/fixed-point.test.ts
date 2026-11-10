import { describe, expect, it } from "vitest";
import {
  applyBasisPoints,
  formatBasisPoints,
  formatMoneyAmount,
  formatQuantity,
  multiplyQuantityByPrice,
  parseMoney,
  parsePercentToBasisPoints,
  parseQuantity,
  scaleQuantity,
  sumSafe,
  FixedPointError,
} from "@/shared/lib/fixed-point";

describe("quantity parsing", () => {
  it("stores quantities as exact micro-units", () => {
    expect(parseQuantity("12")).toBe(12_000_000);
    expect(parseQuantity("0.25")).toBe(250_000);
    expect(parseQuantity("0.000001")).toBe(1);
  });

  it("rejects malformed, negative, and oversized quantities", () => {
    expect(() => parseQuantity("-1")).toThrow(FixedPointError);
    expect(() => parseQuantity("1.1234567")).toThrow(FixedPointError);
    expect(() => parseQuantity("1e3")).toThrow(FixedPointError);
    expect(() => parseQuantity("1000000")).toThrow(FixedPointError);
    expect(() => parseQuantity("")).toThrow(FixedPointError);
  });

  it("formats micro-units back to decimal strings", () => {
    expect(formatQuantity(12_500_000, 3)).toBe("12.500");
    expect(formatQuantity(1, 6)).toBe("0.000001");
    expect(formatQuantity(0, 3)).toBe("0.000");
  });
});

describe("money parsing and arithmetic", () => {
  it("stores money in milli-units", () => {
    expect(parseMoney("3.250")).toBe(3250);
    expect(parseMoney("3")).toBe(3000);
    expect(() => parseMoney("3.2345")).toThrow(FixedPointError);
  });

  it("computes line amounts with half-away-from-zero rounding", () => {
    // 1.5 units x 2.001 = 3.0015 -> 3.002 (half rounds up)
    expect(multiplyQuantityByPrice(parseQuantity("1.5"), parseMoney("2.001"))).toBe(3002);
    expect(multiplyQuantityByPrice(parseQuantity("3"), parseMoney("0.333"))).toBe(999);
  });

  it("applies tax basis points with rounding", () => {
    expect(applyBasisPoints(10_000, 1900)).toBe(1900); // 19% of 10.000
    expect(applyBasisPoints(1, 5000)).toBe(1); // 0.5 rounds up
    expect(() => applyBasisPoints(100, 10_001)).toThrow(FixedPointError);
  });

  it("parses tax percentages and formats them back", () => {
    expect(parsePercentToBasisPoints("19")).toBe(1900);
    expect(parsePercentToBasisPoints("7.5")).toBe(750);
    expect(formatBasisPoints(750)).toBe("7.5");
    expect(formatBasisPoints(1900)).toBe("19");
    expect(() => parsePercentToBasisPoints("101")).toThrow(FixedPointError);
  });

  it("sums without floating-point drift and rejects unsafe totals", () => {
    expect(sumSafe([1000, 2000, 1], "Total")).toBe(3001);
    expect(() => sumSafe([Number.MAX_SAFE_INTEGER, 10], "Total")).toThrow(FixedPointError);
  });

  it("formats money with fixed decimals", () => {
    expect(formatMoneyAmount(1234567, 3)).toBe("1234.567");
  });

  it("scales quantities by a micro-unit factor", () => {
    // 2 pieces per unit, 1.5 finished units -> 3 pieces
    expect(scaleQuantity(parseQuantity("2"), parseQuantity("1.5"))).toBe(parseQuantity("3"));
    expect(scaleQuantity(parseQuantity("0.333333"), parseQuantity("1"))).toBe(333333);
  });
});
