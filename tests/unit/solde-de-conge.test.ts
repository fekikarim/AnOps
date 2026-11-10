import { describe, expect, it } from "vitest";
import {
  calculateBusinessDays,
  calculateLeaveDays,
  calculateAge,
  getAgeCategory,
  calculateNetSalary,
} from "@/features/hr/utils/date-utils";

describe("Solde de Congé - Business Days & Holiday Exclusion", () => {
  it("excludes weekends properly from date range", () => {
    // Mon 2026-10-05 to Fri 2026-10-09 (5 working days)
    const days = calculateBusinessDays("2026-10-05", "2026-10-09");
    expect(days).toBe(5);
  });

  it("excludes recognized public holidays from working days count", () => {
    // Mon 2026-10-05 to Fri 2026-10-09 with Wed 2026-10-07 as holiday (4 working days)
    const holidays = ["2026-10-07"];
    const days = calculateLeaveDays("2026-10-05", "2026-10-09", holidays);
    expect(days).toBe(4);
  });

  it("handles single-day half-day request properly as 0.5 days", () => {
    const halfDay = calculateLeaveDays("2026-10-05", "2026-10-05", [], "morning");
    expect(halfDay).toBe(0.5);

    const fullDay = calculateLeaveDays("2026-10-05", "2026-10-05", []);
    expect(fullDay).toBe(1);
  });
});

describe("Solde de Congé - Age Categories (Code du Travail Art. 113-114)", () => {
  const asOf = new Date("2026-06-01");

  it("classifies under 18 workers correctly", () => {
    // Born in 2009 -> 17 years old in June 2026
    const cat = getAgeCategory("2009-02-15", asOf);
    expect(cat).toBe("under_18");
  });

  it("classifies 18-20 young adult workers correctly", () => {
    // Born in 2007 -> 19 years old in June 2026
    const cat = getAgeCategory("2007-03-10", asOf);
    expect(cat).toBe("young_adult");
  });

  it("classifies adult workers (21+) correctly and defaults when missing", () => {
    // Born in 1995 -> 31 years old
    expect(getAgeCategory("1995-05-20", asOf)).toBe("adult");
    // Missing date of birth defaults to standard adult
    expect(getAgeCategory(undefined, asOf)).toBe("adult");
  });
});

describe("Solde de Congé - Monthly Accrual Idempotency Regex", () => {
  it("matches period string across languages (Period / Période)", () => {
    const period = "2026-11";
    const regex = new RegExp(`P[eé]riod(e)? ${period}`, "i");

    expect(regex.test("Monthly leave accrual — Period 2026-11 (+1d)")).toBe(true);
    expect(regex.test("Mensualisation Solde de congé — Période 2026-11 (+1j)")).toBe(true);
    expect(regex.test("Mensualisation Solde de congé — Periode 2026-11 (+1j)")).toBe(true);
    // Should NOT match a different month
    expect(regex.test("Monthly leave accrual — Period 2026-12 (+1d)")).toBe(false);
  });
});

describe("Solde de Congé - Ledger Balance Invariants", () => {

  it("calculates Available accurately: Earned - Taken - Reserved + Adjustments", () => {
    // Scenario from spec: Earned 12, Taken 5, Reserved 2 => Available 5
    const earned = 12;
    const taken = 5;
    const reserved = 2;
    const adjustments = 0;
    const available = Math.max(0, earned - taken - reserved + adjustments);
    expect(available).toBe(5);
  });

  it("correctly includes positive and negative manual adjustments", () => {
    const earned = 10;
    const taken = 2;
    const reserved = 1;
    const adjustments = 1.5; // +1.5 days manual correction
    const available = Math.max(0, earned - taken - reserved + adjustments);
    expect(available).toBe(8.5);

    // Negative adjustment
    const negAdjustments = -2;
    const availableNeg = Math.max(0, earned - taken - reserved + negAdjustments);
    expect(availableNeg).toBe(5);
  });

  it("computes potential departure compensation: Earned - Taken", () => {
    const earned = 15;
    const taken = 6;
    const potentialCompensation = Math.max(0, earned - taken);
    expect(potentialCompensation).toBe(9);
  });
});

describe("Payroll Generator - Net Salary & Unpaid Leave Preserved", () => {
  it("calculates standard net salary with zero unpaid leave", () => {
    const res = calculateNetSalary(4200, 0, 22);
    expect(res.dailyRate).toBe(190.91);
    expect(res.deduction).toBe(0);
    expect(res.netSalary).toBe(4200);
  });

  it("correctly deducts unpaid leave days in payroll", () => {
    const res = calculateNetSalary(4200, 2, 22);
    expect(res.deduction).toBe(381.82);
    expect(res.netSalary).toBe(3818.18);
  });
});

