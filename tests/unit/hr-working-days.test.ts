import { describe, expect, it } from "vitest";
import { calculateBusinessDays, calculateLeaveDays } from "@/features/hr/utils/date-utils";

describe("working-day counting", () => {
  it("weekend-only and holiday-only periods are zero days, not one", () => {
    expect(calculateBusinessDays("2026-10-10", "2026-10-11")).toBe(0);
    expect(calculateBusinessDays("2026-10-10", "2026-10-10")).toBe(0);
    expect(calculateBusinessDays("2026-10-07", "2026-10-07", ["2026-10-07"])).toBe(0);
  });
  it("normal weekdays, ranges across a weekend and across a month end", () => {
    expect(calculateBusinessDays("2026-10-05", "2026-10-09")).toBe(5);
    expect(calculateBusinessDays("2026-10-09", "2026-10-12")).toBe(2);
    expect(calculateBusinessDays("2026-09-29", "2026-10-02")).toBe(4);
    expect(calculateBusinessDays("2026-12-30", "2027-01-04")).toBe(4);
    expect(calculateBusinessDays("2026-12-30", "2027-01-04", ["2027-01-01"])).toBe(3);
  });
  it("a half day counts only on a working day; reversed or invalid ranges are zero", () => {
    expect(calculateLeaveDays("2026-10-07", "2026-10-07", [], "morning")).toBe(0.5);
    expect(calculateLeaveDays("2026-10-10", "2026-10-10", [], "afternoon")).toBe(0);
    expect(calculateBusinessDays("2026-10-09", "2026-10-05")).toBe(0);
    expect(calculateBusinessDays("nope", "2026-10-05")).toBe(0);
  });
});
