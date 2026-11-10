import type { AudienceRuleInput } from "@/features/marketing/schemas/marketing.schema";
import { CONTACT_SOURCES, LIFECYCLE_STAGES, MARKETING_CHANNELS } from "@/features/marketing/types/constants";

/**
 * The audience form offers the common single-condition shapes as plain fields; the existing validated rule structure is
 * what is saved. A rule that does not fit these fields is not editable through AI (it is edited in Marketing).
 */
export type SimpleAudience = { match: "all" | "any"; lifecycle: string; source: string; consentChannel: string; tag: string; activeOnly: boolean; createdAfter: string };

export function ruleFromSimple(f: SimpleAudience): AudienceRuleInput {
  const conditions: AudienceRuleInput["conditions"] = [];
  if (f.lifecycle) conditions.push({ type: "lifecycle_stage", values: [f.lifecycle as (typeof LIFECYCLE_STAGES)[number]] });
  if (f.source) conditions.push({ type: "source", values: [f.source as (typeof CONTACT_SOURCES)[number]] });
  if (f.consentChannel) conditions.push({ type: "consent", channel: f.consentChannel as (typeof MARKETING_CHANNELS)[number], status: "granted" });
  if (f.tag) conditions.push({ type: "tags", tagIds: [f.tag], match: "any" });
  if (f.activeOnly) conditions.push({ type: "active", value: true });
  if (f.createdAfter) conditions.push({ type: "created_after", date: f.createdAfter });
  return { match: f.match, conditions };
}

export function simpleFromRule(rule: AudienceRuleInput): SimpleAudience | null {
  const out: SimpleAudience = { match: rule.match, lifecycle: "", source: "", consentChannel: "", tag: "", activeOnly: false, createdAfter: "" };
  const seen = new Set<string>();
  for (const c of rule.conditions) {
    if (seen.has(c.type)) return null;
    seen.add(c.type);
    if (c.type === "lifecycle_stage" && c.values.length === 1) out.lifecycle = c.values[0];
    else if (c.type === "source" && c.values.length === 1) out.source = c.values[0];
    else if (c.type === "consent" && c.status === "granted") out.consentChannel = c.channel;
    else if (c.type === "tags" && c.tagIds.length === 1) out.tag = c.tagIds[0];
    else if (c.type === "active" && c.value === true) out.activeOnly = true;
    else if (c.type === "created_after") out.createdAfter = String(c.date).slice(0, 10);
    else return null;
  }
  return out;
}
