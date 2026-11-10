import type { Metadata } from "next";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { bomOptions } from "@/server/manufacturing/bom.service";
import { warehouseOptions } from "@/server/inventory/catalog.service";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { PermissionDenied } from "@/shared/components/data-display/permission-denied";
import { WorkOrderForm } from "@/features/manufacturing/components/work-order-form";

export const metadata: Metadata = { title: "New work order | AnOps ERP" };

export default async function NewWorkOrderPage() {
  const ctx = await getPageWorkspace();
  if (!ctx.permissions.has("manufacturing.work_order.manage")) return <PermissionDenied backHref="/manufacturing/work-orders" backLabel="Back to work orders" />;
  const [boms, warehouses] = await Promise.all([bomOptions(ctx), warehouseOptions(ctx)]);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="New work order" description="Plans a production run from the active bill of materials." />
      <WorkOrderForm
        boms={boms.map((b) => ({ id: b.id, label: b.label }))}
        warehouses={warehouses.map((w) => ({ id: w.id, label: `${w.code} · ${w.name}` }))}
        canCreateWarehouse={ctx.permissions.has("inventory.warehouse.manage")}
        canCreateBom={ctx.permissions.has("manufacturing.bom.manage")}
        canOrderMaterials={ctx.permissions.has("purchasing.order.manage")}
      />
    </div>
  );
}
