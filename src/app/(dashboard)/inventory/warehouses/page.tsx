import type { Metadata } from "next";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { listWarehouses } from "@/server/inventory/catalog.service";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { WarehouseManager } from "@/features/inventory/components/warehouse-manager";

export const metadata: Metadata = { title: "Warehouses | AnOps ERP" };

export default async function WarehousesPage() {
  const ctx = await getPageWorkspace();
  const warehouses = await listWarehouses(ctx);
  return (
    <div className="space-y-6">
      <PageHeader title="Warehouses" description="Locations where stock is held. A warehouse with stock cannot be deactivated." />
      <WarehouseManager warehouses={warehouses} canManage={ctx.permissions.has("inventory.warehouse.manage")} />
    </div>
  );
}
