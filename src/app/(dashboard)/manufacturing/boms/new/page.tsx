import type { Metadata } from "next";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { listProductOptions } from "@/server/inventory/catalog.service";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { PermissionDenied } from "@/shared/components/data-display/permission-denied";
import { BomForm } from "@/features/manufacturing/components/bom-form";

export const metadata: Metadata = { title: "New bill of materials | AnOps ERP" };

export default async function NewBomPage() {
  const ctx = await getPageWorkspace();
  if (!ctx.permissions.has("manufacturing.bom.manage")) return <PermissionDenied backHref="/manufacturing/boms" backLabel="Back to BOMs" />;
  const products = await listProductOptions(ctx);
  const options = products.filter((p) => p.isStorable).map((p) => ({ id: p.id, label: `${p.sku} · ${p.name} (${p.unitOfMeasure})` }));
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="New bill of materials" description="Creates a draft revision. Activate it before creating work orders from this product." />
      <BomForm products={options} />
    </div>
  );
}
