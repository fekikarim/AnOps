import { ModuleTabs } from "@/shared/components/layout/module-tabs";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import { PERMISSIONS } from "@/server/security/permissions";
import { requireAppAccess } from "@/server/platform/access";

export default async function AiLayout({ children }: { children: React.ReactNode }) {
  await requireAppAccess("ai");
  const ctx = await getPageWorkspace();
  const tabs = [{ label: "Assistant", href: "/ai", exact: true }];
  // The tab is a convenience. The access page and every action behind it check the permission again.
  if (ctx.permissions.has(PERMISSIONS.AI_ACCESS_MANAGE)) tabs.push({ label: "Access and limits", href: "/ai/access", exact: false });
  return (
    <div className="space-y-6">
      <h1 className="sr-only">AnOps AI</h1>
      {tabs.length > 1 && <ModuleTabs tabs={tabs} />}
      {children}
    </div>
  );
}
