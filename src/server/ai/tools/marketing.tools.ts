import "server-only";
import { z } from "zod";
import { defineTool } from "@/server/ai/tools/define-tool";
import { modelRows } from "@/server/ai/tools/inventory.parts";
import { assertMaySchedule, contactView, integrationFlags, mkScope, renderPreview, requireSender, sendEnvironment, tunisTime } from "@/server/ai/marketing/access";
import { audienceCard, audiencesTable, campaignCard, campaignsTable, contactCard, contactsTable, dashboardCard, deliveriesTable, reportCard, socialTable, tagsTable, templatesTable } from "@/server/ai/tools/marketing.parts";
import {
  audienceInputSchema,
  audienceRuleSchema,
  bulkTagSchema,
  campaignInputSchema,
  campaignUpdateSchema,
  contactCreateSchema,
  contactUpdateSchema,
  socialPostInputSchema,
  socialPostUpdateSchema,
  tagInputSchema,
  templateInputSchema,
  templateUpdateSchema,
  audienceUpdateSchema,
} from "@/features/marketing/schemas/marketing.schema";
import { CAMPAIGN_STATUSES, CONTACT_SOURCES, LIFECYCLE_STAGES, MARKETING_CHANNELS } from "@/features/marketing/types/constants";
import { DEFAULT_EMAIL_DESIGN, EMAIL_DESIGNS } from "@/features/marketing/utils/email-design";
import { isCampaignCancellable } from "@/features/marketing/utils/campaign-state";
import {
  approveCampaign,
  cancelCampaign,
  createCampaign,
  getCampaign,
  listCampaigns,
  listDeliveries,
  scheduleCampaign,
  submitCampaign,
  updateCampaign,
} from "@/server/marketing/campaign.service";
import { createAudience, getAudience, listAudiences, previewAudience, updateAudience } from "@/server/marketing/audience.service";
import { createContact, getContact, listContacts, updateContact } from "@/server/marketing/contact.service";
import { createTemplate, getTemplate, listTemplates, updateTemplate } from "@/server/marketing/template.service";
import { assignTags, createTag, listTags, removeTags, updateTag } from "@/server/marketing/tag.service";
import { getCampaignReport, getDashboard } from "@/server/marketing/analytics.service";
import { createSocialPost, getSocialPost, listSocialPosts, updateSocialPost } from "@/server/marketing/social/post.service";
import { connectedAccountOptions } from "@/server/marketing/social/accounts.service";
import { getConfiguredProviders } from "@/server/marketing/providers";
import { PERMISSIONS } from "@/server/security/permissions";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import { AppError } from "@/shared/lib/errors";
import { objectIdSchema } from "@/shared/lib/schema-primitives";
import { toFieldErrors } from "@/shared/lib/validation";
import type { AiDiffRow } from "@/server/db/documents";

/**
 * Marketing tools: thin wrappers over the existing Marketing services. The services own the campaign lifecycle, the
 * version checks, the recipient snapshot, the consent and suppression rules and the delivery engine; nothing here
 * duplicates them and no tool can send a message or call a provider.
 *
 * Grant cells: view = every read; create = new drafts (campaign, template, audience, tag, contact, social post);
 * edit = changes to drafts, submitting a campaign for approval, tagging contacts; approve = approving, scheduling and
 * cancelling a campaign, owner/admin only (the marketing.admin ceiling) and again checked against the approve and
 * dispatch rights the Marketing service itself requires.
 *
 * Deliberately NOT available: consent changes, contact deletion, Telegram links, social publishing or scheduling,
 * campaign or audience deletion, "send now", and every provider or integration setting.
 */
const R = PERMISSIONS.MARKETING_READ;
const optText = (max: number) => z.string().max(max).optional();
const pageNo = z.number().int().min(1).max(1000).optional();
const norm = (s: string) => s.trim().toLowerCase();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  throw new AppError("VALIDATION_ERROR", r.error.issues[0]?.message ?? "The request is invalid.", toFieldErrors(r.error));
}
const same = (expected: unknown, actual: unknown, what: string) => {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new AppError("CONFLICT", `${what} changed since you reviewed it. Ask again to see a fresh preview.`);
};
const diff = (rows: AiDiffRow[], label: string, before: string, after: string) => before !== after && rows.push({ label, before: before || "none", after: after || "none" });
const clip = (s: string, n = 240) => (s.length > n ? `${s.slice(0, n)}…` : s);

// ─── Reads ────────────────────────────────────────────────────────────────────

export const listCampaignsTool = defineTool({
  name: "marketing_list_campaigns",
  module: "marketing",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "List campaigns, newest first. status: all, draft, pending_approval, approved, scheduled, processing, completed, cancelled, failed. q matches the name.",
  input: z.object({ q: optText(80), status: z.enum(["all", ...CAMPAIGN_STATUSES]).optional(), channel: z.enum(["all", ...MARKETING_CHANNELS]).optional(), page: pageNo }).strict(),
  async run(ctx, args) {
    const page = await listCampaigns(ctx, { q: args.q ?? "", status: args.status ?? "all", channel: args.channel ?? "all", page: args.page ?? 1 });
    return {
      summary: `${page.total} campaign${page.total === 1 ? "" : "s"}`,
      parts: [campaignsTable(page, { ...(args.q ? { q: args.q } : {}), ...(args.status ? { status: args.status } : {}) })],
      data: { total: page.total, campaigns: modelRows(page.items, (c) => ({ id: c.id, name: c.name, channel: c.channel, status: c.status, audience: c.audienceName, scheduledAt: c.scheduledAt, version: c.version })) },
    };
  },
});

export const getCampaignTool = defineTool({
  name: "marketing_get_campaign",
  module: "marketing",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "Show one campaign: status, audience, the message as a recipient sees it, the recipient counts, schedule and what the person may do next. Never lists recipients.",
  input: z.object({ campaignId: objectIdSchema }).strict(),
  async run(ctx, args, { access }) {
    const c = await getCampaign(ctx, args.campaignId);
    const preview = renderPreview(c.channel, c);
    return {
      summary: `${c.name} (${c.status})`,
      parts: [campaignCard(c, mkScope(ctx), access, preview)],
      data: { id: c.id, name: c.name, channel: c.channel, status: c.status, version: c.version, audienceId: c.audienceId, audience: c.audienceName, subject: c.subject, body: c.body, scheduledAt: c.scheduledAt, recipients: c.snapshot ? { eligible: c.snapshot.eligibleCount, suppressed: c.snapshot.suppressedCount, matched: c.snapshot.matchedCount } : null, deliverySummary: c.deliverySummary },
    };
  },
});

export const listDeliveriesTool = defineTool({
  name: "marketing_list_deliveries",
  module: "marketing",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "Delivery status of one campaign, per recipient with the address MASKED. status filters (pending, sent, delivered, bounced, failed, suppressed...).",
  input: z.object({ campaignId: objectIdSchema, status: z.enum(["all", "pending", "sending", "sent", "delivered", "bounced", "complained", "failed", "suppressed"]).optional(), page: pageNo }).strict(),
  async run(ctx, args) {
    const page = await listDeliveries(ctx, args.campaignId, { status: args.status ?? "all", page: args.page ?? 1 });
    return { summary: `${page.total} deliveries`, parts: [deliveriesTable(page, { campaignId: args.campaignId })], data: { total: page.total, deliveries: modelRows(page.items, (d) => ({ contact: d.contactName, to: d.destinationMasked, status: d.status, note: d.exclusionReason ?? d.lastErrorCode })) } };
  },
});

export const campaignReportTool = defineTool({
  name: "marketing_campaign_report",
  module: "marketing",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "Delivery results and rates of one campaign, exactly as the Marketing report calculates them. Never recompute them.",
  input: z.object({ campaignId: objectIdSchema }).strict(),
  async run(ctx, args) {
    const r = await getCampaignReport(ctx, args.campaignId);
    return { summary: `Report for ${r.name}`, parts: [reportCard(r)], data: { name: r.name, status: r.status, recipients: r.snapshot, accepted: r.accepted, deliveries: r.deliveries, unsubscribes: r.unsubscribes, rates: r.rates, support: r.support } };
  },
});

export const listAudiencesTool = defineTool({
  name: "marketing_list_audiences",
  module: "marketing",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "List audiences (ids, names, whether active). q matches the name.",
  input: z.object({ q: optText(80), active: z.enum(["all", "true", "false"]).optional(), page: pageNo }).strict(),
  async run(ctx, args, { access }) {
    const page = await listAudiences(ctx, { q: args.q ?? "", active: args.active ?? "all", page: args.page ?? 1 });
    return { summary: `${page.total} audiences`, parts: [audiencesTable(page, args.q ? { q: args.q } : {}, access)], data: { total: page.total, audiences: modelRows(page.items, (a) => ({ id: a.id, name: a.name, active: a.isActive })) } };
  },
});

export const previewAudienceTool = defineTool({
  name: "marketing_preview_audience",
  module: "marketing",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "How many contacts an audience matches and how many could actually receive a message on a channel (consent and suppression applied). Counts only, never contacts.",
  input: z.object({ audienceId: objectIdSchema, channel: z.enum(MARKETING_CHANNELS) }).strict(),
  async run(ctx, args) {
    const a = await getAudience(ctx, args.audienceId);
    if (!a.rule) throw new AppError("VALIDATION_ERROR", "This audience has no usable rule.");
    const p = await previewAudience(ctx, a.rule, args.channel);
    const size = { matched: p.matchedCount, eligible: p.eligibleCount, exclusions: p.exclusions as Record<string, number> };
    return { summary: `${a.name}: ${p.eligibleCount} eligible on ${args.channel}`, parts: [audienceCard(a, size, args.channel)], data: { audience: a.name, channel: args.channel, matched: p.matchedCount, eligible: p.eligibleCount, exclusions: p.exclusions, truncated: p.truncated } };
  },
});

export const listContactsTool = defineTool({
  name: "marketing_list_contacts",
  module: "marketing",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "Search contacts (q matches name or email). Email and phone are always MASKED here. lifecycle: lead, prospect, customer, inactive.",
  input: z.object({ q: optText(80), lifecycle: z.enum(["all", ...LIFECYCLE_STAGES]).optional(), page: pageNo }).strict(),
  async run(ctx, args, { access }) {
    const scope = mkScope(ctx);
    const page = await listContacts(ctx, { q: args.q ?? "", lifecycle: args.lifecycle ?? "all", source: "all", active: "all", tagMode: "any", sort: "name", dir: "asc", page: args.page ?? 1 });
    const rows = page.items.map((c) => contactView(c, scope, false));
    return { summary: `${page.total} contact${page.total === 1 ? "" : "s"}`, parts: [contactsTable(rows, page.total, page.page, page.totalPages, args.q ? { q: args.q } : {}, access)], data: { total: page.total, contacts: modelRows(rows, (c) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone, stage: c.lifecycleStage, active: c.isActive })) } };
  },
});

export const getContactTool = defineTool({
  name: "marketing_get_contact",
  module: "marketing",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "Show one contact with consent status (read-only) and tags. Email and phone are masked unless reveal is true, which only a contact manager may use.",
  input: z.object({ contactId: objectIdSchema, reveal: z.boolean().optional() }).strict(),
  async run(ctx, args) {
    const scope = mkScope(ctx);
    if (args.reveal && !scope.manageContacts) throw new AppError("FORBIDDEN", "Full contact details are only for people who manage contacts.");
    const c = await getContact(ctx, args.contactId);
    const v = contactView(c, scope, args.reveal === true);
    const consent = { email: c.consent.email?.status ?? "none", sms: c.consent.sms?.status ?? "none", telegram: c.consent.telegram?.status ?? "none" };
    return { summary: v.name, parts: [contactCard(v, consent, c.tags.map((t) => t.name))], data: { ...v, consent, tags: c.tags.map((t) => t.name) } };
  },
});

export const listTemplatesTool = defineTool({
  name: "marketing_list_templates",
  module: "marketing",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "List message templates (id, name, channel, subject). q matches the name.",
  input: z.object({ q: optText(80), channel: z.enum(["all", ...MARKETING_CHANNELS]).optional(), page: pageNo }).strict(),
  async run(ctx, args, { access }) {
    const page = await listTemplates(ctx, { q: args.q ?? "", channel: args.channel ?? "all", page: args.page ?? 1 });
    return { summary: `${page.total} templates`, parts: [templatesTable(page, args.q ? { q: args.q } : {}, access)], data: { total: page.total, templates: modelRows(page.items, (t) => ({ id: t.id, name: t.name, channel: t.channel, subject: t.subject, active: t.isActive })) } };
  },
});

export const listTagsTool = defineTool({
  name: "marketing_list_tags",
  module: "marketing",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "List contact tags with ids and how many contacts have each.",
  input: z.object({}).strict(),
  async run(ctx) {
    const tags = await listTags(ctx);
    return { summary: `${tags.length} tags`, parts: [tagsTable(tags)], data: { tags: modelRows(tags, (t) => ({ id: t.id, name: t.name, contacts: t.contactCount }), 60) } };
  },
});

export const dashboardTool = defineTool({
  name: "marketing_dashboard",
  module: "marketing",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "Marketing overview counts: contacts, audiences, campaigns, deliveries, unsubscribes.",
  input: z.object({}).strict(),
  async run(ctx) {
    const d = await getDashboard(ctx);
    return { summary: "Marketing overview", parts: [dashboardCard(d)], data: { contacts: d.contacts, audiences: d.audiences, campaigns: d.campaigns, deliveries: d.deliveries, unsubscribes: d.unsubscribes } };
  },
});

export const integrationStatusTool = defineTool({
  name: "marketing_integration_status",
  module: "marketing",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "Whether email, SMS and Telegram sending are set up, and whether a recipient allowlist is active. Yes/no only: no account, key or address is ever shown.",
  input: z.object({}).strict(),
  async run() {
    const f = integrationFlags();
    return { summary: "Integration status", parts: [{ type: "record_card" as const, title: "Sending setup", fields: [{ label: "Email", value: f.email ? "Ready" : "Not set up" }, { label: "SMS", value: f.sms ? "Ready" : "Not set up" }, { label: "Telegram", value: f.telegram ? "Ready" : "Not set up" }, { label: "Recipient allowlist", value: f.allowlistActive ? "Active" : "Off" }, { label: "Production", value: f.production ? "Yes" : "No" }] }], data: f };
  },
});

export const listSocialPostsTool = defineTool({
  name: "marketing_list_social_posts",
  module: "marketing",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "List social post drafts and their status. Publishing is never done through AI.",
  input: z.object({ status: z.enum(["all", "draft", "scheduled", "published", "failed", "cancelled"]).optional(), page: pageNo }).strict(),
  async run(ctx, args) {
    const page = await listSocialPosts(ctx, { status: args.status ?? "all", page: args.page ?? 1 });
    return { summary: `${page.total} posts`, parts: [socialTable(page, args.status ? { status: args.status } : {})], data: { total: page.total, posts: modelRows(page.items, (p) => ({ id: p.id, account: p.accountName, status: p.status, content: clip(p.content, 120) })) } };
  },
});

export const listSocialAccountsTool = defineTool({
  name: "marketing_list_social_accounts",
  module: "marketing",
  operation: "view",
  kind: "read",
  risk: "low",
  permission: R,
  description: "Connected social accounts (id and display name only) a post draft can be attached to.",
  input: z.object({}).strict(),
  async run(ctx) {
    const rows = await connectedAccountOptions(ctx);
    return { summary: `${rows.length} accounts`, data: { accounts: modelRows(rows, (a) => ({ id: a.id, name: a.name })) } };
  },
});

// ─── Writes: drafts ───────────────────────────────────────────────────────────

const messageFields = { channel: z.enum(MARKETING_CHANNELS), subject: optText(300), body: z.string().max(5000), design: z.enum(EMAIL_DESIGNS).optional() };

export const createCampaignTool = defineTool({
  name: "marketing_create_campaign",
  module: "marketing",
  operation: "create",
  kind: "write",
  risk: "sensitive",
  permission: PERMISSIONS.MARKETING_CAMPAIGN_MANAGE,
  description: "Propose a new DRAFT campaign (nothing is sent; it still needs submission, approval and scheduling). name, channel, audienceId and body are required; email also needs a subject. Allowed variables: {{first_name}}, {{last_name}}, {{email}}, {{company_name}}, {{unsubscribe_url}}.",
  input: z.object({ name: z.string().max(120), audienceId: objectIdSchema, templateId: objectIdSchema.optional(), ...messageFields }).strict(),
  async prepare(ctx, args) {
    const input = parse(campaignInputSchema, { ...args, templateId: args.templateId ?? "", subject: args.subject ?? "", design: args.channel === "email" ? args.design ?? DEFAULT_EMAIL_DESIGN : DEFAULT_EMAIL_DESIGN });
    const audience = await getAudience(ctx, input.audienceId);
    if (!audience.isActive) throw new AppError("VALIDATION_ERROR", `${audience.name} is inactive.`);
    const preview = renderPreview(input.channel, input);
    return {
      context: { input },
      summary: `Create the draft campaign "${input.name}" (${input.channel}) for ${audience.name}. Nothing is sent.`,
      details: [{ label: "Name", after: input.name }, { label: "Channel", after: input.channel }, { label: "Audience", after: audience.name }, ...(input.channel === "email" ? [{ label: "Subject", after: input.subject }] : []), { label: "Message (example recipient)", after: clip(preview.text) }],
    };
  },
  async run(ctx, _a, { access }, context) {
    const c = await createCampaign(ctx, context.input as Parameters<typeof createCampaign>[1]);
    return { summary: `Created the draft campaign ${c.name}.`, parts: [campaignCard(c, mkScope(ctx), access, renderPreview(c.channel, c))], data: { id: c.id } };
  },
});

export const updateCampaignTool = defineTool({
  name: "marketing_update_campaign",
  module: "marketing",
  operation: "edit",
  kind: "write",
  risk: "sensitive",
  permission: PERMISSIONS.MARKETING_CAMPAIGN_MANAGE,
  description: "Propose changes to a DRAFT campaign. Send campaignId and only what changes (name, audienceId, subject, body, design). Only drafts can be edited.",
  input: z.object({ campaignId: objectIdSchema, name: optText(120), audienceId: objectIdSchema.optional(), subject: optText(300), body: z.string().max(5000).optional(), design: z.enum(EMAIL_DESIGNS).optional() }).strict(),
  async prepare(ctx, args) {
    const cur = await getCampaign(ctx, args.campaignId);
    if (cur.status !== "draft") throw new AppError("INVALID_TRANSITION", `${cur.name} is ${cur.status}. Only drafts can be edited.`);
    const input = parse(campaignUpdateSchema, { name: args.name ?? cur.name, channel: cur.channel, audienceId: args.audienceId ?? cur.audienceId, templateId: cur.templateId ?? "", subject: args.subject ?? cur.subject, body: args.body ?? cur.body, design: args.design ?? cur.design, expectedVersion: cur.version });
    const rows: AiDiffRow[] = [];
    diff(rows, "Name", cur.name, input.name);
    if (input.audienceId !== cur.audienceId) {
      const a = await getAudience(ctx, input.audienceId);
      if (!a.isActive) throw new AppError("VALIDATION_ERROR", `${a.name} is inactive.`);
      rows.push({ label: "Audience", before: cur.audienceName, after: a.name });
    }
    diff(rows, "Subject", cur.subject, input.subject);
    diff(rows, "Message", clip(cur.body), clip(input.body));
    diff(rows, "Design", cur.design, input.design ?? cur.design);
    if (rows.length === 0) throw new AppError("VALIDATION_ERROR", "That would not change anything.");
    return { context: { input, version: cur.version, name: cur.name }, summary: `Update the draft campaign "${cur.name}".`, details: rows };
  },
  async run(ctx, args, _e, context) {
    const c = await updateCampaign(ctx, args.campaignId, context.input as Parameters<typeof updateCampaign>[2]);
    return { summary: `Updated the draft campaign ${c.name}.` };
  },
});

export const submitCampaignTool = defineTool({
  name: "marketing_submit_campaign",
  module: "marketing",
  operation: "edit",
  kind: "write",
  risk: "sensitive",
  permission: PERMISSIONS.MARKETING_CAMPAIGN_MANAGE,
  description: "Propose submitting a DRAFT campaign for approval. Nothing is sent; an owner or admin still has to approve and schedule it.",
  input: z.object({ campaignId: objectIdSchema }).strict(),
  async prepare(ctx, args) {
    const c = await getCampaign(ctx, args.campaignId);
    if (c.status !== "draft") throw new AppError("INVALID_TRANSITION", `${c.name} is ${c.status}. Only drafts can be submitted.`);
    const preview = renderPreview(c.channel, c);
    return {
      context: { version: c.version, name: c.name },
      summary: `Submit "${c.name}" for approval. Nothing is sent.`,
      details: [{ label: "Campaign", after: c.name }, { label: "Channel", after: c.channel }, { label: "Audience", after: c.audienceName }, ...(c.channel === "email" ? [{ label: "Subject", after: c.subject }] : []), { label: "Message (example recipient)", after: clip(preview.text) }],
    };
  },
  async run(ctx, args, _e, context) {
    await submitCampaign(ctx, args.campaignId, Number(context.version));
    return { summary: `Submitted ${String(context.name)} for approval.` };
  },
});

export const createTemplateTool = defineTool({
  name: "marketing_create_template",
  module: "marketing",
  operation: "create",
  kind: "write",
  risk: "low",
  permission: PERMISSIONS.MARKETING_TEMPLATE_MANAGE,
  description: "Propose a new message template. name, channel and body are required; email also needs a subject. Allowed variables: {{first_name}}, {{last_name}}, {{email}}, {{company_name}}, {{unsubscribe_url}}.",
  input: z.object({ name: z.string().max(120), isActive: z.boolean().optional(), ...messageFields }).strict(),
  async prepare(ctx, args) {
    const input = parse(templateInputSchema, { ...args, subject: args.subject ?? "", design: args.channel === "email" ? args.design ?? DEFAULT_EMAIL_DESIGN : DEFAULT_EMAIL_DESIGN, isActive: args.isActive ?? true });
    const dup = (await listTemplates(ctx, { q: input.name, channel: "all", page: 1 })).items.find((t) => norm(t.name) === norm(input.name));
    if (dup) throw new AppError("CONFLICT", `A template named "${dup.name}" already exists.`);
    return { context: { input }, summary: `Create the ${input.channel} template "${input.name}".`, details: [{ label: "Name", after: input.name }, { label: "Channel", after: input.channel }, ...(input.channel === "email" ? [{ label: "Subject", after: input.subject }] : []), { label: "Message", after: clip(input.body) }] };
  },
  async run(ctx, _a, _e, context) {
    const t = await createTemplate(ctx, context.input as Parameters<typeof createTemplate>[1]);
    return { summary: `Created the template ${t.name}.` };
  },
});

export const updateTemplateTool = defineTool({
  name: "marketing_update_template",
  module: "marketing",
  operation: "edit",
  kind: "write",
  risk: "low",
  permission: PERMISSIONS.MARKETING_TEMPLATE_MANAGE,
  description: "Propose changes to a template. Send templateId and only what changes (name, subject, body, design, isActive).",
  input: z.object({ templateId: objectIdSchema, name: optText(120), subject: optText(300), body: z.string().max(5000).optional(), design: z.enum(EMAIL_DESIGNS).optional(), isActive: z.boolean().optional() }).strict(),
  async prepare(ctx, args) {
    const cur = await getTemplate(ctx, args.templateId);
    const input = parse(templateUpdateSchema, { name: args.name ?? cur.name, channel: cur.channel, subject: args.subject ?? cur.subject, body: args.body ?? cur.body, design: args.design ?? cur.design, isActive: args.isActive ?? cur.isActive, expectedVersion: cur.version });
    const rows: AiDiffRow[] = [];
    diff(rows, "Name", cur.name, input.name);
    diff(rows, "Subject", cur.subject, input.subject);
    diff(rows, "Message", clip(cur.body), clip(input.body));
    diff(rows, "Active", cur.isActive ? "yes" : "no", input.isActive ? "yes" : "no");
    if (rows.length === 0) throw new AppError("VALIDATION_ERROR", "That would not change anything.");
    return { context: { input, version: cur.version, name: cur.name }, summary: `Update the template "${cur.name}".`, details: rows };
  },
  async run(ctx, args, _e, context) {
    const t = await updateTemplate(ctx, args.templateId, context.input as Parameters<typeof updateTemplate>[2]);
    return { summary: `Updated the template ${t.name}.` };
  },
});

const ruleArg = audienceRuleSchema;

export const createAudienceTool = defineTool({
  name: "marketing_create_audience",
  module: "marketing",
  operation: "create",
  kind: "write",
  risk: "low",
  permission: PERMISSIONS.MARKETING_AUDIENCE_MANAGE,
  description: "Propose a new audience from a typed rule: match all|any of conditions (lifecycle_stage values, source values, active, tags tagIds+match, consent channel+status, created_after date). No raw queries.",
  input: z.object({ name: z.string().max(120), description: optText(500), isActive: z.boolean().optional(), rule: ruleArg }).strict(),
  async prepare(ctx, args) {
    const input = parse(audienceInputSchema, { name: args.name, description: args.description ?? "", isActive: args.isActive ?? true, rule: args.rule });
    const dup = (await listAudiences(ctx, { q: input.name, active: "all", page: 1 })).items.find((a) => norm(a.name) === norm(input.name));
    if (dup) throw new AppError("CONFLICT", `An audience named "${dup.name}" already exists.`);
    const sizes = await Promise.all(MARKETING_CHANNELS.map(async (c) => [c, (await previewAudience(ctx, input.rule, c)).eligibleCount] as const));
    return { context: { input }, summary: `Create the audience "${input.name}".`, details: [{ label: "Name", after: input.name }, { label: "Rule", after: `${input.rule.match === "all" ? "All" : "Any"} of ${input.rule.conditions.map((c) => c.type).join(", ")}` }, { label: "Eligible now", after: sizes.map(([c, n]) => `${c}: ${n}`).join(" · ") }] };
  },
  async run(ctx, _a, _e, context) {
    const a = await createAudience(ctx, context.input as Parameters<typeof createAudience>[1]);
    return { summary: `Created the audience ${a.name}.` };
  },
});

export const updateAudienceTool = defineTool({
  name: "marketing_update_audience",
  module: "marketing",
  operation: "edit",
  kind: "write",
  risk: "low",
  permission: PERMISSIONS.MARKETING_AUDIENCE_MANAGE,
  description: "Propose changes to an audience: name, description, isActive, or a new typed rule (replaces the old one).",
  input: z.object({ audienceId: objectIdSchema, name: optText(120), description: optText(500), isActive: z.boolean().optional(), rule: ruleArg.optional() }).strict(),
  async prepare(ctx, args) {
    const cur = await getAudience(ctx, args.audienceId);
    if (!cur.rule) throw new AppError("VALIDATION_ERROR", "This audience has no usable rule. Fix it in Marketing.");
    const input = parse(audienceUpdateSchema, { name: args.name ?? cur.name, description: args.description ?? cur.description, isActive: args.isActive ?? cur.isActive, rule: args.rule ?? cur.rule, expectedVersion: cur.version });
    const rows: AiDiffRow[] = [];
    diff(rows, "Name", cur.name, input.name);
    diff(rows, "Description", cur.description, input.description ?? "");
    diff(rows, "Active", cur.isActive ? "yes" : "no", input.isActive ? "yes" : "no");
    if (JSON.stringify(input.rule) !== JSON.stringify(cur.rule)) rows.push({ label: "Rule", before: `${cur.rule.match} of ${cur.rule.conditions.map((c) => c.type).join(", ")}`, after: `${input.rule.match} of ${input.rule.conditions.map((c) => c.type).join(", ")}` });
    if (rows.length === 0) throw new AppError("VALIDATION_ERROR", "That would not change anything.");
    return { context: { input, version: cur.version, name: cur.name }, summary: `Update the audience "${cur.name}". Campaigns already approved keep their frozen recipients.`, details: rows };
  },
  async run(ctx, args, _e, context) {
    const a = await updateAudience(ctx, args.audienceId, context.input as Parameters<typeof updateAudience>[2]);
    return { summary: `Updated the audience ${a.name}.` };
  },
});

export const createTagTool = defineTool({
  name: "marketing_create_tag",
  module: "marketing",
  operation: "create",
  kind: "write",
  risk: "low",
  permission: PERMISSIONS.MARKETING_TAG_MANAGE,
  description: "Propose a new contact tag. name required; color is a hex like #1f7a5c (default #1f7a5c).",
  input: z.object({ name: z.string().max(40), color: optText(7) }).strict(),
  async prepare(ctx, args) {
    const input = parse(tagInputSchema, { name: args.name, color: args.color ?? "#1f7a5c" });
    if ((await listTags(ctx)).some((t) => norm(t.name) === norm(input.name))) throw new AppError("CONFLICT", `A tag named "${input.name}" already exists.`);
    return { context: { input }, summary: `Create the tag "${input.name}".`, details: [{ label: "Name", after: input.name }, { label: "Colour", after: input.color }] };
  },
  async run(ctx, _a, _e, context) {
    const t = await createTag(ctx, context.input as Parameters<typeof createTag>[1]);
    return { summary: `Created the tag ${t.name}.` };
  },
});

export const updateTagTool = defineTool({
  name: "marketing_update_tag",
  module: "marketing",
  operation: "edit",
  kind: "write",
  risk: "low",
  permission: PERMISSIONS.MARKETING_TAG_MANAGE,
  description: "Propose renaming or recolouring a tag. Send tagId and what changes.",
  input: z.object({ tagId: objectIdSchema, name: optText(40), color: optText(7) }).strict(),
  async prepare(ctx, args) {
    const tags = await listTags(ctx);
    const cur = tags.find((t) => t.id === args.tagId);
    if (!cur) throw new AppError("NOT_FOUND", "Tag not found.");
    const input = parse(tagInputSchema, { name: args.name ?? cur.name, color: args.color ?? cur.color });
    const rows: AiDiffRow[] = [];
    diff(rows, "Name", cur.name, input.name);
    diff(rows, "Colour", cur.color, input.color);
    if (rows.length === 0) throw new AppError("VALIDATION_ERROR", "That would not change anything.");
    if (norm(input.name) !== norm(cur.name) && tags.some((t) => t.id !== cur.id && norm(t.name) === norm(input.name))) throw new AppError("CONFLICT", `A tag named "${input.name}" already exists.`);
    return { context: { input, fp: [cur.name, cur.color], name: cur.name }, summary: `Update the tag "${cur.name}".`, details: rows };
  },
  async run(ctx, args, _e, context) {
    const cur = (await listTags(ctx)).find((t) => t.id === args.tagId);
    if (!cur) throw new AppError("NOT_FOUND", "Tag not found.");
    same(context.fp, [cur.name, cur.color], `The tag ${String(context.name)}`);
    await updateTag(ctx, args.tagId, context.input as Parameters<typeof updateTag>[2]);
    return { summary: `Updated the tag ${String(context.name)}.` };
  },
});

const tagBulk = { tagId: objectIdSchema, contactIds: z.array(objectIdSchema).min(1).max(100) };

function tagTool(action: "assign" | "remove") {
  return defineTool({
    name: `marketing_${action}_tag`,
    module: "marketing",
    operation: "edit",
    kind: "write",
    risk: "low",
    permission: PERMISSIONS.MARKETING_TAG_MANAGE,
    description: `Propose to ${action} a tag ${action === "assign" ? "on" : "from"} up to 100 contacts (ids from marketing_list_contacts).`,
    input: z.object(tagBulk).strict(),
    async prepare(ctx, args) {
      parse(bulkTagSchema, args);
      const tag = (await listTags(ctx)).find((t) => t.id === args.tagId);
      if (!tag) throw new AppError("NOT_FOUND", "Tag not found.");
      for (const id of args.contactIds) await getContact(ctx, id); // each must be a contact of this company
      return { context: { tag: tag.name }, summary: `${action === "assign" ? "Add" : "Remove"} the tag "${tag.name}" ${action === "assign" ? "to" : "from"} ${args.contactIds.length} contact${args.contactIds.length === 1 ? "" : "s"}.`, details: [{ label: "Tag", after: tag.name }, { label: "Contacts", after: String(args.contactIds.length) }] };
    },
    async run(ctx, args, _e, context) {
      const r = action === "assign" ? await assignTags(ctx, args.contactIds, args.tagId) : await removeTags(ctx, args.contactIds, args.tagId);
      return { summary: `${action === "assign" ? "Tagged" : "Untagged"} contacts with ${String(context.tag)}: ${JSON.stringify(r)}.` };
    },
  });
}
export const assignTagTool = tagTool("assign");
export const removeTagTool = tagTool("remove");

const contactFields = { firstName: z.string().max(80), lastName: optText(80), email: optText(254), phone: optText(25), source: z.enum(CONTACT_SOURCES).optional(), lifecycleStage: z.enum(LIFECYCLE_STAGES).optional() };

export const createContactTool = defineTool({
  name: "marketing_create_contact",
  module: "marketing",
  operation: "create",
  kind: "write",
  risk: "sensitive",
  permission: PERMISSIONS.MARKETING_CONTACT_MANAGE,
  description: "Propose a new contact. firstName and at least an email or a phone are required and must come from the person. The contact is created WITHOUT any marketing consent: consent is recorded manually in Marketing, never here.",
  input: z.object(contactFields).strict(),
  async prepare(ctx, args) {
    const input = parse(contactCreateSchema, { firstName: args.firstName, lastName: args.lastName ?? "", email: args.email ?? "", phone: args.phone ?? "", source: args.source ?? "manual", lifecycleStage: args.lifecycleStage ?? "lead", isActive: true, consent: { email: false, sms: false } });
    if (!input.email && !input.phone) throw new AppError("VALIDATION_ERROR", "Give an email address or a phone number.");
    const v = contactView({ id: "", fullName: `${input.firstName} ${input.lastName}`.trim(), email: input.email, phone: input.phone, source: input.source, lifecycleStage: input.lifecycleStage, isActive: true, version: 1 }, mkScope(ctx), false);
    return { context: { input }, summary: `Create the contact ${v.name} with no marketing consent.`, details: [{ label: "Name", after: v.name }, { label: "Email", after: v.email || "none" }, { label: "Phone", after: v.phone || "none" }, { label: "Stage", after: input.lifecycleStage }, { label: "Consent", after: "none (record it in Marketing)" }] };
  },
  async run(ctx, _a, _e, context) {
    const input = { ...(context.input as Parameters<typeof createContact>[1]), consent: { email: false, sms: false } };
    const c = await createContact(ctx, input);
    return { summary: `Created the contact ${c.fullName}.`, data: { id: c.id } };
  },
});

export const updateContactTool = defineTool({
  name: "marketing_update_contact",
  module: "marketing",
  operation: "edit",
  kind: "write",
  risk: "sensitive",
  permission: PERMISSIONS.MARKETING_CONTACT_MANAGE,
  description: "Propose changes to a contact's name, email, phone, source, lifecycle stage or active flag. Consent never changes here. An email or phone that already has marketing consent cannot be changed or removed through AI.",
  input: z.object({ contactId: objectIdSchema, ...contactFields, firstName: optText(80), isActive: z.boolean().optional() }).strict(),
  async prepare(ctx, args) {
    const cur = await getContact(ctx, args.contactId);
    const emailGranted = cur.consent.email?.status === "granted";
    const smsGranted = cur.consent.sms?.status === "granted";
    if (args.email !== undefined && args.email.trim().toLowerCase() !== cur.email.toLowerCase() && emailGranted) throw new AppError("FORBIDDEN", "This email address has marketing consent, so it cannot be changed here. Change it in Marketing, where consent is handled.");
    if (args.phone !== undefined && args.phone.trim() !== cur.phone && smsGranted) throw new AppError("FORBIDDEN", "This phone number has SMS consent, so it cannot be changed here. Change it in Marketing, where consent is handled.");
    const input = parse(contactUpdateSchema, {
      firstName: args.firstName ?? cur.firstName,
      lastName: args.lastName ?? cur.lastName,
      email: args.email ?? cur.email,
      phone: args.phone ?? cur.phone,
      source: args.source ?? cur.source,
      lifecycleStage: args.lifecycleStage ?? cur.lifecycleStage,
      isActive: args.isActive ?? cur.isActive,
      // The stored consent, unchanged: this is what makes an edit unable to grant or withdraw anything.
      consent: { email: emailGranted, sms: smsGranted },
      expectedVersion: cur.version,
    });
    if (emailGranted && !input.email) throw new AppError("FORBIDDEN", "This contact has email consent; the address cannot be removed here.");
    if (smsGranted && !input.phone) throw new AppError("FORBIDDEN", "This contact has SMS consent; the number cannot be removed here.");
    const before = contactView(cur, mkScope(ctx), false);
    const after = contactView({ id: cur.id, fullName: `${input.firstName} ${input.lastName}`.trim(), email: input.email, phone: input.phone, source: input.source, lifecycleStage: input.lifecycleStage, isActive: input.isActive, version: cur.version }, mkScope(ctx), false);
    const rows: AiDiffRow[] = [];
    diff(rows, "Name", before.name, after.name);
    diff(rows, "Email", before.email, after.email);
    diff(rows, "Phone", before.phone, after.phone);
    diff(rows, "Stage", before.lifecycleStage, after.lifecycleStage);
    diff(rows, "Source", before.source, after.source);
    diff(rows, "Active", before.isActive ? "yes" : "no", after.isActive ? "yes" : "no");
    if (rows.length === 0) throw new AppError("VALIDATION_ERROR", "That would not change anything.");
    rows.push({ label: "Consent", after: "unchanged" });
    return { context: { input, version: cur.version, name: before.name }, summary: `Update the contact ${before.name}. Consent stays as it is.`, details: rows };
  },
  async run(ctx, args, _e, context) {
    const cur = await getContact(ctx, args.contactId);
    same(Number(context.version), cur.version, `The contact ${String(context.name)}`);
    // Re-derive consent from the live record, never from the proposal.
    const input = { ...(context.input as Parameters<typeof updateContact>[2]), consent: { email: cur.consent.email?.status === "granted", sms: cur.consent.sms?.status === "granted" } };
    await updateContact(ctx, args.contactId, input);
    return { summary: `Updated the contact ${String(context.name)}.` };
  },
});

export const createSocialPostTool = defineTool({
  name: "marketing_create_social_post",
  module: "marketing",
  operation: "create",
  kind: "write",
  risk: "low",
  permission: PERMISSIONS.MARKETING_SOCIAL_MANAGE,
  description: "Propose a social post DRAFT for a connected account (ids from marketing_list_social_accounts). It is never scheduled or published through AI.",
  input: z.object({ socialAccountId: objectIdSchema, content: z.string().max(5000) }).strict(),
  async prepare(ctx, args) {
    const input = parse(socialPostInputSchema, args);
    const acct = (await connectedAccountOptions(ctx)).find((a) => a.id === input.socialAccountId);
    if (!acct) throw new AppError("VALIDATION_ERROR", "Choose an account connected to this company.");
    return { context: { input }, summary: `Save a draft post for ${acct.name}. It is not published.`, details: [{ label: "Account", after: acct.name }, { label: "Post", after: clip(input.content) }] };
  },
  async run(ctx, _a, _e, context) {
    const p = await createSocialPost(ctx, context.input as Parameters<typeof createSocialPost>[1]);
    return { summary: `Saved a draft post for ${p.accountName}.`, data: { id: p.id } };
  },
});

export const updateSocialPostTool = defineTool({
  name: "marketing_update_social_post",
  module: "marketing",
  operation: "edit",
  kind: "write",
  risk: "low",
  permission: PERMISSIONS.MARKETING_SOCIAL_MANAGE,
  description: "Propose changes to a social post DRAFT (account or content). Never schedules or publishes.",
  input: z.object({ postId: objectIdSchema, socialAccountId: objectIdSchema.optional(), content: z.string().max(5000).optional() }).strict(),
  async prepare(ctx, args) {
    const cur = await getSocialPost(ctx, args.postId);
    if (cur.status !== "draft") throw new AppError("INVALID_TRANSITION", `That post is ${cur.status}. Only drafts can be edited.`);
    const input = parse(socialPostUpdateSchema, { socialAccountId: args.socialAccountId ?? cur.socialAccountId, content: args.content ?? cur.content, expectedVersion: cur.version });
    const rows: AiDiffRow[] = [];
    diff(rows, "Post", clip(cur.content), clip(input.content));
    if (input.socialAccountId !== cur.socialAccountId) rows.push({ label: "Account", before: cur.accountName, after: (await connectedAccountOptions(ctx)).find((a) => a.id === input.socialAccountId)?.name ?? "unknown" });
    if (rows.length === 0) throw new AppError("VALIDATION_ERROR", "That would not change anything.");
    return { context: { input, version: cur.version }, summary: "Update the draft social post. It is not published.", details: rows };
  },
  async run(ctx, args, _e, context) {
    await updateSocialPost(ctx, args.postId, context.input as Parameters<typeof updateSocialPost>[2]);
    return { summary: "Updated the draft post." };
  },
});

// ─── The send boundary: approve, schedule, cancel ─────────────────────────────

const typedFor = (name: string, eligible: number) => `${name} · ${eligible}`;

async function snapshotCounts(ctx: WorkspaceContext, audienceId: string, channel: (typeof MARKETING_CHANNELS)[number]) {
  const a = await getAudience(ctx, audienceId);
  if (!a.isActive || !a.rule) throw new AppError("VALIDATION_ERROR", `The audience ${a.name} is inactive or has no usable rule.`);
  return { audience: a, preview: await previewAudience(ctx, a.rule, channel) };
}
const exclusionText = (e: Record<string, number>) => Object.entries(e).filter(([, n]) => n > 0).map(([k, n]) => `${k.replace(/_/g, " ")}: ${n}`).join(" · ") || "none";

export const approveCampaignTool = defineTool({
  name: "marketing_approve_campaign",
  module: "marketing",
  operation: "approve",
  kind: "write",
  risk: "financial",
  permission: PERMISSIONS.MARKETING_ADMIN,
  description: "Propose APPROVING a campaign that is waiting for approval. Approval freezes the recipient list; it does not send anything (scheduling is separate). Owner/admin only. Needs the campaign name and eligible recipient count typed to confirm.",
  input: z.object({ campaignId: objectIdSchema }).strict(),
  async prepare(ctx, args) {
    requireSender(ctx);
    const c = await getCampaign(ctx, args.campaignId);
    if (c.status !== "pending_approval") throw new AppError("INVALID_TRANSITION", `${c.name} is ${c.status}. Only campaigns waiting for approval can be approved.`);
    const { audience, preview } = await snapshotCounts(ctx, c.audienceId, c.channel);
    if (preview.eligibleCount === 0) throw new AppError("VALIDATION_ERROR", "No recipients are eligible. Check the audience and each contact's consent.");
    const msg = renderPreview(c.channel, c);
    const e = sendEnvironment();
    return {
      context: { version: c.version, eligible: preview.eligibleCount, name: c.name },
      summary: `Approve "${c.name}" for ${preview.eligibleCount} eligible recipient${preview.eligibleCount === 1 ? "" : "s"} on ${c.channel}. This freezes the list; nothing is sent until it is scheduled.`,
      details: [
        { label: "Campaign", after: c.name },
        { label: "Channel", after: c.channel },
        { label: "Audience", after: audience.name },
        { label: "Matched", after: String(preview.matchedCount) },
        { label: "Eligible", after: String(preview.eligibleCount) },
        { label: "Excluded", after: `${preview.matchedCount - preview.eligibleCount} (${exclusionText(preview.exclusions as Record<string, number>)})` },
        ...(c.channel === "email" ? [{ label: "Subject", after: c.subject }] : []),
        { label: "Message (example recipient)", after: clip(msg.text, 600) },
        { label: "Recipient allowlist", after: e.allowlistActive ? `active (${e.allowlistSize} entries)` : "off" },
      ],
      typedPhrase: typedFor(c.name, preview.eligibleCount),
    };
  },
  async run(ctx, args, _e, context) {
    requireSender(ctx);
    const c = await getCampaign(ctx, args.campaignId);
    same({ version: context.version, status: "pending_approval" }, { version: c.version, status: c.status }, `The campaign ${String(context.name)}`);
    const { preview } = await snapshotCounts(ctx, c.audienceId, c.channel);
    same(context.eligible, preview.eligibleCount, "The eligible recipients of this campaign");
    const done = await approveCampaign(ctx, args.campaignId, c.version);
    return { summary: `Approved ${done.name}: ${done.snapshot?.eligibleCount ?? 0} eligible, ${done.snapshot?.suppressedCount ?? 0} suppressed. Not scheduled yet.` };
  },
});

const instant = z.string().max(40);
const MIN_LEAD_MS = 5 * 60_000;

/** An explicit date and time WITH its timezone. Empty, relative ("now") or offset-less values are refused: nothing here can turn into "send now". */
export function parseSendTime(raw: string, now = new Date()): Date {
  const s = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/.test(s)) {
    throw new AppError("VALIDATION_ERROR", "Give the exact send time with its timezone, for example 2026-12-01T09:00:00+01:00. Empty, \"now\" and times without a timezone are refused.");
  }
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw new AppError("VALIDATION_ERROR", "That is not a real date and time.");
  if (t < now.getTime() + MIN_LEAD_MS) throw new AppError("VALIDATION_ERROR", "Choose a time at least 5 minutes in the future. Sending immediately is not available through AI.");
  if (t > now.getTime() + 365 * 86_400_000) throw new AppError("VALIDATION_ERROR", "Schedule at most 365 days ahead.");
  return new Date(t);
}

export const scheduleCampaignTool = defineTool({
  name: "marketing_schedule_campaign",
  module: "marketing",
  operation: "approve",
  kind: "write",
  risk: "financial",
  permission: PERMISSIONS.MARKETING_ADMIN,
  description:
    "Propose SCHEDULING an APPROVED campaign: this will send real messages to its frozen recipients at the given time. scheduledAt is required, ISO with timezone (2026-12-01T09:00:00+01:00), at least 5 minutes ahead. There is no send-now. Refused unless a recipient allowlist is active or this is production. Owner/admin only. Needs the campaign name and eligible count typed to confirm.",
  input: z.object({ campaignId: objectIdSchema, scheduledAt: instant }).strict(),
  async prepare(ctx, args) {
    requireSender(ctx);
    const at = parseSendTime(args.scheduledAt);
    assertMaySchedule();
    const c = await getCampaign(ctx, args.campaignId);
    if (c.status !== "approved") throw new AppError("INVALID_TRANSITION", `${c.name} is ${c.status}. Only approved campaigns can be scheduled.`);
    if (!c.snapshot || c.snapshot.eligibleCount === 0) throw new AppError("VALIDATION_ERROR", "This campaign has no eligible recipients.");
    if (!getConfiguredProviders()[c.channel]) throw new AppError("PROVIDER_NOT_CONFIGURED", `${c.channel} sending is not set up.`);
    const msg = renderPreview(c.channel, c);
    const e = sendEnvironment();
    const eligible = c.snapshot.eligibleCount;
    return {
      context: { version: c.version, eligible, at: at.toISOString(), name: c.name },
      summary: `SEND "${c.name}" on ${c.channel} to ${eligible} recipient${eligible === 1 ? "" : "s"} at ${tunisTime(at)}. Real messages will be delivered.`,
      details: [
        { label: "Campaign", after: c.name },
        { label: "Channel", after: c.channel },
        { label: "Audience", after: c.snapshot.audienceName },
        { label: "Eligible recipients", after: String(eligible) },
        { label: "Suppressed", after: `${c.snapshot.suppressedCount} (${exclusionText(c.snapshot.exclusions)})` },
        ...(c.channel === "email" ? [{ label: "Subject", after: c.subject }] : []),
        { label: "Message (full, example recipient)", after: clip(msg.text, 900) },
        { label: "Send time", after: `${at.toISOString()} · ${tunisTime(at)}` },
        { label: "Recipient allowlist", after: e.allowlistActive ? `ACTIVE (${e.allowlistSize} entries): only listed recipients receive it` : "off (production)" },
      ],
      typedPhrase: typedFor(c.name, eligible),
    };
  },
  async run(ctx, args, _e, context) {
    requireSender(ctx);
    const at = parseSendTime(args.scheduledAt, new Date(Date.now() - 4 * 60_000)); // still in the future after the confirmation delay
    assertMaySchedule();
    const c = await getCampaign(ctx, args.campaignId);
    same({ version: context.version, status: "approved", eligible: context.eligible, at: context.at }, { version: c.version, status: c.status, eligible: c.snapshot?.eligibleCount, at: at.toISOString() }, `The campaign ${String(context.name)}`);
    if (at.getTime() < Date.now() + 60_000) throw new AppError("CONFLICT", "The planned send time is too close or has passed. Ask again with a new time and review a fresh preview.");
    await scheduleCampaign(ctx, args.campaignId, at.toISOString(), c.version);
    return { summary: `Scheduled ${String(context.name)} for ${tunisTime(at)} to ${String(context.eligible)} recipients.` };
  },
});

export const cancelCampaignTool = defineTool({
  name: "marketing_cancel_campaign",
  module: "marketing",
  operation: "approve",
  kind: "write",
  risk: "destructive",
  permission: PERMISSIONS.MARKETING_ADMIN,
  description: "Propose CANCELLING a campaign that is not yet sending (draft, pending, approved or scheduled). A cancelled campaign cannot be revived. Owner/admin only. Needs the campaign name typed to confirm.",
  input: z.object({ campaignId: objectIdSchema }).strict(),
  async prepare(ctx, args) {
    requireSender(ctx);
    const c = await getCampaign(ctx, args.campaignId);
    if (!isCampaignCancellable(c.status)) throw new AppError("INVALID_TRANSITION", `${c.name} is ${c.status} and can no longer be cancelled.`);
    return {
      context: { version: c.version, status: c.status, name: c.name },
      summary: `Cancel "${c.name}" (${c.status}). ${c.status === "scheduled" ? "Its queued send is removed. " : ""}This cannot be undone.`,
      details: [{ label: "Campaign", after: `${c.name} · ${c.channel}` }, { label: "Status", before: c.status, after: "cancelled" }, ...(c.scheduledAt ? [{ label: "Was scheduled", after: c.scheduledAt }] : [])],
      typedPhrase: c.name,
    };
  },
  async run(ctx, args, _e, context) {
    requireSender(ctx);
    const c = await getCampaign(ctx, args.campaignId);
    same({ version: context.version, status: context.status }, { version: c.version, status: c.status }, `The campaign ${String(context.name)}`);
    await cancelCampaign(ctx, args.campaignId, c.version);
    return { summary: `Cancelled ${String(context.name)}.` };
  },
});

export const MARKETING_TOOLS = [
  listCampaignsTool,
  getCampaignTool,
  listDeliveriesTool,
  campaignReportTool,
  listAudiencesTool,
  previewAudienceTool,
  listContactsTool,
  getContactTool,
  listTemplatesTool,
  listTagsTool,
  dashboardTool,
  integrationStatusTool,
  listSocialPostsTool,
  listSocialAccountsTool,
  createCampaignTool,
  updateCampaignTool,
  submitCampaignTool,
  createTemplateTool,
  updateTemplateTool,
  createAudienceTool,
  updateAudienceTool,
  createTagTool,
  updateTagTool,
  assignTagTool,
  removeTagTool,
  createContactTool,
  updateContactTool,
  createSocialPostTool,
  updateSocialPostTool,
  approveCampaignTool,
  scheduleCampaignTool,
  cancelCampaignTool,
];
