import { verifyEmail } from "@/features/auth/actions/verify.action";
import { AuthCard } from "@/features/auth/components/auth-form";
import Link from "next/link";

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const params = await searchParams;
  const token = params.token || "";
  const result = await verifyEmail(token);

  return (
    <AuthCard title={result.ok ? "Email verified" : "Verification failed"} description={result.message}>
      <div className="space-y-4">
        <Link href="/login" className="inline-flex h-12 items-center justify-center w-full rounded-[var(--radius-control)] bg-[var(--color-action-primary)] text-sm font-semibold text-[var(--color-action-on-primary)] hover:bg-[var(--color-action-hover)]">
          Continue to sign in
        </Link>
      </div>
    </AuthCard>
  );
}
