import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getUserCompanies } from "@/server/services/company.service";
import { OnboardingClient } from "@/features/company/components";

export const metadata = {
  title: "Welcome to AnOps | Set up your Company",
  description: "Create your first organization to start managing operations, HR, and finance.",
};

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const companies = await getUserCompanies(session.user.id);
  if (companies.length > 0) {
    redirect("/anops");
  }

  return (
    <main id="main" className="min-h-screen flex items-center justify-center bg-[var(--color-bg-canvas)] px-4 py-12">
      <div className="w-full max-w-lg">
        <OnboardingClient userName={session.user.name || "there"} />
      </div>
    </main>
  );
}
