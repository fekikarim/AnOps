import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { getBom } from "@/server/manufacturing/bom.service";
import { listProductOptions } from "@/server/inventory/catalog.service";
import { isAppError } from "@/shared/lib/errors";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { StatusBadge } from "@/shared/components/data-display/status-badge";
import { BomActions } from "@/features/manufacturing/components/bom-actions";
import { BomForm } from "@/features/manufacturing/components/bom-form";
import { BOM_STATUS } from "@/features/manufacturing/labels";
import { formatDateTime, formatDecimalString } from "@/shared/lib/format";
import { Boxes, Calendar, Factory, Hash, Layers, PackageOpen, StickyNote } from "lucide-react";
import { EmptyState } from "@/shared/components/data-display/empty-state";
import { safeLoad } from "@/shared/lib/safe-load";
import { UNIT_LABELS, type UnitOfMeasure } from "@/shared/domain/units";
import { BackLink } from "@/shared/components/ui/back-link";

export const metadata: Metadata = { title: "Bill of materials | AnOps ERP" };

export default async function BomDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getPageWorkspace();
  const { id } = await params;
  let loaded;
  try {
    loaded = await safeLoad(() => getBom(ctx, id));
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  if (!loaded.ok) {
    return (
      <div className="space-y-6">
        <PageHeader title="Bill of materials" actions={<BackLink href="/manufacturing/boms">Back to BOMs</BackLink>} />
        <EmptyState variant="error" title="This bill of materials could not be loaded" description="Something went wrong while loading it. Your data is safe. Try again in a moment." actionHref={`/manufacturing/boms/${id}`} actionLabel="Try again" />
      </div>
    );
  }
  const bom = loaded.data;
  const status = BOM_STATUS[bom.status];
  const products = bom.permissions.canEdit ? await listProductOptions(ctx) : [];
  const options = products.filter((p) => p.isStorable).map((p) => ({ id: p.id, label: `${p.sku} · ${p.name} (${p.unitOfMeasure})` }));
  const hasActions = bom.permissions.canActivate || bom.permissions.canArchive;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bill of materials"
        description={`Revision ${bom.revision} for ${bom.finishedSku}`}
        actions={<BackLink href="/manufacturing/boms">Back to BOMs</BackLink>}
      />

      <section aria-labelledby="summary-heading" className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-6">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)]">
              <Factory aria-hidden className="size-6" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Finished product</p>
              <h2 id="summary-heading" className="mt-0.5 break-words text-xl font-semibold tracking-tight">{bom.finishedName}</h2>
              <p className="mt-0.5 break-all text-sm text-[var(--color-text-secondary)]">SKU {bom.finishedSku}</p>
            </div>
          </div>
          <StatusBadge label={status.label} tone={status.tone} />
        </div>
        <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-b-[var(--radius-card)] border-t border-[var(--color-border-subtle)] bg-[var(--color-border-subtle)] sm:grid-cols-3">
          {[
            { icon: Hash, label: "Revision", value: `Revision ${bom.revision}` },
            { icon: Layers, label: "Components", value: `${bom.components.length} component${bom.components.length === 1 ? "" : "s"}` },
            { icon: Calendar, label: "Last updated", value: formatDateTime(bom.updatedAt) },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-3 bg-[var(--color-bg-surface)] px-4 py-3 sm:px-6">
              <item.icon aria-hidden className="size-4 shrink-0 text-[var(--color-text-secondary)]" />
              <div className="min-w-0">
                <dt className="text-xs text-[var(--color-text-secondary)]">{item.label}</dt>
                <dd className="truncate text-sm font-medium">{item.value}</dd>
              </div>
            </div>
          ))}
        </dl>
      </section>

      <p className="text-sm text-[var(--color-text-secondary)]">Active revisions are locked. Work orders keep the components they were created with.</p>
      {hasActions && <BomActions bomId={bom.id} version={bom.version} canActivate={bom.permissions.canActivate} canArchive={bom.permissions.canArchive} />}

      {bom.permissions.canEdit ? (
        <section aria-labelledby="edit-heading" className="space-y-4">
          <h2 id="edit-heading" className="text-lg font-semibold">Edit draft</h2>
          <BomForm
            products={options}
            bomId={bom.id}
            version={bom.version}
            initial={{
              finishedProductId: bom.finishedProductId,
              notes: bom.notes,
              components: bom.components.map((c) => ({ productId: c.productId, quantityPerUnit: c.quantityPerUnit })),
            }}
          />
        </section>
      ) : (
        <>
          <section aria-labelledby="components-heading" className="space-y-3">
            <div className="flex items-center gap-2">
              <Boxes aria-hidden className="size-4" />
              <h2 id="components-heading" className="text-lg font-semibold">Components per unit</h2>
            </div>
            {bom.components.length === 0 ? (
              <EmptyState icon={PackageOpen} title="No components" description="This revision has no components defined." />
            ) : (
              <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
                <table className="w-full min-w-[480px] text-left text-sm">
                  <caption className="sr-only">Components needed to produce one unit</caption>
                  <thead className="bg-[var(--color-bg-subtle)] text-xs uppercase tracking-wide text-[var(--color-text-secondary)]">
                    <tr>
                      <th scope="col" className="w-12 px-4 py-3 font-semibold">#</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Component</th>
                      <th scope="col" className="px-4 py-3 text-right font-semibold">Quantity per unit</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Unit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border-subtle)]">
                    {bom.components.map((c, index) => (
                      <tr key={c.productId} className="hover:bg-[var(--color-bg-subtle)]">
                        <td className="px-4 py-3 tabular-nums text-[var(--color-text-secondary)]">{index + 1}</td>
                        <td className="max-w-[320px] px-4 py-3">
                          <span className="block break-all font-medium">{c.sku}</span>
                          <span className="block break-words text-xs text-[var(--color-text-secondary)]">{c.productName}</span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">{formatDecimalString(c.quantityPerUnit)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-[var(--color-text-secondary)]">{UNIT_LABELS[c.unitOfMeasure as UnitOfMeasure] ?? c.unitOfMeasure}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-labelledby="notes-heading" className="space-y-3">
            <div className="flex items-center gap-2">
              <StickyNote aria-hidden className="size-4" />
              <h2 id="notes-heading" className="text-lg font-semibold">Notes</h2>
            </div>
            <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 text-sm sm:p-6">
              {bom.notes ? <p className="whitespace-pre-wrap break-words">{bom.notes}</p> : <p className="text-[var(--color-text-secondary)]">No notes were added to this revision.</p>}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
