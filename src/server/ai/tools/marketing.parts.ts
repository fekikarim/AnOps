import "server-only";
import type { AiAccess } from "@/server/ai/access/access.service";
import type { ContactView, MkScope } from "@/server/ai/marketing/access";
import type { AiAction, AiBadge, AiRecordCardPart, AiRecordTablePart } from "@/server/db/documents";
import type { AiOperation } from "@/shared/domain/ai";
import type { CampaignDto, DeliveryRowDto } from "@/server/marketing/campaign.service";
import type { AudienceDto } from "@/server/marketing/audience.service";
import type { TemplateDto } from "@/server/marketing/template.service";
import type { TagDto } from "@/server/marketing/tag.service";
import type { SocialPostDto } from "@/server/marketing/social/post.service";
import type { CampaignReportDto, DashboardDto } from "@/server/marketing/analytics.service";
import { CAMPAIGN_STATUS_LABELS } from "@/features/marketing/utils/campaign-state";

/**
 * Marketing results as structured parts. Contacts arrive here already masked; campaign and audience views carry counts,
 * never a sample of recipients. Actions are offered only to people who may use them and each goes back through the command
 * runner, which authorises it again.
 */
const can = (access: AiAccess, op: AiOperation) => access.can("marketing", op);
type Args = Record<string, string | number | boolean>;

const CAMPAIGN_TONE: Record<string, AiBadge["tone"]> = { draft: "neutral", pending_approval: "warning", approved: "info", scheduled: "info", processing: "warning", completed: "success", cancelled: "neutral", failed: "error" };
const badge = (status: string): AiBadge => ({ label: CAMPAIGN_STATUS_LABELS[status as keyof typeof CAMPAIGN_STATUS_LABELS] ?? status, tone: CAMPAIGN_TONE[status] ?? "neutral" });

export function campaignsTable(page: { items: CampaignDto[]; total: number; page: number; totalPages: number }, args: Args, select?: { command: string }): AiRecordTablePart {
  return {
    type: "record_table",
    title: select ? "Choose a campaign" : "Campaigns",
    columns: [{ key: "name", label: "Campaign" }, { key: "channel", label: "Channel" }, { key: "audience", label: "Audience" }, { key: "when", label: "Scheduled" }],
    rows: page.items.map((c) => ({
      id: c.id,
      cells: { name: c.name, channel: c.channel, audience: c.audienceName, when: c.scheduledAt ? c.scheduledAt.slice(0, 16).replace("T", " ") : "None" },
      badge: badge(c.status),
      actions: [select ? { label: "Select", command: select.command, args: { campaignId: c.id }, step: "select" as const } : { label: "Open", command: "campaign", args: { campaignId: c.id } }],
    })),
    total: page.total,
    emptyMessage: "No campaigns match. Create one with /newcampaign.",
    paging: { page: page.page, totalPages: page.totalPages, command: select ? select.command : "campaigns", args },
  };
}

export function campaignCard(c: CampaignDto, scope: MkScope, access: AiAccess, preview: { subject: string; text: string }): AiRecordCardPart {
  const args = { campaignId: c.id };
  const actions: AiAction[] = [];
  if (c.status === "draft" && can(access, "edit")) {
    actions.push({ label: "Edit", command: "editcampaign", args, step: "select" });
    actions.push({ label: "Submit for approval", command: "submitcampaign", args, step: "select" });
  }
  if (scope.admin && can(access, "approve")) {
    if (c.status === "pending_approval") actions.push({ label: "Approve", command: "approvecampaign", args, step: "select" });
    if (c.status === "approved") actions.push({ label: "Schedule", command: "schedulecampaign", args, step: "select" });
    if (["approved", "scheduled", "pending_approval", "draft"].includes(c.status)) actions.push({ label: "Cancel", command: "cancelcampaign", args, step: "select" });
  }
  if (can(access, "view")) actions.push({ label: "Report", command: "campaignreport", args });
  return {
    type: "record_card",
    title: c.name,
    subtitle: `${c.channel} · ${c.audienceName}`,
    badges: [badge(c.status)],
    fields: [
      ...(c.channel === "email" ? [{ label: "Subject", value: c.subject }] : []),
      { label: "Scheduled", value: c.scheduledAt ? c.scheduledAt.replace("T", " ").slice(0, 16) + " UTC" : "Not scheduled" },
      ...(c.snapshot ? [{ label: "Recipients", value: `${c.snapshot.eligibleCount} eligible, ${c.snapshot.suppressedCount} suppressed of ${c.snapshot.matchedCount}` }] : []),
      ...(c.failureCode ? [{ label: "Failure", value: c.failureCode }] : []),
    ],
    sections: [{ title: "Message as a recipient sees it", rows: [{ label: "Text", value: preview.text.slice(0, 900) }] }],
    actions,
  };
}

export function audiencesTable(page: { items: AudienceDto[]; total: number; page: number; totalPages: number }, args: Args, access: AiAccess, select?: { command: string }): AiRecordTablePart {
  return {
    type: "record_table",
    title: select ? "Choose an audience" : "Audiences",
    columns: [{ key: "name", label: "Audience" }, { key: "description", label: "Description" }],
    rows: page.items.map((a) => ({
      id: a.id,
      cells: { name: a.name, description: a.description },
      badge: a.isActive ? { label: "Active", tone: "success" } : { label: "Inactive", tone: "neutral" },
      actions: select ? [{ label: "Select", command: select.command, args: { audienceId: a.id }, step: "select" as const }] : [{ label: "Size", command: "audience", args: { audienceId: a.id } }, ...(can(access, "edit") ? [{ label: "Edit", command: "editaudience", args: { audienceId: a.id }, step: "select" as const }] : [])],
    })),
    total: page.total,
    emptyMessage: "No audiences yet. Create one with /newaudience.",
    paging: { page: page.page, totalPages: page.totalPages, command: select ? select.command : "audiences", args },
  };
}

export function audienceCard(a: AudienceDto, size: { matched: number; eligible: number; exclusions: Record<string, number> } | null, channel: string): AiRecordCardPart {
  return {
    type: "record_card",
    title: a.name,
    subtitle: a.description || undefined,
    badges: [a.isActive ? { label: "Active", tone: "success" } : { label: "Inactive", tone: "neutral" }],
    fields: [
      { label: "Rule", value: a.rule ? `${a.rule.match === "all" ? "All" : "Any"} of ${a.rule.conditions.length} condition${a.rule.conditions.length === 1 ? "" : "s"}` : "Unusable rule" },
      ...(size ? [{ label: `Matches (${channel})`, value: `${size.matched} contacts, ${size.eligible} eligible` }, { label: "Excluded", value: Object.entries(size.exclusions).filter(([, n]) => n > 0).map(([k, n]) => `${k.replace(/_/g, " ")}: ${n}`).join(" · ") || "None" }] : []),
    ],
  };
}

export function contactsTable(rows: ContactView[], total: number, page: number, totalPages: number, args: Args, access: AiAccess): AiRecordTablePart {
  return {
    type: "record_table",
    title: "Contacts",
    columns: [{ key: "name", label: "Contact" }, { key: "email", label: "Email" }, { key: "phone", label: "Phone" }, { key: "stage", label: "Stage" }],
    rows: rows.map((c) => ({
      id: c.id,
      cells: { name: c.name, email: c.email || "None", phone: c.phone || "None", stage: c.lifecycleStage },
      badge: c.isActive ? { label: "Active", tone: "success" } : { label: "Inactive", tone: "neutral" },
      actions: [{ label: "Open", command: "contact", args: { contactId: c.id } }, ...(can(access, "edit") ? [{ label: "Edit", command: "editcontact", args: { contactId: c.id }, step: "select" as const }] : [])],
    })),
    total,
    emptyMessage: "No contacts match. Add one with /newcontact.",
    paging: { page, totalPages, command: "contacts", args },
  };
}

export function contactCard(c: ContactView, consent: Record<string, string>, tags: string[]): AiRecordCardPart {
  return {
    type: "record_card",
    title: c.name,
    subtitle: c.revealed ? "Full details shown" : "Email and phone are masked",
    badges: [c.isActive ? { label: "Active", tone: "success" } : { label: "Inactive", tone: "neutral" }],
    fields: [
      { label: "Email", value: c.email || "None" },
      { label: "Phone", value: c.phone || "None" },
      { label: "Stage", value: c.lifecycleStage },
      { label: "Source", value: c.source },
      ...Object.entries(consent).map(([channel, status]) => ({ label: `Consent (${channel})`, value: status })),
      ...(tags.length ? [{ label: "Tags", value: tags.join(", ") }] : []),
    ],
    sections: [{ title: "Consent is read-only here", rows: [{ label: "Note", value: "Consent is granted or withdrawn in Marketing, never through AI." }] }],
  };
}

export function templatesTable(page: { items: TemplateDto[]; total: number; page: number; totalPages: number }, args: Args, access: AiAccess): AiRecordTablePart {
  return {
    type: "record_table",
    title: "Templates",
    columns: [{ key: "name", label: "Template" }, { key: "channel", label: "Channel" }, { key: "subject", label: "Subject" }],
    rows: page.items.map((t) => ({
      id: t.id,
      cells: { name: t.name, channel: t.channel, subject: t.subject || "None" },
      badge: t.isActive ? { label: "Active", tone: "success" } : { label: "Inactive", tone: "neutral" },
      actions: can(access, "edit") ? [{ label: "Edit", command: "edittemplate", args: { templateId: t.id }, step: "select" as const }] : [],
    })),
    total: page.total,
    emptyMessage: "No templates yet. Create one with /newtemplate.",
    paging: { page: page.page, totalPages: page.totalPages, command: "templates", args },
  };
}

export function tagsTable(rows: TagDto[]): AiRecordTablePart {
  return { type: "record_table", title: "Tags", columns: [{ key: "name", label: "Tag" }, { key: "count", label: "Contacts", align: "right" }], rows: rows.map((t) => ({ id: t.id, cells: { name: t.name, count: String(t.contactCount) } })), total: rows.length, emptyMessage: "No tags yet. Create one with /newtag." };
}

export function deliveriesTable(page: { items: DeliveryRowDto[]; total: number; page: number; totalPages: number }, args: Args): AiRecordTablePart {
  return {
    type: "record_table",
    title: "Deliveries (addresses masked)",
    columns: [{ key: "contact", label: "Contact" }, { key: "to", label: "To" }, { key: "status", label: "Status" }, { key: "reason", label: "Note" }],
    rows: page.items.map((d) => ({ id: d.id, cells: { contact: d.contactName, to: d.destinationMasked, status: d.status, reason: d.exclusionReason ?? d.lastErrorCode ?? "" } })),
    total: page.total,
    emptyMessage: "No deliveries for that selection.",
    paging: { page: page.page, totalPages: page.totalPages, command: "campaignreport", args },
  };
}

export function reportCard(r: CampaignReportDto): AiRecordCardPart {
  const pct = (n: number | null) => (n === null ? "n/a" : `${Math.round(n * 1000) / 10}%`);
  return {
    type: "record_card",
    title: `Report: ${r.name}`,
    subtitle: `${r.channel} · ${CAMPAIGN_STATUS_LABELS[r.status]}`,
    fields: [
      ...(r.snapshot ? [{ label: "Recipients", value: `${r.snapshot.eligible} eligible, ${r.snapshot.suppressed} suppressed of ${r.snapshot.matched}` }] : []),
      { label: "Accepted by provider", value: String(r.accepted) },
      { label: "Delivered", value: String(r.deliveries.delivered ?? 0) },
      { label: "Bounced / failed", value: `${r.deliveries.bounced ?? 0} / ${r.deliveries.failed ?? 0}` },
      { label: "Unsubscribes", value: String(r.unsubscribes) },
      { label: "Delivery rate", value: r.support.delivery ? pct(r.rates.deliveryRate) : "not reported by this channel" },
      { label: "Opens / clicks", value: r.support.opens ? `${pct(r.rates.openRateEstimate)} / ${pct(r.rates.clickRate)}` : "not reported by this channel" },
    ],
  };
}

export function dashboardCard(d: DashboardDto): AiRecordCardPart {
  return {
    type: "record_card",
    title: "Marketing overview",
    fields: [
      { label: "Contacts", value: `${d.contacts.total} (${d.contacts.active} active)` },
      { label: "Audiences", value: `${d.audiences.total} (${d.audiences.active} active)` },
      { label: "Campaigns scheduled / completed", value: `${d.campaigns.scheduled} / ${d.campaigns.completed}` },
      { label: "Unsubscribes", value: String(d.unsubscribes) },
      { label: "Messages accepted", value: String(d.deliveries.accepted) },
    ],
  };
}

export function socialTable(page: { items: SocialPostDto[]; total: number; page: number; totalPages: number }, args: Args): AiRecordTablePart {
  return {
    type: "record_table",
    title: "Social posts",
    columns: [{ key: "account", label: "Account" }, { key: "content", label: "Post" }],
    rows: page.items.map((p) => ({ id: p.id, cells: { account: p.accountName, content: p.content.slice(0, 90) }, badge: { label: p.statusLabel, tone: p.status === "published" ? "success" : p.status === "failed" ? "error" : "neutral" } })),
    total: page.total,
    emptyMessage: "No social posts. Publishing stays in Marketing.",
    paging: { page: page.page, totalPages: page.totalPages, command: "socialposts", args },
  };
}
