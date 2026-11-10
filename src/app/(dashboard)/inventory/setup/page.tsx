import type { Metadata } from "next";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { getInventorySetupData } from "@/server/inventory/onboarding.service";
import { PageHeader } from "@/shared/components/data-display/page-header";
import { SetupWizard } from "@/features/inventory/components/setup-wizard";

export const metadata: Metadata = { title: "Set up inventory | AnOps ERP" };

export default async function InventorySetupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getPageWorkspace();
  const raw = await searchParams;
  const data = await getInventorySetupData(ctx);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Set up your inventory"
        description="A few guided steps. Everything you add is saved immediately, so you can stop and pick up later exactly where you left off."
      />
      <SetupWizard data={data} initialStep={typeof raw.step === "string" ? raw.step : undefined} />
    </div>
  );
}
