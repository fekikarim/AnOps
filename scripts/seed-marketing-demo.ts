/**
 * Seeds a realistic Marketing workspace for demos, screenshots and QA.
 *
 * Design rules:
 * - Every record is written through the real marketing services, so validation, consent handling and
 *   audit logging behave exactly as they do in the UI.
 * - Everything is prefixed with "[Demo]" and is idempotent: rerunning the script reuses records by
 *   unique email / normalized name and never duplicates data.
 * - Campaigns stay in safe states only: draft, pending approval, approved and cancelled. The script
 *   never calls `scheduleCampaign`, so no dispatch job exists and the worker cannot send anything.
 *   Demo contacts use the reserved `example.test` domain, so even a mistaken send is undeliverable.
 * - An approved demo campaign gets its `pending` delivery rows from the normal approval path, which is
 *   what makes the campaign detail page look populated. Without a job those rows never move.
 *
 * Run: npm run marketing:seed-demo
 *      npm run marketing:seed-demo -- farmy
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { ObjectId, type Db } from "mongodb";
import type { CampaignStatus, ContactSource, LifecycleStage, MarketingChannel } from "@/features/marketing/types/constants";
import type { AudienceRuleInput, TemplateInput } from "@/features/marketing/schemas/marketing.schema";
import { isCampaignCancellable } from "@/features/marketing/utils/campaign-state";
import type { EmailDesign } from "@/features/marketing/utils/email-design";
import { normalizeEmail, normalizeName, normalizePhone } from "@/features/marketing/utils/normalize";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import type { AudienceDoc, CampaignDoc, ContactDoc, SuppressionDoc, TagDoc } from "@/server/marketing/documents";

type ProcessWithEnvFile = typeof process & { loadEnvFile?: (path?: string) => void };
if (!process.env.MONGODB_URI && existsSync(".env")) {
  (process as ProcessWithEnvFile).loadEnvFile?.(".env");
}
if (!process.env.MONGODB_URI) {
  console.error("MONGODB_URI is not set. Add it to .env or export it before running this script.");
  process.exit(1);
}
if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "1") {
  console.error("Refusing to seed demo data in production. Set ALLOW_DEMO_SEED=1 only on a demo deployment.");
  process.exit(1);
}

const { default: clientPromise } = await import("@/server/db/client");
const { ensureIndexes } = await import("@/server/db/indexes");
const { MARKETING_COLLECTIONS } = await import("@/server/marketing/documents");
const { permissionsForRole } = await import("@/server/security/permissions");
const { createContact } = await import("@/server/marketing/contact.service");
const { createTag, assignTags } = await import("@/server/marketing/tag.service");
const { changeConsent, getConsentState } = await import("@/server/marketing/consent.service");
const { createAudience, isValidStoredRule, updateAudience } = await import("@/server/marketing/audience.service");
const { createTemplate, updateTemplate } = await import("@/server/marketing/template.service");
const { createCampaign, submitCampaign, approveCampaign, cancelCampaign, getCampaign } = await import(
  "@/server/marketing/campaign.service"
);
const { suppress } = await import("@/server/marketing/delivery-events");

// ---------------------------------------------------------------------------------------------
// Demo content
// ---------------------------------------------------------------------------------------------

const TAG_SEEDS = [
  { key: "newsletter", name: "[Demo] Newsletter", color: "#1f7a5c" },
  { key: "vip", name: "[Demo] VIP", color: "#b45309" },
  { key: "wholesale", name: "[Demo] Wholesale", color: "#1d4ed8" },
  { key: "event", name: "[Demo] Event 2026", color: "#7c3aed" },
  { key: "leadMagnet", name: "[Demo] Lead magnet", color: "#0f766e" },
] as const;

type TagKey = (typeof TAG_SEEDS)[number]["key"];

type ContactSeed = {
  key: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  source: ContactSource;
  lifecycleStage: LifecycleStage;
  isActive: boolean;
  consent: { email: boolean; sms: boolean };
  /** Records a grant followed by a withdrawal so the consent history is not empty. */
  withdrawEmailAfterGrant?: boolean;
  tags: TagKey[];
};

const CONTACT_SEEDS: ContactSeed[] = [
  {
    key: "amine",
    firstName: "Amine",
    lastName: "Ben Salah",
    email: "amine.ben.salah@example.test",
    phone: "+216 20 100 001",
    source: "website",
    lifecycleStage: "lead",
    isActive: true,
    consent: { email: true, sms: false },
    tags: ["newsletter"],
  },
  {
    key: "fatma",
    firstName: "Fatma",
    lastName: "Trabelsi",
    email: "fatma.trabelsi@example.test",
    phone: "+216 20 100 002",
    source: "referral",
    lifecycleStage: "customer",
    isActive: true,
    consent: { email: true, sms: true },
    tags: ["newsletter", "vip"],
  },
  {
    key: "youssef",
    firstName: "Youssef",
    lastName: "Khelifi",
    email: "youssef.khelifi@example.test",
    phone: "+216 20 100 003",
    source: "event",
    lifecycleStage: "prospect",
    isActive: true,
    consent: { email: true, sms: false },
    tags: ["event"],
  },
  {
    key: "mariem",
    firstName: "Mariem",
    lastName: "Bouazizi",
    email: "mariem.bouazizi@example.test",
    phone: "+216 20 100 004",
    source: "manual",
    lifecycleStage: "customer",
    isActive: true,
    consent: { email: true, sms: true },
    tags: ["vip", "wholesale"],
  },
  {
    key: "nizar",
    firstName: "Nizar",
    lastName: "Hamdi",
    email: "nizar.hamdi@example.test",
    phone: "+216 20 100 005",
    source: "import",
    lifecycleStage: "lead",
    isActive: true,
    consent: { email: false, sms: false },
    tags: [],
  },
  {
    key: "salma",
    firstName: "Salma",
    lastName: "Jebali",
    email: "salma.jebali@example.test",
    phone: "+216 20 100 006",
    source: "website",
    lifecycleStage: "prospect",
    isActive: true,
    consent: { email: true, sms: false },
    tags: ["newsletter"],
  },
  {
    key: "walid",
    firstName: "Walid",
    lastName: "Mansour",
    email: "walid.mansour@example.test",
    phone: "+216 20 100 007",
    source: "event",
    lifecycleStage: "customer",
    isActive: true,
    consent: { email: true, sms: true },
    tags: ["wholesale"],
  },
  {
    key: "ines",
    firstName: "Ines",
    lastName: "Chaabane",
    email: "ines.chaabane@example.test",
    phone: "+216 20 100 008",
    source: "website",
    lifecycleStage: "lead",
    isActive: true,
    consent: { email: true, sms: false },
    tags: ["leadMagnet"],
  },
  {
    key: "karim",
    firstName: "Karim",
    lastName: "Ayari",
    email: "karim.ayari@example.test",
    phone: "+216 20 100 009",
    source: "referral",
    lifecycleStage: "prospect",
    isActive: true,
    consent: { email: false, sms: true },
    tags: ["newsletter"],
  },
  {
    key: "dorsaf",
    firstName: "Dorsaf",
    lastName: "Saidi",
    email: "dorsaf.saidi@example.test",
    phone: "+216 20 100 010",
    source: "manual",
    lifecycleStage: "customer",
    isActive: true,
    consent: { email: true, sms: true },
    tags: ["vip"],
  },
  {
    key: "mehdi",
    firstName: "Mehdi",
    lastName: "Riahi",
    email: "mehdi.riahi@example.test",
    phone: "+216 20 100 011",
    source: "import",
    lifecycleStage: "lead",
    isActive: true,
    consent: { email: true, sms: false },
    withdrawEmailAfterGrant: true,
    tags: ["newsletter"],
  },
  {
    key: "rania",
    firstName: "Rania",
    lastName: "Belhadj",
    email: "rania.belhadj@example.test",
    phone: "+216 20 100 012",
    source: "event",
    lifecycleStage: "prospect",
    isActive: true,
    consent: { email: true, sms: true },
    tags: ["event"],
  },
  {
    key: "hatem",
    firstName: "Hatem",
    lastName: "Zribi",
    email: "hatem.zribi@example.test",
    phone: "+216 20 100 013",
    source: "manual",
    lifecycleStage: "inactive",
    isActive: true,
    consent: { email: true, sms: false },
    tags: ["newsletter"],
  },
  {
    key: "leila",
    firstName: "Leila",
    lastName: "Ferchichi",
    email: "leila.ferchichi@example.test",
    phone: "+216 20 100 014",
    source: "website",
    lifecycleStage: "customer",
    isActive: true,
    consent: { email: true, sms: true },
    tags: ["newsletter", "vip"],
  },
  {
    key: "sami",
    firstName: "Sami",
    lastName: "Gharbi",
    email: "sami.gharbi@example.test",
    phone: "+216 20 100 015",
    source: "import",
    lifecycleStage: "prospect",
    isActive: true,
    consent: { email: true, sms: false },
    tags: ["newsletter"],
  },
  {
    key: "nadia",
    firstName: "Nadia",
    lastName: "Oueslati",
    email: "nadia.oueslati@example.test",
    phone: "+216 20 100 016",
    source: "website",
    lifecycleStage: "lead",
    isActive: true,
    consent: { email: true, sms: false },
    tags: [],
  },
  {
    key: "bilel",
    firstName: "Bilel",
    lastName: "Toumi",
    email: "bilel.toumi@example.test",
    phone: "+216 20 100 017",
    source: "referral",
    lifecycleStage: "customer",
    isActive: true,
    consent: { email: true, sms: false },
    tags: ["wholesale", "event"],
  },
  {
    key: "amal",
    firstName: "Amal",
    lastName: "Karray",
    email: "amal.karray@example.test",
    phone: "+216 20 100 018",
    source: "other",
    lifecycleStage: "inactive",
    isActive: false,
    consent: { email: false, sms: false },
    tags: [],
  },
  {
    key: "tarek",
    firstName: "Tarek",
    lastName: "Bouzid",
    email: "tarek.bouzid@example.test",
    phone: "+216 20 100 019",
    source: "other",
    lifecycleStage: "prospect",
    isActive: true,
    consent: { email: false, sms: true },
    tags: [],
  },
  {
    key: "cyrine",
    firstName: "Cyrine",
    lastName: "Mzali",
    email: "cyrine.mzali@example.test",
    phone: "+216 20 100 020",
    source: "website",
    lifecycleStage: "lead",
    isActive: true,
    consent: { email: true, sms: true },
    tags: ["leadMagnet", "newsletter"],
  },
];

/** A manually suppressed destination must exist for a contact that would otherwise be eligible. */
const SUPPRESSION_SEEDS: Array<{ contactKey: string; channel: MarketingChannel; reason: SuppressionDoc["reason"] }> = [
  { contactKey: "sami", channel: "email", reason: "manual" },
  { contactKey: "tarek", channel: "sms", reason: "manual" },
];

const EMAIL_COPY = {
  newsletter: {
    subject: "{{first_name}}, your October update from {{company_name}}",
    body: [
      "Hi {{first_name}},",
      "",
      "Here is what is new this month at {{company_name}}:",
      "",
      "• New seasonal boxes are now available.",
      "• Orders placed before Thursday ship the same week.",
      "• Our team is available for advice every weekday.",
      "",
      "Reply to this email if you would like a recommendation.",
      "",
      "Unsubscribe: {{unsubscribe_url}}",
    ].join("\n"),
  },
  vip: {
    subject: "{{first_name}}, early access opens today",
    body: [
      "Hi {{first_name}},",
      "",
      "As one of our VIP customers you get 48 hours of early access before the public launch.",
      "",
      "The private window is open now — no code needed.",
      "",
      "Thank you for being with {{company_name}}.",
      "",
      "Unsubscribe: {{unsubscribe_url}}",
    ].join("\n"),
  },
  event: {
    subject: "You are invited: {{company_name}} Open Day 2026",
    body: [
      "Hello {{first_name}},",
      "",
      "We are hosting our Open Day on Saturday, 14 November 2026.",
      "",
      "Where: the {{company_name}} showroom",
      "When: 10:00 – 17:00",
      "What: product previews, tastings and a short tour",
      "",
      "Reserve your place by replying to this email.",
      "",
      "Unsubscribe: {{unsubscribe_url}}",
    ].join("\n"),
  },
  wholesale: {
    subject: "{{company_name}} wholesale catalogue — Q4 2026",
    body: [
      "Hello {{first_name}},",
      "",
      "The Q4 wholesale catalogue is ready. It includes updated case sizes, lead times and tier pricing.",
      "",
      "Reply with the lines you need and we will send a quotation within one working day.",
      "",
      "Unsubscribe: {{unsubscribe_url}}",
    ].join("\n"),
  },
  sms: {
    subject: "",
    body: "{{first_name}}, {{company_name}} flash sale: 20% off all boxes until Friday. Reply STOP to opt out.",
  },
} as const;

const TEMPLATE_SEEDS: Array<{ key: string; input: TemplateInput }> = [
  {
    key: "newsletter",
    input: { name: "[Demo] Newsletter — monthly update", channel: "email", design: "newsletter", ...EMAIL_COPY.newsletter, isActive: true },
  },
  {
    key: "vip",
    input: { name: "[Demo] VIP early access", channel: "email", design: "promo", ...EMAIL_COPY.vip, isActive: true },
  },
  {
    key: "event",
    input: { name: "[Demo] Event 2026 invitation", channel: "email", design: "classic", ...EMAIL_COPY.event, isActive: true },
  },
  {
    key: "wholesale",
    input: { name: "[Demo] Wholesale catalogue", channel: "email", design: "minimal", ...EMAIL_COPY.wholesale, isActive: true },
  },
  {
    key: "sms",
    input: { name: "[Demo] SMS flash sale", channel: "sms", design: "plain", ...EMAIL_COPY.sms, isActive: true },
  },
];

type AudienceSeed = {
  key: string;
  name: string;
  description: string;
  rule: (tagIds: Record<TagKey, ObjectId>) => AudienceRuleInput;
};

const AUDIENCE_SEEDS: AudienceSeed[] = [
  {
    key: "newsletter",
    name: "[Demo] Newsletter subscribers",
    description: "Contacts tagged Newsletter who granted email consent and are still active.",
    rule: (tagIds) => ({
      match: "all",
      conditions: [
        { type: "tags", tagIds: [tagIds.newsletter.toHexString()], match: "any" },
        { type: "consent", channel: "email", status: "granted" },
        { type: "active", value: true },
      ],
    }),
  },
  {
    key: "vip",
    name: "[Demo] VIP customers",
    description: "Customers tagged VIP with email consent, used for early-access launches.",
    rule: (tagIds) => ({
      match: "all",
      conditions: [
        { type: "lifecycle_stage", values: ["customer"] },
        { type: "tags", tagIds: [tagIds.vip.toHexString()], match: "any" },
        { type: "consent", channel: "email", status: "granted" },
      ],
    }),
  },
  {
    key: "event",
    name: "[Demo] Event 2026 invitees",
    description: "Everyone tagged for the 2026 open day who can receive email.",
    rule: (tagIds) => ({
      match: "all",
      conditions: [
        { type: "tags", tagIds: [tagIds.event.toHexString()], match: "any" },
        { type: "consent", channel: "email", status: "granted" },
        { type: "active", value: true },
      ],
    }),
  },
  {
    key: "wholesale",
    name: "[Demo] Wholesale prospects",
    description: "Wholesale-tagged customers and prospects with email consent.",
    rule: (tagIds) => ({
      match: "all",
      conditions: [
        { type: "tags", tagIds: [tagIds.wholesale.toHexString()], match: "any" },
        { type: "lifecycle_stage", values: ["prospect", "customer"] },
        { type: "consent", channel: "email", status: "granted" },
      ],
    }),
  },
  {
    key: "sms",
    name: "[Demo] SMS leads",
    description: "Leads and prospects who explicitly granted SMS consent.",
    rule: () => ({
      match: "all",
      conditions: [
        { type: "lifecycle_stage", values: ["lead", "prospect"] },
        { type: "consent", channel: "sms", status: "granted" },
        { type: "active", value: true },
      ],
    }),
  },
];

type CampaignSeed = {
  key: string;
  name: string;
  channel: MarketingChannel;
  design: EmailDesign;
  audienceKey: string;
  templateKey: string;
  subject: string;
  body: string;
  /** The furthest safe state this demo campaign should reach. It is never scheduled. */
  desiredStatus: Extract<CampaignStatus, "draft" | "pending_approval" | "approved" | "cancelled">;
};

const CAMPAIGN_SEEDS: CampaignSeed[] = [
  {
    key: "emailDraft",
    name: "[Demo] October newsletter",
    channel: "email",
    design: "newsletter",
    audienceKey: "newsletter",
    templateKey: "newsletter",
    desiredStatus: "draft",
    ...EMAIL_COPY.newsletter,
  },
  {
    key: "wholesaleDraft",
    name: "[Demo] Q4 wholesale catalogue",
    channel: "email",
    design: "minimal",
    audienceKey: "wholesale",
    templateKey: "wholesale",
    desiredStatus: "draft",
    ...EMAIL_COPY.wholesale,
  },
  {
    key: "eventPending",
    name: "[Demo] Open Day 2026 invitation",
    channel: "email",
    design: "classic",
    audienceKey: "event",
    templateKey: "event",
    desiredStatus: "pending_approval",
    ...EMAIL_COPY.event,
  },
  {
    key: "vipApproved",
    name: "[Demo] VIP early access",
    channel: "email",
    design: "promo",
    audienceKey: "vip",
    templateKey: "vip",
    desiredStatus: "approved",
    ...EMAIL_COPY.vip,
  },
  {
    key: "cancelled",
    name: "[Demo] Summer promo (cancelled)",
    channel: "email",
    design: "newsletter",
    audienceKey: "newsletter",
    templateKey: "newsletter",
    desiredStatus: "cancelled",
    subject: "{{first_name}}, last days of the summer promo",
    body: [
      "Hi {{first_name}},",
      "",
      "The summer promo ends on Sunday. This draft was cancelled before it was ever approved.",
      "",
      "Unsubscribe: {{unsubscribe_url}}",
    ].join("\n"),
  },
  {
    key: "smsDraft",
    name: "[Demo] SMS flash sale",
    channel: "sms",
    design: "plain",
    audienceKey: "sms",
    templateKey: "sms",
    desiredStatus: "draft",
    ...EMAIL_COPY.sms,
  },
];

// ---------------------------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------------------------

type Created = { tags: number; contacts: number; audiences: number; templates: number; campaigns: number; suppressions: number; withdrawals: number };
type Reused = { tags: number; contacts: number; audiences: number; templates: number; campaigns: number };

type WorkspaceSummary = {
  company: string;
  companyId: string;
  created: Created;
  reused: Reused;
  campaignStatuses: Array<{ name: string; status: CampaignStatus }>;
  safety: { dispatchJobs: number; nonPendingDeliveries: number };
};

function emptyCreated(): Created {
  return { tags: 0, contacts: 0, audiences: 0, templates: 0, campaigns: 0, suppressions: 0, withdrawals: 0 };
}

function emptyReused(): Reused {
  return { tags: 0, contacts: 0, audiences: 0, templates: 0, campaigns: 0 };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function workspaceFor(db: Db, target: string): Promise<WorkspaceContext> {
  const company = await db.collection<{ _id: ObjectId; name: string; slug?: string; currency?: string }>("companies").findOne({
    $or: [{ slug: target.toLowerCase() }, { name: { $regex: `^${escapeRegex(target)}$`, $options: "i" } }],
  });
  if (!company) throw new Error(`Company "${target}" was not found. Use its slug or exact name.`);

  const member = await db
    .collection<{ userId: ObjectId; role: string; status: string }>("company_members")
    .findOne({ companyId: company._id, role: "owner", status: "active" });
  if (!member) throw new Error(`Company "${company.name}" has no active owner to attribute the seed to.`);

  return {
    db,
    requestId: randomUUID(),
    userId: member.userId,
    companyId: company._id,
    role: "owner",
    currencyCode: company.currency ?? "TND",
    permissions: permissionsForRole("owner"),
  };
}

async function seedWorkspace(db: Db, target: string): Promise<WorkspaceSummary> {
  const ctx = await workspaceFor(db, target);
  const company = await db.collection<{ name: string }>("companies").findOne({ _id: ctx.companyId }, { projection: { name: 1 } });
  const label = company?.name ?? target;
  console.log(`\nSeeding ${label} (${ctx.companyId.toHexString()})`);

  const created = emptyCreated();
  const reused = emptyReused();

  // Tags -------------------------------------------------------------------------------------
  const tagIds = {} as Record<TagKey, ObjectId>;
  for (const seed of TAG_SEEDS) {
    const existing = await db
      .collection<TagDoc>(MARKETING_COLLECTIONS.tags)
      .findOne({ companyId: ctx.companyId, normalizedName: normalizeName(seed.name) });
    if (existing) {
      tagIds[seed.key] = existing._id;
      reused.tags += 1;
      continue;
    }
    const dto = await createTag(ctx, { name: seed.name, color: seed.color });
    tagIds[seed.key] = new ObjectId(dto.id);
    created.tags += 1;
  }
  console.log(`  tags: ${created.tags} created, ${reused.tags} reused`);

  // Contacts ---------------------------------------------------------------------------------
  const contactIds = new Map<string, ObjectId>();
  for (const seed of CONTACT_SEEDS) {
    const normalizedEmail = normalizeEmail(seed.email);
    const existing = await db
      .collection<ContactDoc>(MARKETING_COLLECTIONS.contacts)
      .findOne({ companyId: ctx.companyId, normalizedEmail });
    let contactId: ObjectId;
    if (existing) {
      contactId = existing._id;
      reused.contacts += 1;
    } else {
      const dto = await createContact(ctx, {
        firstName: seed.firstName,
        lastName: seed.lastName,
        email: seed.email,
        phone: seed.phone,
        source: seed.source,
        lifecycleStage: seed.lifecycleStage,
        isActive: seed.isActive,
        consent: seed.consent,
      });
      contactId = new ObjectId(dto.id);
      created.contacts += 1;
    }
    contactIds.set(seed.key, contactId);

    if (seed.withdrawEmailAfterGrant) {
      let state = await getConsentState(ctx, contactId.toHexString());
      if (!state.email || state.email.status === "granted") {
        // On a fresh contact the grant already exists; this only repairs a half-finished run.
        if (!state.email) {
          await changeConsent(ctx, contactId.toHexString(), {
            channel: "email",
            status: "granted",
            source: "import",
            occurredAt: "",
          });
          state = await getConsentState(ctx, contactId.toHexString());
        }
        if (state.email?.status === "granted") {
          await changeConsent(ctx, contactId.toHexString(), {
            channel: "email",
            status: "withdrawn",
            source: "manual",
            occurredAt: "",
          });
          created.withdrawals += 1;
        }
      }
    }
  }
  console.log(`  contacts: ${created.contacts} created, ${reused.contacts} reused`);

  // Tag assignments --------------------------------------------------------------------------
  const byTag = new Map<TagKey, ObjectId[]>();
  for (const seed of CONTACT_SEEDS) {
    const contactId = contactIds.get(seed.key);
    if (!contactId) continue;
    for (const tagKey of seed.tags) {
      byTag.set(tagKey, [...(byTag.get(tagKey) ?? []), contactId]);
    }
  }
  let assigned = 0;
  for (const [tagKey, ids] of byTag) {
    const tagId = tagIds[tagKey];
    const links = await db
      .collection<{ contactId: ObjectId }>(MARKETING_COLLECTIONS.contactTags)
      .find({ companyId: ctx.companyId, tagId }, { projection: { contactId: 1 } })
      .toArray();
    const linked = new Set(links.map((row) => row.contactId.toHexString()));
    const missing = ids.filter((id) => !linked.has(id.toHexString()));
    if (missing.length === 0) continue;
    const result = await assignTags(ctx, missing.map((id) => id.toHexString()), tagId.toHexString());
    assigned += result.assigned;
  }
  console.log(`  tag links: ${assigned} added`);

  // Suppressions -----------------------------------------------------------------------------
  for (const seed of SUPPRESSION_SEEDS) {
    const contactSeed = CONTACT_SEEDS.find((row) => row.key === seed.contactKey);
    const contactId = contactIds.get(seed.contactKey);
    if (!contactSeed || !contactId) continue;
    const destination = seed.channel === "email" ? normalizeEmail(contactSeed.email) : normalizePhone(contactSeed.phone);
    if (!destination) continue;
    const existing = await db
      .collection<SuppressionDoc>(MARKETING_COLLECTIONS.suppressions)
      .findOne({ companyId: ctx.companyId, channel: seed.channel, normalizedDestination: destination.toLowerCase() });
    if (existing) continue;
    await suppress(db, { companyId: ctx.companyId, channel: seed.channel, destination, contactId }, seed.reason, new Date());
    created.suppressions += 1;
  }
  console.log(`  suppressions: ${created.suppressions} added`);

  // Audiences --------------------------------------------------------------------------------
  const audienceIds = new Map<string, ObjectId>();
  for (const seed of AUDIENCE_SEEDS) {
    const input = {
      name: seed.name,
      description: seed.description,
      rule: seed.rule(tagIds),
      isActive: true,
    };
    const existing = await db
      .collection<AudienceDoc>(MARKETING_COLLECTIONS.audiences)
      .findOne({ companyId: ctx.companyId, normalizedName: normalizeName(seed.name) });
    if (existing) {
      audienceIds.set(seed.key, existing._id);
      reused.audiences += 1;
      // Self-heal a demo row that was left without a usable rule (for example by an older seed).
      if (!isValidStoredRule(existing.selectionRule)) {
        await updateAudience(ctx, existing._id.toHexString(), { ...input, expectedVersion: existing.version ?? 1 });
        console.log(`  repaired audience rule: ${seed.name}`);
      }
      continue;
    }
    const dto = await createAudience(ctx, input);
    audienceIds.set(seed.key, new ObjectId(dto.id));
    created.audiences += 1;
  }
  console.log(`  audiences: ${created.audiences} created, ${reused.audiences} reused`);

  // Templates --------------------------------------------------------------------------------
  const templateIds = new Map<string, ObjectId>();
  for (const seed of TEMPLATE_SEEDS) {
    const existing = await db
      .collection<{ _id: ObjectId; design?: string | null; version?: number }>(MARKETING_COLLECTIONS.templates)
      .findOne({ companyId: ctx.companyId, normalizedName: normalizeName(seed.input.name) });
    if (existing) {
      templateIds.set(seed.key, existing._id);
      reused.templates += 1;
      // Self-heal rows created before designs existed. A choice made in the UI is never overwritten.
      if (!existing.design) {
        await updateTemplate(ctx, existing._id.toHexString(), { ...seed.input, expectedVersion: existing.version ?? 1 });
        console.log(`  repaired template design: ${seed.input.name}`);
      }
      continue;
    }
    const dto = await createTemplate(ctx, seed.input);
    templateIds.set(seed.key, new ObjectId(dto.id));
    created.templates += 1;
  }
  console.log(`  templates: ${created.templates} created, ${reused.templates} reused`);

  // Campaigns --------------------------------------------------------------------------------
  const campaignIds: ObjectId[] = [];
  const campaignStatuses: WorkspaceSummary["campaignStatuses"] = [];
  for (const seed of CAMPAIGN_SEEDS) {
    const audienceId = audienceIds.get(seed.audienceKey);
    const templateId = templateIds.get(seed.templateKey);
    if (!audienceId || !templateId) throw new Error(`Campaign "${seed.name}" references a missing demo audience or template.`);

    const existing = await db
      .collection<CampaignDoc>(MARKETING_COLLECTIONS.campaigns)
      .findOne({ companyId: ctx.companyId, name: seed.name });
    let campaignId: ObjectId;
    if (existing) {
      campaignId = existing._id;
      reused.campaigns += 1;
    } else {
      const dto = await createCampaign(ctx, {
        name: seed.name,
        channel: seed.channel,
        design: seed.design,
        audienceId: audienceId.toHexString(),
        templateId: templateId.toHexString(),
        subject: seed.subject,
        body: seed.body,
      });
      campaignId = new ObjectId(dto.id);
      created.campaigns += 1;
    }
    campaignIds.push(campaignId);

    // Only move forward, and only as far as the seed asks. Scheduling is never called.
    let detail = await getCampaign(ctx, campaignId.toHexString());
    if (seed.desiredStatus === "pending_approval" && detail.status === "draft") {
      await submitCampaign(ctx, detail.id, detail.version);
      detail = await getCampaign(ctx, campaignId.toHexString());
    }
    if (seed.desiredStatus === "approved") {
      if (detail.status === "draft") {
        await submitCampaign(ctx, detail.id, detail.version);
        detail = await getCampaign(ctx, campaignId.toHexString());
      }
      if (detail.status === "pending_approval") {
        await approveCampaign(ctx, detail.id, detail.version);
        detail = await getCampaign(ctx, campaignId.toHexString());
      }
    }
    if (seed.desiredStatus === "cancelled" && isCampaignCancellable(detail.status)) {
      await cancelCampaign(ctx, detail.id, detail.version);
      detail = await getCampaign(ctx, campaignId.toHexString());
    }
    campaignStatuses.push({ name: seed.name, status: detail.status });
  }
  console.log(`  campaigns: ${created.campaigns} created, ${reused.campaigns} reused`);

  // Safety checks ----------------------------------------------------------------------------
  // A demo campaign must never own a dispatch job, and no demo delivery may leave `pending`/`suppressed`.
  const dispatchJobs = await db.collection(MARKETING_COLLECTIONS.jobs).countDocuments({
    companyId: ctx.companyId,
    targetId: { $in: campaignIds },
  });
  const nonPendingDeliveries = await db.collection(MARKETING_COLLECTIONS.deliveries).countDocuments({
    companyId: ctx.companyId,
    campaignId: { $in: campaignIds },
    status: { $nin: ["pending", "suppressed"] },
  });
  if (dispatchJobs > 0) {
    throw new Error(
      `${label} has ${dispatchJobs} dispatch job(s) for demo campaigns. The seed never schedules, so remove those jobs before continuing.`
    );
  }
  if (nonPendingDeliveries > 0) {
    throw new Error(`${label} has ${nonPendingDeliveries} demo delivery row(s) past pending. Demo data must not contain send history.`);
  }

  return {
    company: label,
    companyId: ctx.companyId.toHexString(),
    created,
    reused,
    campaignStatuses,
    safety: { dispatchJobs, nonPendingDeliveries },
  };
}

function resolveTargets(): string[] {
  const fromArgs = process.argv.slice(2).filter((value) => !value.startsWith("-"));
  if (fromArgs.length > 0) return fromArgs;
  const fromEnv = process.env.SEED_COMPANIES?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  return fromEnv.length > 0 ? fromEnv : ["farmy", "flybox"];
}

function printReport(summaries: WorkspaceSummary[]): void {
  console.log("\nDemo marketing data ready.\n");
  for (const summary of summaries) {
    console.log(`${summary.company} (${summary.companyId})`);
    console.log(
      `  created: ${summary.created.contacts} contacts, ${summary.created.tags} tags, ${summary.created.audiences} audiences, ` +
        `${summary.created.templates} templates, ${summary.created.campaigns} campaigns, ${summary.created.suppressions} suppressions, ` +
        `${summary.created.withdrawals} consent withdrawals`
    );
    console.log(
      `  reused:  ${summary.reused.contacts} contacts, ${summary.reused.tags} tags, ${summary.reused.audiences} audiences, ` +
        `${summary.reused.templates} templates, ${summary.reused.campaigns} campaigns`
    );
    for (const campaign of summary.campaignStatuses) {
      console.log(`    - ${campaign.name}: ${campaign.status}`);
    }
    console.log(
      `  safety:  ${summary.safety.dispatchJobs} dispatch jobs, ${summary.safety.nonPendingDeliveries} deliveries past pending`
    );
    console.log("");
  }
  console.log("Nothing was scheduled and no message was sent. Demo contacts use the reserved example.test domain.");
}

const targets = resolveTargets();
const client = await clientPromise;
const db = client.db();
await ensureIndexes(db);

const summaries: WorkspaceSummary[] = [];
let failed = false;
for (const target of targets) {
  try {
    summaries.push(await seedWorkspace(db, target));
  } catch (error) {
    failed = true;
    console.error(`\nSeeding "${target}" failed:`, error instanceof Error ? error.message : error);
  }
}

if (summaries.length > 0) printReport(summaries);
await client.close();
if (failed) process.exitCode = 1;
