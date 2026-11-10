import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { getPurchaseOrder } from "@/server/purchasing/purchase-order.service";
import { listReceiptsForOrder } from "@/server/purchasing/receipt.service";
import { listWarehouses } from "@/server/inventory/catalog.service";
import { isAppError } from "@/shared/lib/errors";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { StatusBadge } from "@/shared/components/data-display/status-badge";
import { ButtonLink } from "@/shared/components/ui/button";
import { OrderActions } from "@/features/purchasing/components/order-actions";
import { ReceiptForm } from "@/features/purchasing/components/receipt-form";
import { PO_STATUS, RECEIPT_STATUS } from "@/features/purchasing/labels";
import { formatDate, formatDecimalString, formatMoney } from "@/shared/lib/format";
import { BackLink } from "@/shared/components/ui/back-link";

export const metadata: Metadata = { title: "Purchase order | AnOps ERP" };

/** Tells the user what happens next for this order, so nobody has to know the purchase-order lifecycle. */
function NextStep({ status, canApprove, canReceive }: { status: string; canApprove: boolean; canReceive: boolean }) {
  let text: string | null = null;
  if (status === "draft") text = canApprove ? "Next: check the lines, then approve the order. Approving does not change stock." : "Next: ask someone with approval rights to approve this draft.";
  else if (status === "approved" || status === "partially_received")
    text = canReceive ? "Next: when the delivery arrives, record it in “Receive goods” below. That is what updates your stock." : "Next: goods arrive and are received by someone with receiving rights.";
  else if (status === "received") text = "Done: every line was received and stock is updated. See the receipts below, or check Inventory > Stock.";
  if (!text) return null;
  return (
    <p role="status" className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-4 py-3 text-sm text-[var(--color-text-primary)]">
      {text}
    </p>
  );
}

export default async function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getPageWorkspace();
  const { id } = await params;

  let order;
  try {
    order = await getPurchaseOrder(ctx, id);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const [receipts, warehouses] = await Promise.all([
    listReceiptsForOrder(ctx, id),
    order.permissions.canReceive ? listWarehouses(ctx) : Promise.resolve([]),
  ]);

  const status = PO_STATUS[order.status];
  const openLines = order.lines.filter((line) => line.remainingMicro > 0);

  return (
    <div className="space-y-8">
      <PageHeader
        title={order.orderNumber}
        description={`${order.supplierName} · created ${formatDate(order.createdAt)}`}
        actions={
          <>
            {order.permissions.canEdit && <ButtonLink href={`/purchasing/orders/${order.id}/edit`}>Edit draft</ButtonLink>}
            <BackLink href="/purchasing/orders">Back to orders</BackLink>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge label={status.label} tone={status.tone} />
        <span className="text-sm text-[var(--color-text-secondary)]">
          Expected {formatDate(order.expectedDate)} · Approved {formatDate(order.approvedAt)}
        </span>
      </div>

      <NextStep status={order.status} canApprove={order.permissions.canApprove} canReceive={order.permissions.canReceive && openLines.length > 0} />

      <OrderActions orderId={order.id} version={order.version} canApprove={order.permissions.canApprove} canCancel={order.permissions.canCancel} />

      <section aria-labelledby="lines-heading" className="space-y-3">
        <h2 id="lines-heading" className="text-lg font-semibold">Lines</h2>
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
          <table className="w-full min-w-[760px] text-left text-sm">
            <caption className="sr-only">Order lines</caption>
            <thead className="text-xs uppercase tracking-wide text-[var(--color-text-secondary)]">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Product</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Ordered</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Received</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Remaining</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Unit cost</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Tax %</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Line subtotal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)]">
              {order.lines.map((line) => (
                <tr key={line.id}>
                  <td className="px-4 py-3"><span className="font-medium">{line.sku}</span><span className="block text-xs text-[var(--color-text-secondary)]">{line.productName}</span></td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatDecimalString(line.ordered)} {line.unitOfMeasure}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatDecimalString(line.received)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatDecimalString(line.remaining)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatDecimalString(line.unitCost)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{line.taxRate}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatMoney(line.lineSubtotal, order.currencyCode)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="ml-auto grid max-w-sm grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <dt className="text-[var(--color-text-secondary)]">Subtotal</dt>
          <dd className="text-right tabular-nums">{formatMoney(order.subtotal, order.currencyCode)}</dd>
          <dt className="text-[var(--color-text-secondary)]">Tax</dt>
          <dd className="text-right tabular-nums">{formatMoney(order.tax, order.currencyCode)}</dd>
          <dt className="font-semibold">Total</dt>
          <dd className="text-right font-semibold tabular-nums">{formatMoney(order.total, order.currencyCode)}</dd>
        </dl>
        {order.notes && <p className="text-sm text-[var(--color-text-secondary)]">Notes: {order.notes}</p>}
      </section>

      {order.permissions.canReceive && openLines.length > 0 && (
        <section aria-labelledby="receive-heading" className="space-y-3 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5">
          <h2 id="receive-heading" className="text-lg font-semibold">Receive goods</h2>
          <ReceiptForm
            orderId={order.id}
            warehouses={warehouses.filter((w) => w.isActive).map((w) => ({ id: w.id, label: `${w.code} · ${w.name}` }))}
            canPost={ctx.permissions.has("purchasing.receipt.post")}
            canCreateWarehouse={ctx.permissions.has("inventory.warehouse.manage")}
            lines={openLines.map((line) => ({ id: line.id, sku: line.sku, productName: line.productName, unitOfMeasure: line.unitOfMeasure, remaining: line.remaining }))}
          />
        </section>
      )}

      <section aria-labelledby="receipts-heading" className="space-y-3">
        <h2 id="receipts-heading" className="text-lg font-semibold">Receipts</h2>
        {receipts.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">No receipts recorded for this order.</p>
        ) : (
          <ul className="divide-y divide-[var(--color-border-subtle)] rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
            {receipts.map((receipt) => (
              <li key={receipt.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                <Link href={`/purchasing/receipts/${receipt.id}`} className="font-medium underline-offset-2 hover:underline">{receipt.receiptNumber}</Link>
                <span className="text-[var(--color-text-secondary)]">{formatDate(receipt.createdAt)} · {receipt.warehouseCode}</span>
                <StatusBadge label={RECEIPT_STATUS[receipt.status].label} tone={RECEIPT_STATUS[receipt.status].tone} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
