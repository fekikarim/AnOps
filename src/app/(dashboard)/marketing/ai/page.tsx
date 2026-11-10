import { requireAiFeatures } from "@/server/platform/access";
import type { Metadata } from "next";
import Link from "next/link";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { listGenerations } from "@/server/marketing/ai/copy.service";
import { ai } from "@/server/ai";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { Pagination } from "@/shared/components/data-display/pagination";
import { StatusBadge } from "@/shared/components/data-display/status-badge";
import { AiCopyForm } from "@/features/marketing/components/ai-copy-form";
import { aiListQuerySchema } from "@/features/marketing/schemas/marketing.schema";
import { PERMISSIONS } from "@/server/security/permissions";
import { formatDateTime } from "@/shared/lib/format";

export const metadata: Metadata = { title: "AI copy | AnOps ERP" };

const STATUS_TONE = { generated_draft: "warning", edited: "warning", approved_for_use: "success", failed: "error" } as const;
const STATUS_LABEL = { generated_draft: "Draft", edited: "Edited", approved_for_use: "Approved", failed: "Failed" } as const;

export default async function AiCopyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAiFeatures("/marketing");
  const ctx = await getPageWorkspace();
  const raw = await searchParams;
  const query = aiListQuerySchema.parse({ page: Array.isArray(raw.page) ? raw.page[0] : raw.page });
  const history = await listGenerations(ctx, query);
  const aiReady = ai.status().some((provider) => provider.available);
  const canGenerate = ctx.permissions.has(PERMISSIONS.MARKETING_AI_GENERATE);
  return (
    <div className="space-y-8">
      <PageHeader title="AI copywriter" description="Generate promotional drafts. Nothing is sent or published from here; you approve each draft first." />
      {canGenerate ? (
        <AiCopyForm aiReady={aiReady} />
      ) : (
        <p className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border-control)] p-4 text-sm text-[var(--color-text-secondary)]">Your role can view drafts but not generate new ones.</p>
      )}
      <section aria-labelledby="history" className="space-y-3">
        <h2 id="history" className="text-base font-semibold">Recent drafts</h2>
        {history.items.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">No drafts yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--color-border-subtle)] rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
            {history.items.map((item) => (
              <li key={item.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <Link href={`/marketing/ai/${item.id}`} className="break-words font-medium underline-offset-2 hover:underline">{item.productDescription.slice(0, 120)}</Link>
                  <p className="text-sm text-[var(--color-text-secondary)]">{item.channel === "facebook_page" ? "Facebook Page" : item.channel === "sms" ? "SMS" : "Email"} · {formatDateTime(item.createdAt)}</p>
                </div>
                <StatusBadge label={STATUS_LABEL[item.status]} tone={STATUS_TONE[item.status]} />
              </li>
            ))}
          </ul>
        )}
        <Pagination basePath="/marketing/ai" page={history.page} totalPages={history.totalPages} params={{}} />
      </section>
    </div>
  );
}
