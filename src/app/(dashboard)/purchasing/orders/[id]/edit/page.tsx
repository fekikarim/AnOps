import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { getPurchaseOrder } from "@/server/purchasing/purchase-order.service";
import { supplierOptions } from "@/server/purchasing/supplier.service";
import { listProductOptions } from "@/server/inventory/catalog.service";
import { isAppError } from "@/shared/lib/errors";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { PermissionDenied } from "@/shared/components/data-display/permission-denied";
import { PurchaseOrderForm } from "@/features/purchasing/components/purchase-order-form";
import { formatDecimalString } from "@/shared/lib/format";

export const metadata: Metadata = { title: "Edit purchase order | AnOps ERP" };

export default async function EditPurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getPageWorkspace();
  const { id } = await params;

  let order;
  try {
    order = await getPurchaseOrder(ctx, id);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  if (!order.permissions.canEdit) return <PermissionDenied backHref={`/purchasing/orders/${order.id}`} backLabel="Back to order" />;

  const [suppliers, products] = await Promise.all([supplierOptions(ctx), listProductOptions(ctx)]);
  // Product options must include lines already on the draft, even if the product was archived since.
  const productOptions = products.map((p) => ({ id: p.id, label: `${p.sku} · ${p.name} (${p.unitOfMeasure})` }));
  for (const line of order.lines) {
    if (!productOptions.some((option) => option.id === line.productId)) {
      productOptions.push({ id: line.productId, label: `${line.sku} · ${line.productName} (archived)` });
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title={`Edit ${order.orderNumber}`} description="Only drafts can be edited. Approved orders are fixed; cancel and reissue to change them." />
      <PurchaseOrderForm
        orderId={order.id}
        version={order.version}
        currencyCode={order.currencyCode}
        suppliers={suppliers.map((s) => ({ id: s.id, label: s.name }))}
        products={productOptions}
        initial={{
          supplierId: order.supplierId,
          expectedDate: order.expectedDate ? order.expectedDate.slice(0, 10) : "",
          notes: order.notes,
          lines: order.lines.map((line) => ({
            productId: line.productId,
            quantity: formatDecimalString(line.ordered).replace(/ /g, ""),
            unitCost: line.unitCost,
            taxRate: line.taxRate,
          })),
        }}
      />
    </div>
  );
}
