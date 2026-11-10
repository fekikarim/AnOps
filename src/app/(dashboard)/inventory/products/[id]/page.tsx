import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { getProduct, listCategories } from "@/server/inventory/catalog.service";
import { listBalancesForProduct, listStockMovements } from "@/server/inventory/stock.service";
import { isAppError } from "@/shared/lib/errors";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { StatusBadge } from "@/shared/components/data-display/status-badge";
import { ProductForm } from "@/features/inventory/components/product-form";
import { ProductActions } from "@/features/inventory/components/product-actions";
import { STOCK_STATUS_LABELS, STOCK_STATUS_TONES, MOVEMENT_LABELS } from "@/features/inventory/labels";
import { formatDateTime, formatDecimalString } from "@/shared/lib/format";
import { UNIT_LABELS, type UnitOfMeasure } from "@/shared/domain/units";
import { BackLink } from "@/shared/components/ui/back-link";

export const metadata: Metadata = { title: "Product | AnOps ERP" };

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getPageWorkspace();
  const { id } = await params;

  let product;
  try {
    product = await getProduct(ctx, id);
  } catch (error) {
    if (isAppError(error) && (error.code === "NOT_FOUND" || error.code === "VALIDATION_ERROR")) notFound();
    throw error;
  }

  const [balances, movements, categories] = await Promise.all([
    listBalancesForProduct(ctx, id),
    listStockMovements(ctx, { productId: id, page: 1 }),
    listCategories(ctx),
  ]);
  const canManage = ctx.permissions.has("inventory.product.manage");

  return (
    <div className="space-y-8">
      <PageHeader
        title={product.name}
        description={`SKU ${product.sku} · ${UNIT_LABELS[product.unitOfMeasure as UnitOfMeasure]}`}
        actions={
          <BackLink href="/inventory/products">Back to products</BackLink>
        }
      />

      <section aria-labelledby="stock-heading" className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="stock-heading" className="text-lg font-semibold">Stock by warehouse</h2>
          <StatusBadge label={STOCK_STATUS_LABELS[product.stockStatus]} tone={STOCK_STATUS_TONES[product.stockStatus]} />
          <span className="text-sm text-[var(--color-text-secondary)]">
            Total on hand: <strong className="text-[var(--color-text-primary)]">{formatDecimalString(product.onHand)}</strong>
          </span>
        </div>
        {balances.length === 0 ? (
          <p className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 text-sm text-[var(--color-text-secondary)]">
            No stock in any warehouse yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
            <table className="w-full min-w-[420px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-[var(--color-text-secondary)]">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">Warehouse</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">On hand</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-subtle)]">
                {balances.map((balance) => (
                  <tr key={balance.warehouseId}>
                    <td className="px-4 py-3">{balance.warehouseCode} · {balance.warehouseName}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatDecimalString(balance.onHand)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge label={STOCK_STATUS_LABELS[balance.stockStatus]} tone={STOCK_STATUS_TONES[balance.stockStatus]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="history-heading" className="space-y-3">
        <h2 id="history-heading" className="text-lg font-semibold">Recent movements</h2>
        {movements.items.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">No movements recorded for this product.</p>
        ) : (
          <ul className="divide-y divide-[var(--color-border-subtle)] rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
            {movements.items.map((movement) => (
              <li key={movement.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span className="text-[var(--color-text-secondary)]">{formatDateTime(movement.createdAt)}</span>
                <span>{MOVEMENT_LABELS[movement.movementType] ?? movement.movementType} · {movement.warehouseCode}</span>
                <span className="tabular-nums">{movement.deltaMicro < 0 ? "−" : "+"}{formatDecimalString(movement.quantity)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="edit-heading" className="space-y-4">
        <h2 id="edit-heading" className="text-lg font-semibold">Details</h2>
        <ProductForm
          mode="edit"
          canManage={canManage}
          product={product}
          categories={categories.filter((c) => c.isActive || c.id === product.categoryId).map((c) => ({ id: c.id, name: c.name }))}
        />
        {canManage && <ProductActions productId={product.id} isActive={product.isActive} />}
      </section>
    </div>
  );
}

