import { z } from "zod";
import { objectIdSchema, optionalText, pageSchema, requiredText } from "@/shared/lib/schema-primitives";
import { normalizeEmail, isPlausibleEmail, normalizePhone } from "@/features/marketing/utils/normalize";
import { parseStrictInstant } from "@/features/marketing/utils/datetime";
import {
  EMAIL_BODY_MAX,
  EMAIL_SUBJECT_MAX,
  SMS_BODY_MAX,
  SMS_OPT_OUT_FOOTER,
  TELEGRAM_BODY_MAX,
  TELEGRAM_VARIABLES,
  extractTemplateTokens,
  findUnknownTemplateVariables,
  TEMPLATE_VARIABLES,
} from "@/features/marketing/utils/template";
import { DEFAULT_EMAIL_DESIGN, EMAIL_DESIGNS, type EmailDesign } from "@/features/marketing/utils/email-design";
import { SOCIAL_CONTENT_LIMITS } from "@/features/marketing/utils/social-state";
import {
  AI_CHANNELS,
  AI_LANGUAGES,
  AI_TONES,
  CAMPAIGN_STATUSES,
  CONTACT_SOURCES,
  LIFECYCLE_STAGES,
  MARKETING_CHANNELS,
  SOCIAL_POST_STATUSES,
} from "@/features/marketing/types/constants";

export const MAX_TAGS_PER_BULK = 50;
export const MAX_AUDIENCE_CONDITIONS = 10;
export const MAX_RULE_TAGS = 20;

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date such as 2026-03-31")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Use a valid date");

const emailField = z
  .string()
  .trim()
  .max(254, "Maximum 254 characters")
  .refine((value) => value === "" || isPlausibleEmail(normalizeEmail(value)), "Enter a valid email address");

const phoneField = z
  .string()
  .trim()
  .max(25, "Maximum 25 characters")
  .refine((value) => normalizePhone(value) !== null, "Enter a phone number such as +216 20 123 456");

// ---------------------------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------------------------

export const contactShape = z
  .object({
    firstName: requiredText(80, "First name"),
    lastName: optionalText(80),
    email: emailField,
    phone: phoneField,
    source: z.enum(CONTACT_SOURCES),
    lifecycleStage: z.enum(LIFECYCLE_STAGES),
    isActive: z.boolean(),
  })
  .strict();

/** The consent the user wants on the contact, per channel. Stored status is compared server-side. */
export const contactConsentShape = z
  .object({
    email: z.boolean(),
    sms: z.boolean(),
  })
  .strict();

export const contactCreateSchema = contactShape
  .extend({ consent: contactConsentShape })
  .strict();

export const contactUpdateSchema = contactCreateSchema
  .extend({ expectedVersion: z.number().int().min(1) })
  .strict();

export type ContactCreateInput = z.input<typeof contactCreateSchema>;
export type ContactUpdateInput = z.input<typeof contactUpdateSchema>;

export const contactListQuerySchema = z.object({
  q: z.string().trim().max(80).catch(""),
  lifecycle: z.enum(["all", ...LIFECYCLE_STAGES]).catch("all"),
  source: z.enum(["all", ...CONTACT_SOURCES]).catch("all"),
  active: z.enum(["all", "true", "false"]).catch("all"),
  tagMode: z.enum(["any", "all"]).catch("any"),
  sort: z.enum(["name", "email", "created"]).catch("created"),
  dir: z.enum(["asc", "desc"]).catch("desc"),
  page: pageSchema.catch(1),
});

export type ContactListQuery = z.infer<typeof contactListQuerySchema>;

// ---------------------------------------------------------------------------------------------
// Tags and consent
// ---------------------------------------------------------------------------------------------

export const tagInputSchema = z
  .object({
    name: requiredText(40, "Tag name"),
    color: z
      .string()
      .trim()
      .regex(/^#[0-9a-fA-F]{6}$/, "Choose a colour such as #1f7a5c"),
  })
  .strict();

export type TagInput = z.infer<typeof tagInputSchema>;

export const bulkTagSchema = z
  .object({
    contactIds: z.array(objectIdSchema).min(1, "Select at least one contact").max(MAX_TAGS_PER_BULK),
    tagId: objectIdSchema,
  })
  .strict();

export const consentChangeSchema = z
  .object({
    channel: z.enum(MARKETING_CHANNELS),
    status: z.enum(["granted", "withdrawn"]),
    source: z.enum(["manual", "import", "form"]),
    occurredAt: z
      .string()
      .trim()
      .max(40)
      .refine((value) => {
        if (value === "") return true;
        const instant = parseStrictInstant(value);
        return instant !== null && instant.getTime() <= Date.now() + 5 * 60_000;
      }, "Enter a real date and time that is not in the future")
      .transform((value) => (value === "" ? "" : (parseStrictInstant(value)?.toISOString() ?? value))),
  })
  .strict();

export type ConsentChangeInput = z.infer<typeof consentChangeSchema>;

// ---------------------------------------------------------------------------------------------
// Audiences (typed selection rules; never raw queries or operators)
// ---------------------------------------------------------------------------------------------

const ruleCondition = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("lifecycle_stage"), values: z.array(z.enum(LIFECYCLE_STAGES)).min(1).max(4) })
    .strict(),
  z
    .object({ type: z.literal("source"), values: z.array(z.enum(CONTACT_SOURCES)).min(1).max(6) })
    .strict(),
  z.object({ type: z.literal("active"), value: z.boolean() }).strict(),
  z
    .object({
      type: z.literal("tags"),
      tagIds: z.array(objectIdSchema).min(1, "Choose at least one tag").max(MAX_RULE_TAGS),
      match: z.enum(["any", "all"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("consent"),
      channel: z.enum(MARKETING_CHANNELS),
      status: z.enum(["granted", "not_granted"]),
    })
    .strict(),
  z.object({ type: z.literal("created_after"), date: isoDate }).strict(),
]);

export const audienceRuleSchema = z
  .object({
    match: z.enum(["all", "any"]),
    conditions: z
      .array(ruleCondition)
      .min(1, "Add at least one condition")
      .max(MAX_AUDIENCE_CONDITIONS, `At most ${MAX_AUDIENCE_CONDITIONS} conditions`),
  })
  .strict();

export type AudienceRuleInput = z.infer<typeof audienceRuleSchema>;

const audienceShape = z
  .object({
    name: requiredText(120, "Audience name"),
    description: optionalText(500),
    rule: audienceRuleSchema,
    isActive: z.boolean(),
  })
  .strict();

export const audienceInputSchema = audienceShape;
export const audienceUpdateSchema = audienceShape.extend({ expectedVersion: z.number().int().min(1) }).strict();

export type AudienceInput = z.infer<typeof audienceInputSchema>;

export const audiencePreviewSchema = z
  .object({ rule: audienceRuleSchema, channel: z.enum(MARKETING_CHANNELS) })
  .strict();

export const audienceListQuerySchema = z.object({
  q: z.string().trim().max(80).catch(""),
  active: z.enum(["all", "true", "false"]).catch("all"),
  page: pageSchema.catch(1),
});

// ---------------------------------------------------------------------------------------------
// Templates and campaigns
// ---------------------------------------------------------------------------------------------

function validateMessageContent(
  value: { channel: (typeof MARKETING_CHANNELS)[number]; subject: string; body: string; design: EmailDesign },
  ctx: z.RefinementCtx
): void {
  if (value.channel === "email") {
    if (value.subject.trim() === "") {
      ctx.addIssue({ code: "custom", path: ["subject"], message: "Email subject is required" });
    }
    if (value.subject.length > EMAIL_SUBJECT_MAX) {
      ctx.addIssue({ code: "custom", path: ["subject"], message: `Maximum ${EMAIL_SUBJECT_MAX} characters` });
    }
    if (value.body.length > EMAIL_BODY_MAX) {
      ctx.addIssue({ code: "custom", path: ["body"], message: `Maximum ${EMAIL_BODY_MAX} characters` });
    }
  } else {
    const label = value.channel === "sms" ? "SMS" : "Telegram";
    if (value.design !== DEFAULT_EMAIL_DESIGN) {
      ctx.addIssue({ code: "custom", path: ["design"], message: `${label} messages always use the plain style` });
    }
    if (value.subject.trim() !== "") {
      ctx.addIssue({ code: "custom", path: ["subject"], message: `${label} messages have no subject` });
    }
    if (value.channel === "sms" && value.body.length + 1 + SMS_OPT_OUT_FOOTER.length > SMS_BODY_MAX) {
      ctx.addIssue({
        code: "custom",
        path: ["body"],
        message: `SMS is limited to ${SMS_BODY_MAX} characters including the opt-out line`,
      });
    }
    if (value.channel === "telegram" && value.body.length > TELEGRAM_BODY_MAX) {
      ctx.addIssue({
        code: "custom",
        path: ["body"],
        message: `Telegram messages are limited to ${TELEGRAM_BODY_MAX} characters before the opt-out line is added`,
      });
    }
  }
  const allowed: readonly string[] = value.channel === "telegram" ? TELEGRAM_VARIABLES : TEMPLATE_VARIABLES;
  const unknown = [
    ...new Set([...findUnknownTemplateVariables(value.subject), ...findUnknownTemplateVariables(value.body)]),
  ];
  const disallowed = [
    ...new Set([...extractTemplateTokens(value.subject), ...extractTemplateTokens(value.body)]),
  ].filter((name) => !allowed.includes(name));
  if (unknown.length > 0 || disallowed.length > 0) {
    const name = unknown[0] ?? disallowed[0];
    ctx.addIssue({
      code: "custom",
      path: ["body"],
      message: `Unknown variable {{${name}}}. Allowed: ${allowed.map((item) => `{{${item}}}`).join(", ")}`,
    });
  }
}

const templateShape = z
  .object({
    name: requiredText(120, "Template name"),
    channel: z.enum(MARKETING_CHANNELS),
    design: z.enum(EMAIL_DESIGNS).default(DEFAULT_EMAIL_DESIGN),
    subject: z.string().trim().max(EMAIL_SUBJECT_MAX, `Maximum ${EMAIL_SUBJECT_MAX} characters`),
    body: z.string().trim().min(1, "Message body is required").max(EMAIL_BODY_MAX, `Maximum ${EMAIL_BODY_MAX} characters`),
    isActive: z.boolean(),
  })
  .strict();

export const templateInputSchema = templateShape.superRefine(validateMessageContent);
export const templateUpdateSchema = templateShape
  .extend({ expectedVersion: z.number().int().min(1) })
  .strict()
  .superRefine(validateMessageContent);

export type TemplateInput = z.infer<typeof templateInputSchema>;

export const templateListQuerySchema = z.object({
  q: z.string().trim().max(80).catch(""),
  channel: z.enum(["all", ...MARKETING_CHANNELS]).catch("all"),
  page: pageSchema.catch(1),
});

const campaignShape = z
  .object({
    name: requiredText(120, "Campaign name"),
    channel: z.enum(MARKETING_CHANNELS),
    design: z.enum(EMAIL_DESIGNS).default(DEFAULT_EMAIL_DESIGN),
    audienceId: objectIdSchema,
    templateId: z
      .union([z.literal(""), z.null(), objectIdSchema])
      .transform((value) => (value === "" || value === null ? null : value)),
    subject: z.string().trim().max(EMAIL_SUBJECT_MAX, `Maximum ${EMAIL_SUBJECT_MAX} characters`),
    body: z.string().trim().max(EMAIL_BODY_MAX, `Maximum ${EMAIL_BODY_MAX} characters`),
  })
  .strict();

export const campaignInputSchema = campaignShape.superRefine((value, ctx) => {
  if (value.body.length === 0) {
    ctx.addIssue({ code: "custom", path: ["body"], message: "Write the message body" });
  }
  validateMessageContent(value, ctx);
});

export const campaignUpdateSchema = campaignShape
  .extend({ expectedVersion: z.number().int().min(1) })
  .strict()
  .superRefine((value, ctx) => {
    if (value.body.length === 0) {
      ctx.addIssue({ code: "custom", path: ["body"], message: "Write the message body" });
    }
    validateMessageContent(value, ctx);
  });

export type CampaignInput = z.infer<typeof campaignInputSchema>;

export const scheduleCampaignSchema = z
  .object({
    /** Empty means "send as soon as the campaign is approved". */
    scheduledAt: z.string().trim().max(40),
    expectedVersion: z.number().int().min(1),
  })
  .strict();

export const campaignListQuerySchema = z.object({
  q: z.string().trim().max(80).catch(""),
  status: z.enum(["all", ...CAMPAIGN_STATUSES]).catch("all"),
  channel: z.enum(["all", ...MARKETING_CHANNELS]).catch("all"),
  page: pageSchema.catch(1),
});

export type CampaignListQuery = z.infer<typeof campaignListQuerySchema>;

// ---------------------------------------------------------------------------------------------
// Social
// ---------------------------------------------------------------------------------------------

const socialPostShape = z
  .object({
    socialAccountId: objectIdSchema,
    content: z
      .string()
      .trim()
      .min(1, "Write the post content")
      .max(SOCIAL_CONTENT_LIMITS.facebook_page, `Facebook posts are limited to ${SOCIAL_CONTENT_LIMITS.facebook_page} characters`),
  })
  .strict();

export const socialPostInputSchema = socialPostShape;
export const socialPostUpdateSchema = socialPostShape
  .extend({ expectedVersion: z.number().int().min(1) })
  .strict();

export type SocialPostInput = z.infer<typeof socialPostInputSchema>;

export const socialScheduleSchema = z
  .object({
    scheduledAt: z.string().trim().max(40),
    expectedVersion: z.number().int().min(1),
  })
  .strict();

export const socialPostListQuerySchema = z.object({
  status: z.enum(["all", ...SOCIAL_POST_STATUSES]).catch("all"),
  page: pageSchema.catch(1),
});

// ---------------------------------------------------------------------------------------------
// AI copywriter
// ---------------------------------------------------------------------------------------------

export const aiRequestSchema = z
  .object({
    channel: z.enum(AI_CHANNELS),
    tone: z.enum(AI_TONES),
    language: z.enum(AI_LANGUAGES),
    goal: optionalText(200),
    productDescription: z.string().trim().min(10, "Describe the product or service in at least 10 characters").max(800, "Maximum 800 characters"),
    targetAudience: z.string().trim().min(3, "Describe the audience").max(300, "Maximum 300 characters"),
  })
  .strict();

export type AiRequestInput = z.infer<typeof aiRequestSchema>;

export const aiEditSchema = z
  .object({
    subject: z.string().trim().max(EMAIL_SUBJECT_MAX, `Maximum ${EMAIL_SUBJECT_MAX} characters`),
    body: z.string().trim().min(1, "Write the copy").max(2200, "Maximum 2200 characters"),
  })
  .strict();

export const aiListQuerySchema = z.object({ page: pageSchema.catch(1) });

// ---------------------------------------------------------------------------------------------
// Provider webhook (generic signed contract; the company is never taken from the payload)
// ---------------------------------------------------------------------------------------------

/** Event types a provider may report. "unsubscribed" is recorded by the unsubscribe flow, not by providers. */
export const WEBHOOK_EVENT_TYPES = ["delivered", "bounced", "complained", "failed", "opened", "clicked"] as const;

export const deliveryWebhookSchema = z
  .object({
    eventId: z.string().trim().min(1).max(120),
    type: z.enum(WEBHOOK_EVENT_TYPES),
    providerMessageId: z.string().trim().min(1).max(200),
    occurredAt: z.iso.datetime(),
  })
  .strict();

export type DeliveryWebhookInput = z.infer<typeof deliveryWebhookSchema>;
