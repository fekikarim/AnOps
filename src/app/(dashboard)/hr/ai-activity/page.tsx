import { requireAiFeatures } from "@/server/platform/access";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentAuthUser } from "@/server/auth/rbac";
import { listAiAuditEntries } from "@/server/services/hr-ai.service";
import { AiActivityView } from "@/features/hr/components/ai-activity-view";
import { AI_AUDIT_EVENT_TYPES } from "@/features/hr/ai/types";
import { BackLink } from "@/shared/components/ui/back-link";

export const metadata: Metadata = { title: "AI Activity | HR | AnOps" };

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Every filter is optional. A malformed value is ignored rather than passed to the query. */
const filterSchema = z.object({
  eventType: z.enum(AI_AUDIT_EVENT_TYPES as [string, ...string[]]).optional().catch(undefined),
  toolName: z.string().regex(/^[a-z_]{1,60}$/).optional().catch(undefined),
  provider: z.string().max(40).optional().catch(undefined),
  actorName: z.string().max(120).optional().catch(undefined),
  from: isoDate.optional().catch(undefined),
  to: isoDate.optional().catch(undefined),
  before: z.string().regex(/^[a-f\d]{24}$/i).optional().catch(undefined),
});

function clean(params: Record<string, string | string[] | undefined>) {
  const single = Object.entries(params).map(([key, value]) => [key, typeof value === "string" && value ? value : undefined]);
  return filterSchema.parse(Object.fromEntries(single));
}

export default async function HrAiActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAiFeatures("/hr");
  const user = await getCurrentAuthUser();
  if (!user?.isAdmin) redirect("/hr");

  const filter = clean(await searchParams);
  const { entries, nextCursor, actorNames } = await listAiAuditEntries(
    filter as Parameters<typeof listAiAuditEntries>[0],
    user.companyId
  );

  const nextParams = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value && key !== "before") nextParams.set(key, value);
  }
  if (nextCursor) nextParams.set("before", nextCursor);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">AI Activity</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Append-only record of every HR Copilot tool call, confirmed action and guardrail block in this company.
          </p>
        </div>
        <BackLink href="/hr">Back to HR</BackLink>
      </div>

      <AiActivityView entries={entries} actorNames={actorNames} filter={filter} />

      {nextCursor && (
        <div className="text-center">
          <Link
            href={`/hr/ai-activity?${nextParams.toString()}`}
            className="inline-flex min-h-[44px] items-center rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] px-4 text-xs font-bold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] transition-colors"
          >
            Older entries
          </Link>
        </div>
      )}
    </div>
  );
}
