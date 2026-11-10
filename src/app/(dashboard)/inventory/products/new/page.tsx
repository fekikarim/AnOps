import type { Metadata } from "next";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { listCategories } from "@/server/inventory/catalog.service";
import { activeWarehouseChoices } from "@/server/inventory/onboarding.service";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { PermissionDenied } from "@/shared/components/data-display/permission-denied";
import { ProductForm } from "@/features/inventory/components/product-form";

export const metadata: Metadata = { title: "New product | AnOps ERP" };

export default async function NewProductPage() {
  const ctx = await getPageWorkspace();
  if (!ctx.permissions.has("inventory.product.manage")) return <PermissionDenied backHref="/inventory/products" backLabel="Back to products" />;
  const [categories, warehouses] = await Promise.all([listCategories(ctx), activeWarehouseChoices(ctx)]);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="New product" description="Name it, choose how you count it, and optionally record what you already have. Missing a category or warehouse? Create it from this form." />
      <ProductForm
        mode="create"
        canManage
        canCreateCategory
        canCreateWarehouse={ctx.permissions.has("inventory.warehouse.manage")}
        canMoveStock={ctx.permissions.has("inventory.stock.move")}
        currencyCode={ctx.currencyCode}
        warehouses={warehouses.map((w) => ({ id: w.id, label: `${w.code} · ${w.name}` }))}
        categories={categories.filter((c) => c.isActive).map((c) => ({ id: c.id, name: c.name }))}
      />
    </div>
  );
}
