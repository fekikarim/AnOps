import { describe, expect, it } from "vitest";
import { organizationProfileSchema, userProfileSchema } from "@/features/platform/schemas";

const base = { firstName: "Karim", lastName: "Feki", phone: "", language: "en", notifications: { product: true, billing: true, security: true } } as const;
const parse = (jobTitle: string) => userProfileSchema.safeParse({ ...base, jobTitle });

describe("position / title validation", () => {
  it("accepts real titles, accents and common punctuation, and empty", () => {
    for (const ok of ["Operations manager", "CEO & Founder", "Directeur général", "Responsable RH (Paris)", "Head of R&D / Product", "مدير العمليات", "Level 2 Support"]) {
      expect(parse(ok).success, ok).toBe(true);
    }
    expect(parse("")).toMatchObject({ success: true, data: { jobTitle: null } });
  });

  it("rejects numbers-only, symbols-only, one character and unsafe characters", () => {
    for (const bad of ["00", "12345", "---", "a", "<script>", "Manager; DROP", "1 2 3"]) {
      expect(parse(bad).success, bad).toBe(false);
    }
  });

  it("uses the same rule for the organization industry", () => {
    const org = { name: "Org", currency: "EUR" };
    expect(organizationProfileSchema.safeParse({ ...org, industry: "Food distribution" }).success).toBe(true);
    expect(organizationProfileSchema.safeParse({ ...org, industry: "123" }).success).toBe(false);
  });
});
