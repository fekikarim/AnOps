import "server-only";
import { callTool, field, form, nonEmpty, proposeTool } from "@/server/ai/commands/helpers";
import { ARGS, need, noText, pickCommand, requireCell, searchText } from "@/server/ai/commands/shared";
import type { CommandArgs, CommandDefinition, CommandEnv, DraftCandidate, DraftCurrent } from "@/server/ai/commands/types";
import { withAssist } from "@/server/ai/draft/assist";
import { contactView, mkScope, requireSender } from "@/server/ai/marketing/access";
import { ruleFromSimple, simpleFromRule, type SimpleAudience } from "@/server/ai/marketing/audience-rule";
import type { AiFormField } from "@/server/db/documents";
import { CONTACT_SOURCES, LIFECYCLE_STAGES, MARKETING_CHANNELS } from "@/features/marketing/types/constants";
import { DEFAULT_EMAIL_DESIGN, EMAIL_DESIGNS } from "@/features/marketing/utils/email-design";
import { audienceOptions, getAudience, listAudiences } from "@/server/marketing/audience.service";
import { getCampaign, listCampaigns } from "@/server/marketing/campaign.service";
import { getContact, listContacts } from "@/server/marketing/contact.service";
import { getSocialPost, listSocialPosts } from "@/server/marketing/social/post.service";
import { connectedAccountOptions } from "@/server/marketing/social/accounts.service";
import { getTemplate, listTemplates, templateOptions } from "@/server/marketing/template.service";
import { listTags } from "@/server/marketing/tag.service";
import { PERMISSIONS } from "@/server/security/permissions";
import { AppError } from "@/shared/lib/errors";

/**
 * Marketing commands. Reads reuse the read tools; drafts build a form (manual or AI-drafted from the SAME field builders)
 * and hand the values to the write tool. Approving, scheduling and cancelling are pickers with a typed confirmation and
 * no AI draft. Forms never carry a contact's email or phone (edit forms leave them empty, "keep" by default), consent, a
 * credential or a token.
 */
const MODULE = "marketing" as const;
type Values = Record<string, string | boolean> | null;
const v = (cur: Values, key: string, fallback: string | boolean): string | boolean => (cur && cur[key] !== undefined ? cur[key] : fallback);
const norm = (s: string) => s.trim().toLowerCase();
const has = (ref: string, ...hay: (string | undefined)[]) => {
  const t = norm(ref);
  return t !== "" && hay.some((h) => norm(h ?? "").includes(t));
};
const page = (a: CommandArgs) => ({ page: Number(a.page ?? 1) });
const opts = (list: readonly string[], blank?: string) => [...(blank !== undefined ? [{ value: "", label: blank }] : []), ...list.map((x) => ({ value: x, label: x.replace(/_/g, " ") }))];

const COPY_GUIDANCE = "Message copy: when the person describes the message instead of giving its exact words, WRITE the subject (email only) and the message text yourself, short (under 120 words), in the tone and language of the request, with basis assumed. Greet with {{first_name}}. Never invent prices, discounts, dates or links the request does not state, and do not add an unsubscribe link (it is added automatically).";

const read = (name: string, description: string, tool: string, pick: (a: CommandArgs) => Record<string, unknown>, hidden = false): CommandDefinition => ({
  name,
  description,
  example: `/${name}`,
  module: MODULE,
  operation: "view",
  permission: PERMISSIONS.MARKETING_READ,
  hidden,
  args: ARGS,
  fromText: searchText,
  async start(env, args) {
    const r = await callTool(env, tool, pick(args));
    return r.parts?.length ? { parts: r.parts } : { parts: [], text: r.summary };
  },
});

const STATUSES = ["draft", "pending_approval", "approved", "scheduled", "processing", "completed", "cancelled", "failed"];
const campaigns = read("campaigns", "List campaigns (try /campaigns scheduled).", "marketing_list_campaigns", (a) => ({ ...(STATUSES.includes(String(a.status ?? a.q ?? "").toLowerCase().replace(" ", "_")) ? { status: String(a.status ?? a.q).toLowerCase().replace(" ", "_") } : { q: String(a.q ?? "") }), ...page(a) }));
const campaign = read("campaign", "Show one campaign.", "marketing_get_campaign", (a) => ({ campaignId: need(a, "campaignId") }), true);
const audiences = read("audiences", "List audiences.", "marketing_list_audiences", (a) => ({ q: String(a.q ?? ""), ...page(a) }));
const contacts = read("contacts", "Search contacts (addresses masked).", "marketing_list_contacts", (a) => ({ q: String(a.q ?? ""), ...page(a) }));
const contact = read("contact", "Show one contact (masked).", "marketing_get_contact", (a) => ({ contactId: need(a, "contactId") }), true);
const templates = read("templates", "List message templates.", "marketing_list_templates", (a) => ({ q: String(a.q ?? ""), ...page(a) }));
const tags = read("tags", "List contact tags.", "marketing_list_tags", () => ({}));
const mkoverview = read("mkoverview", "Marketing overview counts.", "marketing_dashboard", () => ({}));
const sendingsetup = read("sendingsetup", "Is sending set up? (yes/no only)", "marketing_integration_status", () => ({}));
const socialposts = read("socialposts", "Social post drafts and status.", "marketing_list_social_posts", (a) => ({ ...page(a) }));

const audience = read("audience", "How many contacts an audience matches and could receive a message.", "marketing_preview_audience", (a) => ({ audienceId: need(a, "audienceId"), channel: MARKETING_CHANNELS.includes(String(a.channel) as never) ? String(a.channel) : "email" }), true);

const campaignreport = read("campaignreport", "Results of a campaign.", "marketing_campaign_report", (a) => ({ campaignId: need(a, "campaignId") }), true);
campaignreport.start = async (env, a) => {
  const id = need(a, "campaignId");
  const report = await callTool(env, "marketing_campaign_report", { campaignId: id });
  const deliveries = await callTool(env, "marketing_list_deliveries", { campaignId: id, ...page(a) });
  return { parts: [...(report.parts ?? []), ...(deliveries.parts ?? [])] };
};

// ─── Option lists ─────────────────────────────────────────────────────────────

async function audienceChoices(env: CommandEnv) {
  return [{ value: "", label: "Choose an audience" }, ...(await audienceOptions(env.ctx)).filter((a) => a.isActive).map((a) => ({ value: a.id, label: a.name }))];
}

// ─── Campaigns ────────────────────────────────────────────────────────────────

async function campaignFields(env: CommandEnv, cur: Values, mode: "create" | "edit"): Promise<AiFormField[]> {
  const channel = String(v(cur, "channel", "email"));
  const templatesFor = mode === "create" && channel ? (await templateOptions(env.ctx, channel as (typeof MARKETING_CHANNELS)[number]).catch(() => [])) : [];
  return [
    field({ name: "name", label: "Campaign name", kind: "text", required: true, value: v(cur, "name", "") }),
    ...(mode === "create" ? [field({ name: "channel", label: "Channel", kind: "select" as const, required: true, value: channel, options: opts(MARKETING_CHANNELS) })] : []),
    field({ name: "audienceId", label: "Audience", kind: "select", required: true, value: v(cur, "audienceId", ""), options: await audienceChoices(env) }),
    ...(mode === "create" && templatesFor.length ? [field({ name: "templateId", label: "Template (optional)", kind: "select" as const, value: v(cur, "templateId", ""), options: [{ value: "", label: "No template" }, ...templatesFor.map((t) => ({ value: t.id, label: t.name }))] })] : []),
    field({ name: "subject", label: "Email subject", kind: "text", value: v(cur, "subject", ""), hint: "Email only." }),
    field({ name: "body", label: "Message", kind: "textarea", required: true, value: v(cur, "body", ""), hint: "Variables: {{first_name}} {{last_name}} {{company_name}} {{unsubscribe_url}}. Every email and SMS carries an opt-out." }),
    ...(mode === "create" ? [field({ name: "design", label: "Email design", kind: "select" as const, value: v(cur, "design", DEFAULT_EMAIL_DESIGN), options: opts(EMAIL_DESIGNS) })] : []),
  ];
}
async function loadCampaign(env: CommandEnv, id: string): Promise<DraftCurrent> {
  const c = await getCampaign(env.ctx, id);
  if (c.status !== "draft") throw new AppError("INVALID_TRANSITION", `${c.name} is ${c.status}. Only drafts can be edited.`);
  return { id: c.id, label: c.name, values: { name: c.name, audienceId: c.audienceId, subject: c.subject, body: c.body, channel: c.channel } };
}
async function searchDraftCampaigns(env: CommandEnv, text: string): Promise<DraftCandidate[]> {
  return (await listCampaigns(env.ctx, { q: text.slice(0, 80), status: "draft", channel: "all", page: 1 })).items.map((c) => ({ id: c.id, label: c.name, detail: `${c.channel} · ${c.audienceName}` }));
}

const newcampaignBase: CommandDefinition = {
  name: "newcampaign",
  description: "Create a draft campaign. Nothing is sent.",
  example: "/newcampaign",
  module: MODULE,
  operation: "create",
  permission: PERMISSIONS.MARKETING_CAMPAIGN_MANAGE,
  args: ARGS,
  fromText: noText,
  async start(env, args) {
    requireCell(env, MODULE, "view");
    return { parts: [form({ title: "New campaign", description: "A draft. It must be submitted, approved and scheduled by an owner or admin before anything is sent.", command: "newcampaign", context: {}, submitLabel: "Review", fields: await campaignFields(env, args.audienceId ? { audienceId: String(args.audienceId) } : null, "create") })] };
  },
  submit: (env, _a, values) => proposeTool(env, "marketing_create_campaign", nonEmpty(values)),
};
const newcampaign = withAssist(newcampaignBase, {
  kind: "create",
  noun: "campaign",
  guidance: COPY_GUIDANCE,
  examples: ["An email campaign for the Loyal Customers audience announcing our winter sale, friendly tone"],
  tool: "marketing_create_campaign",
  criticalFields: ["audienceId", "channel"],
  fields: (env, cur) => campaignFields(env, cur?.values ?? null, "create"),
});

const editcampaignBase = pickCommand({
  name: "editcampaign",
  description: "Edit a draft campaign.",
  example: "/editcampaign winter",
  module: MODULE,
  operation: "edit",
  permission: PERMISSIONS.MARKETING_CAMPAIGN_MANAGE,
  title: "Choose a draft campaign to edit",
  key: "campaignId",
  list: async (env, a) => (await callTool(env, "marketing_list_campaigns", { status: "draft", q: String(a.q ?? ""), ...page(a) })).parts ?? [],
  async select(env, a) {
    const c = await loadCampaign(env, need(a, "campaignId"));
    return { parts: [form({ title: `Edit ${c.label}`, command: "editcampaign", context: { campaignId: c.id }, submitLabel: "Review changes", fields: await campaignFields(env, c.values, "edit") })] };
  },
});
editcampaignBase.submit = (env, a, values) => proposeTool(env, "marketing_update_campaign", { ...nonEmpty(values, ["subject"]), campaignId: need(a, "campaignId") });
const editcampaign = withAssist(editcampaignBase, {
  kind: "edit",
  noun: "draft campaign",
  guidance: COPY_GUIDANCE,
  examples: ["Make the winter sale email shorter and add the 20% discount"],
  tool: "marketing_update_campaign",
  criticalFields: ["audienceId"],
  target: { label: "draft campaign", key: "campaignId", search: searchDraftCampaigns, load: loadCampaign },
  fields: (env, cur) => campaignFields(env, cur?.values ?? null, "edit"),
  context: (cur) => ({ campaignId: cur.id }),
});

const campaignPicker = (name: string, description: string, status: string, operation: CommandDefinition["operation"], permission: CommandDefinition["permission"], tool: string, guard: (env: CommandEnv) => void | Promise<void>) => {
  const def = pickCommand({
    name,
    description,
    example: `/${name}`,
    module: MODULE,
    operation,
    permission,
    title: `Choose a campaign: ${name}`,
    key: "campaignId",
    list: async (env, a) => (await callTool(env, "marketing_list_campaigns", { status, q: String(a.q ?? ""), ...page(a) })).parts ?? [],
    select: async (env, a) => {
      await guard(env);
      return proposeTool(env, tool, { campaignId: need(a, "campaignId") });
    },
  });
  return def;
};
const noGuard = () => undefined;
const senderGuard = (env: CommandEnv) => void requireSender(env.ctx);

const submitcampaign = campaignPicker("submitcampaign", "Submit a draft campaign for approval. Nothing is sent.", "draft", "edit", PERMISSIONS.MARKETING_CAMPAIGN_MANAGE, "marketing_submit_campaign", noGuard);
const approvecampaign = campaignPicker("approvecampaign", "Approve a submitted campaign (typed confirmation, owner/admin).", "pending_approval", "approve", PERMISSIONS.MARKETING_ADMIN, "marketing_approve_campaign", senderGuard);
const cancelcampaign = pickCommand({
  name: "cancelcampaign",
  description: "Cancel a campaign that is not sending (typed confirmation, owner/admin).",
  example: "/cancelcampaign",
  module: MODULE,
  operation: "approve",
  permission: PERMISSIONS.MARKETING_ADMIN,
  title: "Choose a campaign to cancel",
  key: "campaignId",
  list: async (env, a) => (await callTool(env, "marketing_list_campaigns", { q: String(a.q ?? ""), ...page(a) })).parts ?? [],
  select: async (env, a) => {
    requireSender(env.ctx);
    return proposeTool(env, "marketing_cancel_campaign", { campaignId: need(a, "campaignId") });
  },
});

/** Tunis has no daylight saving: its offset is always +01:00. The person types local time; the tool gets an explicit instant. */
export function tunisLocalToIso(local: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/.exec(local.trim());
  if (!m) throw new AppError("VALIDATION_ERROR", "Enter the exact date and time like 2026-12-01 09:00 (Tunis time). Leaving it empty is not allowed: nothing is ever sent immediately.");
  return `${m[1]}T${m[2]}:00+01:00`;
}

const schedulecampaign = campaignPicker("schedulecampaign", "Schedule an approved campaign to send at an exact time (typed confirmation, owner/admin).", "approved", "approve", PERMISSIONS.MARKETING_ADMIN, "marketing_schedule_campaign", senderGuard);
schedulecampaign.select = async (env, a) => {
  requireSender(env.ctx);
  const c = await getCampaign(env.ctx, need(a, "campaignId"));
  if (c.status !== "approved") throw new AppError("INVALID_TRANSITION", `${c.name} is ${c.status}. Only approved campaigns can be scheduled.`);
  return {
    parts: [
      form({
        title: `Schedule ${c.name}`,
        description: "This sends real messages. The next step shows the recipients, the message and the time before you confirm. There is no send-now.",
        command: "schedulecampaign",
        context: { campaignId: c.id },
        submitLabel: "Review",
        fields: [field({ name: "scheduledAt", label: "Send at (Tunis time)", kind: "text", required: true, value: "", placeholder: "2026-12-01 09:00", hint: "Required. At least 5 minutes from now." })],
      }),
    ],
  };
};
schedulecampaign.submit = (env, a, values) => {
  requireSender(env.ctx);
  return proposeTool(env, "marketing_schedule_campaign", { campaignId: need(a, "campaignId"), scheduledAt: tunisLocalToIso(String(values.scheduledAt ?? "")) });
};
approvecampaign.submit = undefined;

// ─── Templates ────────────────────────────────────────────────────────────────

const templateFields = (cur: Values, mode: "create" | "edit"): AiFormField[] => [
  field({ name: "name", label: "Template name", kind: "text", required: true, value: v(cur, "name", "") }),
  ...(mode === "create" ? [field({ name: "channel", label: "Channel", kind: "select" as const, required: true, value: v(cur, "channel", "email"), options: opts(MARKETING_CHANNELS) })] : []),
  field({ name: "subject", label: "Email subject", kind: "text", value: v(cur, "subject", "") }),
  field({ name: "body", label: "Message", kind: "textarea", required: true, value: v(cur, "body", ""), hint: "Variables: {{first_name}} {{last_name}} {{company_name}} {{unsubscribe_url}}." }),
  ...(mode === "create" ? [field({ name: "design", label: "Email design", kind: "select" as const, value: v(cur, "design", DEFAULT_EMAIL_DESIGN), options: opts(EMAIL_DESIGNS) })] : []),
  ...(mode === "edit" ? [field({ name: "isActive", label: "Active", kind: "checkbox" as const, value: v(cur, "isActive", true) })] : []),
];
async function loadTemplate(env: CommandEnv, id: string): Promise<DraftCurrent> {
  const t = await getTemplate(env.ctx, id);
  return { id: t.id, label: t.name, values: { name: t.name, subject: t.subject, body: t.body, isActive: t.isActive, channel: t.channel } };
}
async function searchTemplates(env: CommandEnv, text: string): Promise<DraftCandidate[]> {
  return (await listTemplates(env.ctx, { q: text.slice(0, 80), channel: "all", page: 1 })).items.map((t) => ({ id: t.id, label: t.name, detail: t.channel }));
}
const newtemplate = withAssist(
  {
    name: "newtemplate",
    description: "Create a message template.",
    example: "/newtemplate",
    module: MODULE,
    operation: "create",
    permission: PERMISSIONS.MARKETING_TEMPLATE_MANAGE,
    args: ARGS,
    fromText: noText,
    async start() {
      return { parts: [form({ title: "New template", command: "newtemplate", context: {}, submitLabel: "Review", fields: templateFields(null, "create") })] };
    },
    submit: (env, _a, values) => proposeTool(env, "marketing_create_template", nonEmpty(values)),
  },
  { kind: "create", noun: "template", guidance: COPY_GUIDANCE, examples: ["A friendly French SMS template reminding customers of their appointment"], tool: "marketing_create_template", criticalFields: ["channel"], fields: async () => templateFields(null, "create") }
);
const edittemplateBase = pickCommand({
  name: "edittemplate",
  description: "Edit a message template.",
  example: "/edittemplate welcome",
  module: MODULE,
  operation: "edit",
  permission: PERMISSIONS.MARKETING_TEMPLATE_MANAGE,
  title: "Choose a template to edit",
  key: "templateId",
  list: async (env, a) => (await callTool(env, "marketing_list_templates", { q: String(a.q ?? ""), ...page(a) })).parts ?? [],
  async select(env, a) {
    const c = await loadTemplate(env, need(a, "templateId"));
    return { parts: [form({ title: `Edit ${c.label}`, command: "edittemplate", context: { templateId: c.id }, submitLabel: "Review changes", fields: templateFields(c.values, "edit") })] };
  },
});
edittemplateBase.submit = (env, a, values) => proposeTool(env, "marketing_update_template", { ...nonEmpty(values, ["subject"]), templateId: need(a, "templateId") });
const edittemplate = withAssist(edittemplateBase, {
  kind: "edit",
  noun: "template",
  guidance: COPY_GUIDANCE,
  examples: ["Shorten the welcome template and mention the free shipping"],
  tool: "marketing_update_template",
  criticalFields: [],
  target: { label: "template", key: "templateId", search: searchTemplates, load: loadTemplate },
  fields: async (_e, cur) => templateFields(cur?.values ?? null, "edit"),
  context: (cur) => ({ templateId: cur.id }),
});

// ─── Audiences (the common single-condition shapes; the saved rule is the existing validated structure) ─

async function audienceFormFields(env: CommandEnv, cur: Values): Promise<AiFormField[]> {
  const tagList = await listTags(env.ctx);
  return [
    field({ name: "name", label: "Audience name", kind: "text", required: true, value: v(cur, "name", "") }),
    field({ name: "description", label: "Description", kind: "text", value: v(cur, "description", "") }),
    field({ name: "match", label: "Match", kind: "select", value: v(cur, "match", "all"), options: [{ value: "all", label: "All conditions" }, { value: "any", label: "Any condition" }] }),
    field({ name: "lifecycle", label: "Lifecycle stage", kind: "select", value: v(cur, "lifecycle", ""), options: opts(LIFECYCLE_STAGES, "Any stage") }),
    field({ name: "source", label: "Source", kind: "select", value: v(cur, "source", ""), options: opts(CONTACT_SOURCES, "Any source") }),
    field({ name: "consentChannel", label: "Has marketing consent on", kind: "select", value: v(cur, "consentChannel", ""), options: opts(MARKETING_CHANNELS, "No consent condition") }),
    field({ name: "tag", label: "Tag", kind: "select", value: v(cur, "tag", ""), options: [{ value: "", label: "No tag condition" }, ...tagList.map((t) => ({ value: t.id, label: t.name }))] }),
    field({ name: "activeOnly", label: "Active contacts only", kind: "checkbox", value: v(cur, "activeOnly", false) }),
    field({ name: "createdAfter", label: "Created after", kind: "text", value: v(cur, "createdAfter", ""), placeholder: "YYYY-MM-DD" }),
  ];
}
const toSimple = (values: Record<string, string | number | boolean>): SimpleAudience => ({
  match: values.match === "any" ? "any" : "all",
  lifecycle: String(values.lifecycle ?? ""),
  source: String(values.source ?? ""),
  consentChannel: String(values.consentChannel ?? ""),
  tag: String(values.tag ?? ""),
  activeOnly: values.activeOnly === true || values.activeOnly === "true",
  createdAfter: String(values.createdAfter ?? ""),
});
async function loadAudience(env: CommandEnv, id: string): Promise<DraftCurrent> {
  const a = await getAudience(env.ctx, id);
  const simple = a.rule ? simpleFromRule(a.rule) : null;
  if (!simple) throw new AppError("VALIDATION_ERROR", `${a.name} has a rule that is too detailed for AI editing. Edit it in Marketing.`);
  return { id: a.id, label: a.name, values: { name: a.name, description: a.description, ...simple } };
}
async function searchAudiences(env: CommandEnv, text: string): Promise<DraftCandidate[]> {
  return (await listAudiences(env.ctx, { q: text.slice(0, 80), active: "all", page: 1 })).items.map((a) => ({ id: a.id, label: a.name, detail: a.isActive ? "active" : "inactive" }));
}
const newaudience = withAssist(
  {
    name: "newaudience",
    description: "Create an audience from simple conditions.",
    example: "/newaudience",
    module: MODULE,
    operation: "create",
    permission: PERMISSIONS.MARKETING_AUDIENCE_MANAGE,
    args: ARGS,
    fromText: noText,
    async start(env) {
      return { parts: [form({ title: "New audience", description: "Add at least one condition. Consent and suppression are applied again at every send.", command: "newaudience", context: {}, submitLabel: "Review", fields: await audienceFormFields(env, null) })] };
    },
    submit: (env, _a, values) => proposeTool(env, "marketing_create_audience", { name: String(values.name ?? ""), description: String(values.description ?? ""), rule: ruleFromSimple(toSimple(values)) }),
  },
  {
    kind: "create",
    noun: "audience",
    examples: ["Customers who agreed to email marketing and were added after 2026-01-01"],
    tool: "marketing_create_audience",
    criticalFields: [],
    fields: (env) => audienceFormFields(env, null),
    fromToolArgs: (a) => {
      const simple = a.rule ? simpleFromRule(a.rule as Parameters<typeof simpleFromRule>[0]) : null;
      if (a.rule && !simple) throw new AppError("VALIDATION_ERROR", "That audience is too detailed for this form. Describe a simpler audience, or build it in Marketing.");
      return { values: { name: a.name, description: a.description, ...(simple ?? {}) } };
    },
  }
);
const editaudienceBase = pickCommand({
  name: "editaudience",
  description: "Edit an audience.",
  example: "/editaudience loyal",
  module: MODULE,
  operation: "edit",
  permission: PERMISSIONS.MARKETING_AUDIENCE_MANAGE,
  title: "Choose an audience to edit",
  key: "audienceId",
  list: async (env, a) => (await callTool(env, "marketing_list_audiences", { q: String(a.q ?? ""), ...page(a) })).parts ?? [],
  async select(env, a) {
    const c = await loadAudience(env, need(a, "audienceId"));
    return { parts: [form({ title: `Edit ${c.label}`, command: "editaudience", context: { audienceId: c.id }, submitLabel: "Review changes", fields: await audienceFormFields(env, c.values) })] };
  },
});
editaudienceBase.submit = (env, a, values) => proposeTool(env, "marketing_update_audience", { audienceId: need(a, "audienceId"), name: String(values.name ?? ""), description: String(values.description ?? ""), rule: ruleFromSimple(toSimple(values)) });
const editaudience = withAssist(editaudienceBase, {
  kind: "edit",
  noun: "audience",
  examples: ["Only include active customers in the Loyal Customers audience"],
  tool: "marketing_update_audience",
  criticalFields: [],
  target: { label: "audience", key: "audienceId", search: searchAudiences, load: loadAudience },
  fields: (env, cur) => audienceFormFields(env, cur?.values ?? null),
  context: (cur) => ({ audienceId: cur.id }),
});

// ─── Tags ─────────────────────────────────────────────────────────────────────

const tagFields = (cur: Values): AiFormField[] => [
  field({ name: "name", label: "Name", kind: "text", required: true, value: v(cur, "name", "") }),
  field({ name: "color", label: "Colour", kind: "text", value: v(cur, "color", "#1f7a5c"), placeholder: "#1f7a5c" }),
];
const newtag = withAssist(
  {
    name: "newtag",
    description: "Create a contact tag.",
    example: "/newtag",
    module: MODULE,
    operation: "create",
    permission: PERMISSIONS.MARKETING_TAG_MANAGE,
    args: ARGS,
    fromText: noText,
    async start() {
      return { parts: [form({ title: "New tag", command: "newtag", context: {}, submitLabel: "Review", fields: tagFields(null) })] };
    },
    submit: (env, _a, values) => proposeTool(env, "marketing_create_tag", nonEmpty(values)),
  },
  { kind: "create", noun: "tag", examples: ["A green tag called VIP"], tool: "marketing_create_tag", criticalFields: [], fields: async () => tagFields(null) }
);
async function loadTag(env: CommandEnv, id: string): Promise<DraftCurrent> {
  const t = (await listTags(env.ctx)).find((x) => x.id === id);
  if (!t) throw new AppError("NOT_FOUND", "Tag not found.");
  return { id: t.id, label: t.name, values: { name: t.name, color: t.color } };
}
const edittagBase = pickCommand({
  name: "edittag",
  description: "Rename or recolour a tag.",
  example: "/edittag vip",
  module: MODULE,
  operation: "edit",
  permission: PERMISSIONS.MARKETING_TAG_MANAGE,
  title: "Choose a tag to edit",
  key: "tagId",
  list: async (env) => (await callTool(env, "marketing_list_tags", {})).parts ?? [],
  async select(env, a) {
    const c = await loadTag(env, need(a, "tagId"));
    return { parts: [form({ title: `Edit ${c.label}`, command: "edittag", context: { tagId: c.id }, submitLabel: "Review changes", fields: tagFields(c.values) })] };
  },
});
edittagBase.submit = (env, a, values) => proposeTool(env, "marketing_update_tag", { ...nonEmpty(values), tagId: need(a, "tagId") });
const edittag = withAssist(edittagBase, {
  kind: "edit",
  noun: "tag",
  examples: ["Rename the VIP tag to Gold customers"],
  tool: "marketing_update_tag",
  criticalFields: [],
  target: { label: "tag", key: "tagId", search: async (env, text) => (await listTags(env.ctx)).filter((t) => text.trim() === "" || has(text, t.name)).slice(0, 8).map((t) => ({ id: t.id, label: t.name, detail: `${t.contactCount} contacts` })), load: loadTag },
  fields: async (_e, cur) => tagFields(cur?.values ?? null),
  context: (cur) => ({ tagId: cur.id }),
});

// ─── Contacts (no consent, ever; destinations masked everywhere except what the person types) ─

const contactFormFields = (cur: Values, mode: "create" | "edit", masked?: { email: string; phone: string }): AiFormField[] => [
  field({ name: "firstName", label: "First name", kind: "text", required: true, value: v(cur, "firstName", "") }),
  field({ name: "lastName", label: "Last name", kind: "text", value: v(cur, "lastName", "") }),
  field({ name: "email", label: "Email", kind: "text", value: v(cur, "email", ""), hint: mode === "edit" ? `Currently ${masked?.email || "none"}. Leave empty to keep it.` : "Must come from the person." }),
  field({ name: "phone", label: "Phone", kind: "text", value: v(cur, "phone", ""), hint: mode === "edit" ? `Currently ${masked?.phone || "none"}. Leave empty to keep it.` : "With country code, for example +216 20 123 456." }),
  field({ name: "source", label: "Source", kind: "select", value: v(cur, "source", "manual"), options: opts(CONTACT_SOURCES) }),
  field({ name: "lifecycleStage", label: "Lifecycle stage", kind: "select", value: v(cur, "lifecycleStage", "lead"), options: opts(LIFECYCLE_STAGES) }),
  ...(mode === "edit" ? [field({ name: "isActive", label: "Active", kind: "checkbox" as const, value: v(cur, "isActive", true) })] : []),
];
const newcontact = withAssist(
  {
    name: "newcontact",
    description: "Add a contact (no marketing consent is recorded).",
    example: "/newcontact",
    module: MODULE,
    operation: "create",
    permission: PERMISSIONS.MARKETING_CONTACT_MANAGE,
    args: ARGS,
    fromText: noText,
    async start() {
      return { parts: [form({ title: "New contact", description: "No marketing consent is recorded here. Consent is recorded in Marketing.", command: "newcontact", context: {}, submitLabel: "Review", fields: contactFormFields(null, "create") })] };
    },
    submit: (env, _a, values) => proposeTool(env, "marketing_create_contact", nonEmpty(values)),
  },
  { kind: "create", noun: "contact", examples: ["Add Sarra Ben Ali, sarra@example.tn, a lead from our website"], tool: "marketing_create_contact", criticalFields: ["email", "phone"], fields: async () => contactFormFields(null, "create") }
);
async function loadContact(env: CommandEnv, id: string): Promise<DraftCurrent> {
  const c = await getContact(env.ctx, id);
  const m = contactView(c, mkScope(env.ctx), false);
  // The real email and phone never become form values (and so never reach the model). Masked text is only a hint.
  return { id: c.id, label: c.fullName, values: { firstName: c.firstName, lastName: c.lastName, email: "", phone: "", source: c.source, lifecycleStage: c.lifecycleStage, isActive: c.isActive, _maskedEmail: m.email, _maskedPhone: m.phone } };
}
async function searchContacts(env: CommandEnv, text: string): Promise<DraftCandidate[]> {
  const scope = mkScope(env.ctx);
  return (await listContacts(env.ctx, { q: text.slice(0, 80), lifecycle: "all", source: "all", active: "all", tagMode: "any", sort: "name", dir: "asc", page: 1 })).items.slice(0, 8).map((c) => ({ id: c.id, label: c.fullName, detail: contactView(c, scope, false).email || "no email" }));
}
const editcontactBase = pickCommand({
  name: "editcontact",
  description: "Edit a contact's details (consent never changes here).",
  example: "/editcontact sarra",
  module: MODULE,
  operation: "edit",
  permission: PERMISSIONS.MARKETING_CONTACT_MANAGE,
  title: "Choose a contact to edit",
  key: "contactId",
  list: async (env, a) => (await callTool(env, "marketing_list_contacts", { q: String(a.q ?? ""), ...page(a) })).parts ?? [],
  async select(env, a) {
    const c = await loadContact(env, need(a, "contactId"));
    const { _maskedEmail, _maskedPhone, ...values } = c.values as Record<string, string | boolean>;
    return { parts: [form({ title: `Edit ${c.label}`, description: "Consent is not changed here.", command: "editcontact", context: { contactId: c.id }, submitLabel: "Review changes", fields: contactFormFields(values, "edit", { email: String(_maskedEmail), phone: String(_maskedPhone) }) })] };
  },
});
editcontactBase.submit = (env, a, values) => proposeTool(env, "marketing_update_contact", { ...nonEmpty(values, ["lastName"]), contactId: need(a, "contactId") });
const editcontact = withAssist(editcontactBase, {
  kind: "edit",
  noun: "contact",
  examples: ["Move Sarra Ben Ali to the customer stage"],
  tool: "marketing_update_contact",
  criticalFields: ["email", "phone"],
  target: { label: "contact", key: "contactId", search: searchContacts, load: async (env, id) => { const c = await loadContact(env, id); const { _maskedEmail, _maskedPhone, ...values } = c.values as Record<string, string | boolean>; return { ...c, values }; } },
  fields: async (_e, cur) => contactFormFields(cur?.values ?? null, "edit"),
  context: (cur) => ({ contactId: cur.id }),
});

// ─── Social post drafts (never published through AI) ──────────────────────────

async function socialFields(env: CommandEnv, cur: Values): Promise<AiFormField[]> {
  return [
    field({ name: "socialAccountId", label: "Account", kind: "select", required: true, value: v(cur, "socialAccountId", ""), options: [{ value: "", label: "Choose an account" }, ...(await connectedAccountOptions(env.ctx)).map((a) => ({ value: a.id, label: a.name }))] }),
    field({ name: "content", label: "Post", kind: "textarea", required: true, value: v(cur, "content", "") }),
  ];
}
const newsocialpost = withAssist(
  {
    name: "newsocialpost",
    description: "Draft a social post. Publishing stays in Marketing.",
    example: "/newsocialpost",
    module: MODULE,
    operation: "create",
    permission: PERMISSIONS.MARKETING_SOCIAL_MANAGE,
    args: ARGS,
    fromText: noText,
    async start(env) {
      return { parts: [form({ title: "New social post draft", description: "Saved as a draft. It is not published.", command: "newsocialpost", context: {}, submitLabel: "Review", fields: await socialFields(env, null) })] };
    },
    submit: (env, _a, values) => proposeTool(env, "marketing_create_social_post", nonEmpty(values)),
  },
  { kind: "create", noun: "social post", guidance: COPY_GUIDANCE, examples: ["A short Facebook post announcing our new opening hours"], tool: "marketing_create_social_post", criticalFields: ["socialAccountId"], fields: (env) => socialFields(env, null) }
);
async function loadPost(env: CommandEnv, id: string): Promise<DraftCurrent> {
  const p = await getSocialPost(env.ctx, id);
  if (p.status !== "draft") throw new AppError("INVALID_TRANSITION", `That post is ${p.status}. Only drafts can be edited.`);
  return { id: p.id, label: p.accountName, values: { socialAccountId: p.socialAccountId, content: p.content } };
}
const editsocialpostBase = pickCommand({
  name: "editsocialpost",
  description: "Edit a social post draft.",
  example: "/editsocialpost",
  module: MODULE,
  operation: "edit",
  permission: PERMISSIONS.MARKETING_SOCIAL_MANAGE,
  title: "Choose a post draft to edit",
  key: "postId",
  list: async (env) => (await callTool(env, "marketing_list_social_posts", { status: "draft" })).parts ?? [],
  async select(env, a) {
    const c = await loadPost(env, need(a, "postId"));
    return { parts: [form({ title: "Edit post draft", command: "editsocialpost", context: { postId: c.id }, submitLabel: "Review changes", fields: await socialFields(env, c.values) })] };
  },
});
editsocialpostBase.submit = (env, a, values) => proposeTool(env, "marketing_update_social_post", { ...nonEmpty(values), postId: need(a, "postId") });
const editsocialpost = withAssist(editsocialpostBase, {
  kind: "edit",
  noun: "social post draft",
  examples: ["Make the opening-hours post friendlier"],
  tool: "marketing_update_social_post",
  criticalFields: [],
  target: { label: "social post draft", key: "postId", search: async (env, text) => (await listSocialPosts(env.ctx, { status: "draft", page: 1 })).items.filter((p) => text.trim() === "" || has(text, p.content)).slice(0, 8).map((p) => ({ id: p.id, label: p.content.slice(0, 50), detail: p.accountName })), load: loadPost },
  fields: (env, cur) => socialFields(env, cur?.values ?? null),
  context: (cur) => ({ postId: cur.id }),
});

export const MARKETING_COMMANDS: CommandDefinition[] = [
  mkoverview,
  campaigns,
  campaign,
  campaignreport,
  newcampaign,
  editcampaign,
  submitcampaign,
  approvecampaign,
  schedulecampaign,
  cancelcampaign,
  audiences,
  audience,
  newaudience,
  editaudience,
  contacts,
  contact,
  newcontact,
  editcontact,
  templates,
  newtemplate,
  edittemplate,
  tags,
  newtag,
  edittag,
  socialposts,
  newsocialpost,
  editsocialpost,
  sendingsetup,
];
