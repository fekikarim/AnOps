import type { Metadata } from "next";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { PERMISSIONS } from "@/server/security/permissions";
import { PermissionDenied } from "@/shared/components/data-display/permission-denied";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { getAiSettings, listAccessMembers, loadLiveMember } from "@/server/ai/access/access.service";
import { getCompanyUsageSummary } from "@/server/ai/usage.service";
import { aiScope } from "@/server/ai/data/scope";
import { AccessAdmin } from "@/features/ai/components/access-admin";

export const metadata: Metadata = { title: "AI access and limits | AnOps ERP" };

export default async function AiAccessPage() {
  const ctx = await getPageWorkspace();
  const live = await loadLiveMember(ctx.db, ctx.companyId, ctx.userId);
  if (!live || !live.permissions.has(PERMISSIONS.AI_ACCESS_MANAGE)) {
    return <PermissionDenied backHref="/ai" backLabel="Back to AnOps AI" />;
  }

  const [settings, members, selfGrant] = await Promise.all([
    getAiSettings(ctx),
    listAccessMembers(ctx),
    aiScope(ctx).grants.findOne({ userId: ctx.userId }),
  ]);
  const usage = live.permissions.has(PERMISSIONS.AI_USAGE_VIEW)
    ? await getCompanyUsageSummary(ctx, settings.dailyTokenBudget)
    : null;

  return (
    <div className="space-y-8">
      <PageHeader
        title="AI access and limits"
        description="Choose who can use AnOps AI and what it may do for them. AI access is always limited to what each person's role already allows."
      />
      <AccessAdmin
        // Remount with fresh state whenever the saved data changes (after router.refresh()).
        key={`${settings.version}:${members.map((m) => `${m.userId}.${m.grant.version}`).join(",")}`}
        settings={settings}
        members={members}
        usage={usage}
        isOwner={live.companyRole === "owner"}
        canAudit={Boolean(selfGrant?.canAuditTranscripts) && (live.companyRole === "owner" || live.companyRole === "admin")}
      />
    </div>
  );
}
