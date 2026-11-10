import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { getWorkOrder } from "@/server/manufacturing/work-order.service";
import { isAppError } from "@/shared/lib/errors";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { StatusBadge } from "@/shared/components/data-display/status-badge";
import { WorkOrderActions } from "@/features/manufacturing/components/work-order-actions";
import { WORK_ORDER_STATUS } from "@/features/manufacturing/labels";
import { STOCK_STATUS_LABELS, STOCK_STATUS_TONES } from "@/features/inventory/labels";
import { formatDateTime, formatDecimalString } from "@/shared/lib/format";
import { BackLink } from "@/shared/components/ui/back-link";
import { ButtonLink } from "@/shared/components/ui/button";
import { buildShortagePurchaseHref } from "@/features/purchasing/shortage-link";
import { ShoppingCart } from "lucide-react";

export const metadata: Metadata = { title: "Work order | AnOps ERP" };

export default async function WorkOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getPageWorkspace();
  const { id } = await params;
  let wo;
  try {
    wo = await getWorkOrder(ctx, id);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const status = WORK_ORDER_STATUS[wo.status];
  const short = wo.materials.filter((m) => !m.sufficient);
  const canOrder = ctx.permissions.has("purchasing.order.manage");
  // Only what is still to be consumed counts: a started order may already have used some of a material.
  const orderHref = buildShortagePurchaseHref(
    short.map((m) => ({ productId: m.productId, quantity: m.shortfallExact })),
    { workOrderId: wo.id }
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title={wo.orderNumber}
        description={`${wo.finishedSku} · ${wo.finishedName} · BOM revision ${wo.bomRevision}`}
        actions={<BackLink href="/manufacturing/work-orders">Back to work orders</BackLink>}
      />

      <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--color-text-secondary)]">Status</p>
          <p className="mt-2"><StatusBadge label={status.label} tone={status.tone} /></p>
        </div>
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--color-text-secondary)]">Planned / produced</p>
          <p className="mt-2 text-lg font-semibold tabular-nums">{formatDecimalString(wo.plannedQuantity)} / {formatDecimalString(wo.producedQuantity)}</p>
        </div>
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--color-text-secondary)]">Warehouse</p>
          <p className="mt-2 font-semibold">{wo.warehouseCode}</p>
        </div>
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--color-text-secondary)]">Started / completed</p>
          <p className="mt-2 text-sm">{formatDateTime(wo.startedAt)}</p>
          <p className="text-sm">{formatDateTime(wo.completedAt)}</p>
        </div>
      </div>

      <WorkOrderActions
        orderId={wo.id}
        version={wo.version}
        canStart={wo.permissions.canStart}
        canComplete={wo.permissions.canComplete}
        canCancel={wo.permissions.canCancel}
      />

      <section aria-labelledby="materials-heading" className="space-y-3">
        <h2 id="materials-heading" className="text-lg font-semibold">Materials</h2>
        {short.length > 0 && wo.status !== "completed" && (
          <div role="status" className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-[var(--color-status-warning)] bg-[var(--color-status-warning-bg)] p-4 text-sm text-[var(--color-status-warning)] sm:flex-row sm:items-center sm:justify-between">
            <p>
              {short.length} material{short.length === 1 ? " is" : "s are"} short in {wo.warehouseCode}. Completion will be refused until stock covers the plan.
            </p>
            {canOrder ? (
              <ButtonLink href={orderHref} variant="secondary" className="shrink-0">
                <ShoppingCart aria-hidden className="size-4" />
                Order the missing materials
              </ButtonLink>
            ) : (
              <p className="shrink-0 font-semibold">Ask a buyer to order them.</p>
            )}
          </div>
        )}
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
          <table className="w-full min-w-[760px] text-left text-sm">
            <caption className="sr-only">Planned and consumed materials</caption>
            <thead className="text-xs uppercase tracking-wide text-[var(--color-text-secondary)]">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Material</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Planned</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Consumed</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">On hand</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Shortfall</th>
                <th scope="col" className="px-4 py-3 font-semibold">Stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)]">
              {wo.materials.map((m) => (
                <tr key={m.productId}>
                  <td className="px-4 py-3"><span className="font-medium">{m.sku}</span><span className="block text-xs text-[var(--color-text-secondary)]">{m.productName}</span></td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatDecimalString(m.planned)} {m.unitOfMeasure}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatDecimalString(m.consumed)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatDecimalString(m.onHand)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatDecimalString(m.shortfall)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge label={m.sufficient ? "Covered" : STOCK_STATUS_LABELS[m.stockStatus]} tone={m.sufficient ? "success" : STOCK_STATUS_TONES[m.stockStatus]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Planned quantities come from the BOM revision captured when this order was created. &quot;On hand&quot; is shown for planning only; completion re-checks stock at the moment it runs.
        </p>
      </section>
    </div>
  );
}
