import { ModuleTabs } from "@/shared/components/layout/module-tabs";
import { requireAppAccess } from "@/server/platform/access";
import { getApplication } from "@/shared/domain/applications";

/** Entitlement guard + mobile section tabs (desktop navigation lives in the application sidebar). */
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireAppAccess("inventory");
  const tabs = getApplication("inventory").nav.flatMap((group) => group.items);
  return (
    <div className="space-y-6">
      <ModuleTabs tabs={tabs} />
      {children}
    </div>
  );
}
