import { describe, expect, it } from "vitest";
import { tunisiaLocalToIso, parseIsoInstant } from "@/features/marketing/utils/datetime";
import { consentChangeSchema } from "@/features/marketing/schemas/marketing.schema";
import { errorCopy } from "@/shared/lib/action-error-copy";

describe("Tunisia datetime conversion", () => {
  it("converts a datetime-local value to the UTC instant (Tunisia is UTC+1, no DST)", () => {
    expect(tunisiaLocalToIso("2026-10-26T10:30")).toEqual({ ok: true, iso: "2026-10-26T09:30:00.000Z" });
    expect(tunisiaLocalToIso("2026-10-26T10:30:45")).toEqual({ ok: true, iso: "2026-10-26T09:30:45.000Z" });
  });

  it("treats empty input as 'not given' rather than an error", () => {
    expect(tunisiaLocalToIso("")).toEqual({ ok: true, iso: "" });
    expect(tunisiaLocalToIso("   ")).toEqual({ ok: true, iso: "" });
  });

  it("reports incomplete or malformed input with a message, never throws", () => {
    expect(tunisiaLocalToIso("2026-10-26")).toMatchObject({ ok: false });
    expect(tunisiaLocalToIso("2026-10-26T1")).toMatchObject({ ok: false });
    expect(tunisiaLocalToIso("2026-10-26T10:30:00:00")).toMatchObject({ ok: false });
    expect(tunisiaLocalToIso("tomorrow at noon")).toMatchObject({ ok: false });
  });

  it("rejects dates and times that do not exist instead of rolling them over", () => {
    expect(tunisiaLocalToIso("2026-02-31T10:00")).toMatchObject({ ok: false, message: "That date does not exist." });
    expect(tunisiaLocalToIso("2026-13-01T10:00")).toMatchObject({ ok: false });
    expect(tunisiaLocalToIso("2026-10-26T25:00")).toMatchObject({ ok: false });
  });

  it("parses ISO instants without throwing on bad text", () => {
    expect(parseIsoInstant("not a date")).toBeNull();
    expect(parseIsoInstant("2026-10-26T09:30:00.000Z")?.toISOString()).toBe("2026-10-26T09:30:00.000Z");
  });
});

describe("consent date handling on the server", () => {
  it("answers an impossible date with a validation result, not an exception", () => {
    const result = consentChangeSchema.safeParse({ channel: "email", status: "granted", source: "manual", occurredAt: "2026-02-31T10:00:00" });
    expect(result.success).toBe(false);
  });

  it("converts a valid ISO time to a normalized ISO string", () => {
    const result = consentChangeSchema.safeParse({ channel: "email", status: "granted", source: "manual", occurredAt: "2026-01-01T09:00:00.000Z" });
    expect(result.success && result.data.occurredAt).toBe("2026-01-01T09:00:00.000Z");
  });
});

describe("user-facing error copy", () => {
  it("never shows internal detail for unexpected failures, only a short reference", () => {
    const copy = errorCopy({ code: "INTERNAL", message: "Something went wrong. Please try again.", requestId: "abcdef12-3456" });
    expect(copy.title).toBe("Something went wrong on our side");
    expect(copy.description).toContain("abcdef12");
    expect(JSON.stringify(copy)).not.toMatch(/stack|mongo|TypeError|RangeError/i);
  });

  it("explains permission, conflict and configuration errors in plain language", () => {
    expect(errorCopy({ code: "FORBIDDEN", message: "You do not have permission to perform this action." }).title).toBe("Permission needed");
    expect(errorCopy({ code: "CONFLICT", message: "This contact was changed by someone else. Reload and try again." }).description).toContain("Reload");
    expect(errorCopy({ code: "PROVIDER_NOT_CONFIGURED" }).title).toBe("Not configured yet");
  });

  it("still gives a sensible message when the error has no code", () => {
    expect(errorCopy(undefined).title).toBe("Something went wrong");
    expect(errorCopy({ message: "Saved elsewhere" }).title).toBe("Saved elsewhere");
  });
});
