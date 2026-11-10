import type { Metadata } from "next";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { listCategories } from "@/server/inventory/catalog.service";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { CategoryManager } from "@/features/inventory/components/category-manager";

export const metadata: Metadata = { title: "Categories | AnOps ERP" };

export default async function CategoriesPage() {
  const ctx = await getPageWorkspace();
  const categories = await listCategories(ctx);
  return (
    <div className="space-y-6">
      <PageHeader title="Product categories" description="Optional groups for products. Archived categories stay on existing products." />
      <CategoryManager categories={categories} canManage={ctx.permissions.has("inventory.product.manage")} />
    </div>
  );
}
