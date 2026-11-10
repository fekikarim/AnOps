import { redirect } from "next/navigation";
import { getPageOrgAccess } from "@/server/platform/access";

/** Short, stable address for "Settings": opens the settings of the active organization. */
export default async function SettingsRedirect() {
  const access = await getPageOrgAccess();
  redirect(`/organization/${access.organization.id}/settings`);
}
