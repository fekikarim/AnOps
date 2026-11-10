import { requireAppAccess } from "@/server/platform/access";

/** Entitlement guard: only organizations (and members) with access to this application can open it. */
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireAppAccess("hr-payroll");
  return children;
}
