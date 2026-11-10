import type { Metadata } from "next";
import Link from "next/link";
import { ActivateForm } from "@/features/platform/components/activate-form";
import { PlatformShell, panel } from "@/features/platform/components/platform-shell";

export const metadata: Metadata = { title: "Activate your organization", robots: { index: false } };

export default async function ActivatePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <PlatformShell>
      <div className={panel}>
        {token ? (
          <ActivateForm token={token} />
        ) : (
          <div className="text-center">
            <h1 className="font-[family-name:var(--font-heading)] text-2xl font-semibold text-[var(--color-text-primary)]">This link is incomplete</h1>
            <p className="mt-3 text-sm text-[var(--color-text-secondary)]">Open the activation link from your email again, or request a new one from AnOps.</p>
            <Link href="/anops" className="mt-6 inline-flex min-h-[44px] items-center font-semibold text-[var(--color-text-primary)] underline underline-offset-4">
              Open AnOps
            </Link>
          </div>
        )}
      </div>
    </PlatformShell>
  );
}
