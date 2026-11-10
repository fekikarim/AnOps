import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { getReplenishmentProposal, listReplenishmentProposals } from "@/server/purchasing/replenishment.service";
import { warehouseOptions } from "@/server/inventory/catalog.service";
import { supplierOptions } from "@/server/purchasing/supplier.service";
import { isAppError } from "@/shared/lib/errors";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { EmptyState } from "@/shared/components/data-display/empty-state";
import { Pagination, redirectIfPageOutOfRange } from "@/shared/components/data-display/pagination";
import { StatusBadge } from "@/shared/components/data-display/status-badge";
import type { BadgeTone } from "@/shared/components/data-display/status-badge";
import { buttonClass } from "@/shared/components/ui/button";
import { ReplenishmentGenerateForm } from "@/features/purchasing/components/replenishment-generate-form";
import { ReplenishmentProposalPanel } from "@/features/purchasing/components/replenishment-proposal-panel";
import { formatDateTime } from "@/shared/lib/format";
import { ClipboardCheck, Sparkles, Warehouse as WarehouseIcon, FileCheck2 } from "lucide-react";
import { safeLoad } from "@/shared/lib/safe-load";

export const metadata: Metadata = { title: "Replenishment | AnOps ERP" };

const PROPOSAL_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  proposed: { label: "Ready to review", tone: "info" },
  converting: { label: "Needs recovery", tone: "warning" },
  converted: { label: "Converted", tone: "success" },
};

const pageParam = z.coerce.number().int().min(1).max(1000).catch(1);
const objectIdPattern = /^[a-f0-9]{24}$/i;

export default async function ReplenishmentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getPageWorkspace();
  const raw = await searchParams;
  const page = pageParam.parse(typeof raw.page === "string" ? raw.page : 1);
  const selectedId = typeof raw.proposal === "string" && objectIdPattern.test(raw.proposal) ? raw.proposal.toLowerCase() : undefined;

  const [listLoad, warehouses, suppliers] = await Promise.all([
    safeLoad(() => listReplenishmentProposals(ctx, { page })),
    warehouseOptions(ctx),
    supplierOptions(ctx),
  ]);
  const list = listLoad.ok ? listLoad.data : null;
  if (list) redirectIfPageOutOfRange(list, "/purchasing/replenishment", { proposal: selectedId });
  const detail = selectedId
    ? await getReplenishmentProposal(ctx, selectedId).catch((error: unknown) => {
        if (isAppError(error) && error.code === "NOT_FOUND") return null;
        throw error;
      })
    : null;

  const canGenerate = ctx.permissions.has("purchasing.order.manage");
  const canConvert = ctx.permissions.has("purchasing.order.approve") && ctx.permissions.has("purchasing.order.manage");
  const activeWarehouses = warehouses.map((w) => ({ id: w.id, code: w.code, name: w.name }));

  return (
    <div className="space-y-10">
      <PageHeader
        title="AI replenishment"
        description="Suggested purchase quantities based on recent consumption. Proposals are recommendations only: nothing is ordered and no stock changes until you convert one and approve the resulting order."
      />

      <section aria-labelledby="how-heading" className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 sm:p-6">
        <h2 id="how-heading" className="flex items-center gap-2 text-base font-semibold">
          <Sparkles aria-hidden className="size-4" />
          How it works
        </h2>
        <ol className="mt-4 grid gap-4 sm:grid-cols-3">
          {[
            { icon: WarehouseIcon, title: "1. Choose a warehouse", text: "Pick where stock is held and how many days of demand to cover." },
            { icon: ClipboardCheck, title: "2. Review the proposal", text: "Quantities are calculated by the system from stock history. AI only writes the explanations." },
            { icon: FileCheck2, title: "3. Create a draft order", text: "Convert a proposal into a draft purchase order. It still needs approval before goods are received." },
          ].map((step) => (
            <li key={step.title} className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)]">
                <step.icon aria-hidden className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{step.title}</p>
                <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="generate-heading" className="space-y-4 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 sm:p-6">
        <div>
          <h2 id="generate-heading" className="text-base font-semibold">Generate a proposal</h2>
          <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">Generating a proposal does not change stock or create an order.</p>
        </div>
        {canGenerate ? (
          <ReplenishmentGenerateForm warehouses={activeWarehouses} />
        ) : (
          <p className="text-sm text-[var(--color-text-secondary)]">You can review proposals. Generating one needs order management permission.</p>
        )}
      </section>

      <section aria-labelledby="list-heading" className="space-y-3">
        <h2 id="list-heading" className="text-lg font-semibold">Recent proposals</h2>
        {!list ? (
          <EmptyState variant="error" title="Proposals could not be loaded" description="Something went wrong while loading this list. Your data is safe. Try again in a moment." actionHref="/purchasing/replenishment" actionLabel="Try again" />
        ) : list.items.length === 0 ? (
          <EmptyState title="No proposals yet" description="Choose a warehouse above and generate a proposal to see suggested purchases. Results will be listed here for review." />
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
            <table className="w-full min-w-[640px] text-left text-sm">
              <caption className="sr-only">Replenishment proposals</caption>
              <thead className="text-xs uppercase tracking-wide text-[var(--color-text-secondary)]">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">Generated</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Warehouse</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Days</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Products</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                  <th scope="col" className="px-4 py-3 font-semibold"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-subtle)]">
                {list.items.map((item) => (
                  <tr key={item.id} aria-current={item.id === selectedId ? "true" : undefined}>
                    <td className="px-4 py-3 whitespace-nowrap text-[var(--color-text-secondary)]">{formatDateTime(item.generatedAt)}</td>
                    <td className="px-4 py-3">{item.warehouseCode}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{item.horizonDays}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{item.lineCount}</td>
                    <td className="px-4 py-3">
                      <StatusBadge label={PROPOSAL_STATUS[item.status]?.label ?? item.status} tone={PROPOSAL_STATUS[item.status]?.tone ?? "neutral"} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link className={buttonClass("secondary", "min-h-[36px] px-3")} href={`/purchasing/replenishment?proposal=${item.id}&page=${list.page}`}>Review</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list && <Pagination basePath="/purchasing/replenishment" page={list.page} totalPages={list.totalPages} total={list.total} pageSize={list.pageSize} params={{ proposal: selectedId }} />}
      </section>

      {detail && <ReplenishmentProposalPanel proposal={detail} suppliers={suppliers} canConvert={canConvert} />}
      {selectedId && !detail && <p role="status" className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border-control)] p-5 text-sm text-[var(--color-text-secondary)]">That proposal was not found. It may belong to another company or have been removed.</p>}
    </div>
  );
}
