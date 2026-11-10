import { AuthCard } from "@/features/auth/components/auth-form";
import Link from "next/link";

export default function BannedPage() {
  return (
    <AuthCard title="Account suspended" description="This account has been banned">
      <div className="space-y-4 text-center">
        <p className="text-sm text-[var(--color-text-secondary)]">
          If you believe this is a mistake, please contact support.
        </p>
        <Link href="/login" className="inline-flex h-12 items-center justify-center w-full rounded-[var(--radius-control)] border border-[var(--color-border-control)] text-sm font-semibold hover:bg-[var(--color-bg-subtle)]">
          Back to sign in
        </Link>
      </div>
    </AuthCard>
  );
}
