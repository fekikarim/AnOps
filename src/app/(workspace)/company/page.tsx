import { redirect } from "next/navigation";
import { getPageOrgAccess } from "@/server/platform/access";

/** The Company application was merged into the organization page. Old links and bookmarks land there. */
export default async function LegacyCompanyPage() {
  const access = await getPageOrgAccess();
  redirect(`/organization/${access.organization.id}`);
}
