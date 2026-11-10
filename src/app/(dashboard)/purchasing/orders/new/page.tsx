import type { Metadata } from "next";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { supplierOptions } from "@/server/purchasing/supplier.service";
import { listCategories, listProductOptions } from "@/server/inventory/catalog.service";
import { getWorkOrder } from "@/server/manufacturing/work-order.service";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { PermissionDenied } from "@/shared/components/data-display/permission-denied";
import { PurchaseOrderForm } from "@/features/purchasing/components/purchase-order-form";
import { parseShortageLines } from "@/features/purchasing/shortage-link";

export const metadata: Metadata = { title: "New purchase order | AnOps ERP" };

export default async function NewPurchaseOrderPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getPageWorkspace();
  if (!ctx.permissions.has("purchasing.order.manage")) return <PermissionDenied backHref="/purchasing/orders" backLabel="Back to orders" />;
  const raw = await searchParams;
  const canCreateProduct = ctx.permissions.has("inventory.product.manage");
  const [suppliers, products, categories] = await Promise.all([
    supplierOptions(ctx),
    listProductOptions(ctx),
    canCreateProduct ? listCategories(ctx) : Promise.resolve([]),
  ]);

  // Prefilled lines (for example, a work order's missing materials) are re-validated here: only products that
  // exist for this company and are active survive, whatever the link said.
  const known = new Map(products.map((product) => [product.id, product]));
  const prefill = parseShortageLines(raw.lines).filter((line) => known.has(line.productId));
  const initial = prefill.length
    ? {
        supplierId: suppliers.length === 1 ? (suppliers[0]?.id ?? "") : "",
        expectedDate: "",
        notes: "",
        lines: prefill.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          unitCost: known.get(line.productId)?.cost ?? "0.000",
          taxRate: "0",
        })),
      }
    : undefined;

  let prefillNotice: string | undefined;
  if (initial) {
    const workOrderId = typeof raw.workOrder === "string" && /^[a-f0-9]{24}$/i.test(raw.workOrder) ? raw.workOrder : null;
    // The work order only decorates the message. A forged, foreign or deleted id just falls back to the generic text.
    const workOrder =
      workOrderId && ctx.permissions.has("manufacturing.read") ? await getWorkOrder(ctx, workOrderId).catch(() => null) : null;
    prefillNotice = workOrder
      ? `Quantities are the materials ${workOrder.orderNumber} is missing in ${workOrder.warehouseCode}. Check the supplier and prices, then save.`
      : "Quantities were prefilled from the shortage you came from. Check the supplier and prices, then save.";
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="New purchase order" description="Creates a draft. Approve it once the supplier and quantities are confirmed. Missing a supplier or product? Create it from the form." />
      <PurchaseOrderForm
        suppliers={suppliers.map((s) => ({ id: s.id, label: s.name }))}
        products={products.map((p) => ({ id: p.id, label: `${p.sku} · ${p.name} (${p.unitOfMeasure})`, cost: p.cost }))}
        categories={categories.filter((c) => c.isActive).map((c) => ({ id: c.id, name: c.name }))}
        canCreateSupplier={ctx.permissions.has("purchasing.supplier.manage")}
        canCreateProduct={canCreateProduct}
        initial={initial}
        prefillNotice={prefillNotice}
        currencyCode={ctx.currencyCode}
      />
    </div>
  );
}
