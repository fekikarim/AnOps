import { redirect } from "next/navigation";

/**
 * Old placeholder dashboard (it showed fixed sample numbers). The workspace home is /anops; old bookmarks,
 * the offline page and installed apps that still point here continue to work.
 */
export default function LegacyDashboardPage() {
  redirect("/anops");
}
