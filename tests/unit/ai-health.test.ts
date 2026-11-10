import { describe, expect, it } from "vitest";
import { toTenantHealth, type AiHealth } from "@/server/ai/health";

const base: AiHealth = {
  ok: true,
  killSwitchOn: false,
  providers: [{ name: "Groq", configured: true }],
  anyProviderConfigured: true,
  priceConfigured: true,
  companyCostLimitConfigured: true,
  transactionsSupported: true,
  problems: ["No AI provider is configured (set GROQ_API_KEYS, OPENROUTER_API_KEY or GEMINI_API_KEYS)."],
};

describe("tenant AI health", () => {
  it("exposes only available/paused, never providers, variable names or limits", () => {
    const out = toTenantHealth(base);
    expect(out).toEqual({ available: true, paused: false });
    expect(JSON.stringify(out)).not.toMatch(/Groq|KEYS|provider|problem|limit|price|transaction/i);
  });

  it("reports paused and unavailable states", () => {
    expect(toTenantHealth({ ...base, killSwitchOn: true })).toEqual({ available: false, paused: true });
    expect(toTenantHealth({ ...base, anyProviderConfigured: false })).toEqual({ available: false, paused: false });
  });
});
