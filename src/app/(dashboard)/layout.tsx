import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { DashboardShell } from "@/shared/components/layout/dashboard-shell";
import { ToastProvider } from "@/shared/components/ui/toast";
import { requireActive } from "@/features/auth/actions/auth.action";
import { getUserCompanies } from "@/server/services/company.service";
import { ACTIVE_COMPANY_COOKIE } from "@/server/tenant/context";
import { getPageOrgAccess } from "@/server/platform/access";
import { AiFeaturesProvider } from "@/features/platform/components/ai-features";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireActive();
  const companies = await getUserCompanies(session.user.id);

  if (companies.length === 0) {
    redirect("/onboarding");
  }

  const cookieStore = await cookies();
  const access = await getPageOrgAccess();
  const activeCompanyId = access.organization.id ?? cookieStore.get(ACTIVE_COMPANY_COOKIE)?.value ?? companies[0].id;

  return (
    <ToastProvider>
      <DashboardShell
        user={{
          name: session.user.name ?? "Account",
          email: session.user.email ?? "",
        }}
        companies={companies}
        activeCompanyId={activeCompanyId}
        allowedApps={access.apps}
        permissions={[...access.ctx.permissions]}
        aiFeatures={access.entitlements.aiFeatures}
      >
        <AiFeaturesProvider enabled={access.entitlements.aiFeatures}>{children}</AiFeaturesProvider>
      </DashboardShell>
    </ToastProvider>
  );
}
