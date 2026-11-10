import { describe, expect, it } from "vitest";
import { rangeText } from "@/shared/components/data-display/pagination-view";

describe("rangeText", () => {
  it("shows the first page range", () => expect(rangeText(1, 25, 112)).toBe("Showing 1–25 of 112"));
  it("clamps the last page to the total", () => expect(rangeText(5, 25, 112)).toBe("Showing 101–112 of 112"));
  it("returns null when there are no records", () => expect(rangeText(1, 25, 0)).toBeNull());
});
