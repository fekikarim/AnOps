import { AuthCard } from "@/features/auth/components/auth-form";
import { ResendVerificationForm } from "@/features/auth/components/resend-verification-form";
import { auth } from "@/server/auth";
import { logoutAction } from "@/features/auth/actions/auth.action";
import Link from "next/link";

export default async function UnverifiedPage({
  searchParams,
}: {
  searchParams: Promise<{ delivery?: string; email?: string }>;
}) {
  const params = await searchParams;
  const session = await auth();
  const email = session?.user?.email ?? params.email;
  const delivery = params.delivery;
  const failed = delivery === "not_configured" || delivery === "error";

  return (
    <AuthCard title="Verify your email" description="Check your inbox to verify your account">
      <div className="space-y-4 text-center">
        {failed ? (
          <p
            role="alert"
            className="rounded-[var(--radius-control)] border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-3 py-2 text-left text-sm text-[var(--color-warning-text)]"
          >
            <span className="font-semibold">Verification email not sent. </span>
            {delivery === "not_configured"
              ? "Email delivery is not configured on this server. In development, the verification link is printed in the server console."
              : "We couldn't send the verification email. Please check the server logs and try again."}
          </p>
        ) : (
          <p className="text-sm text-[var(--color-text-secondary)]">
            We&apos;ve sent a verification link to{" "}
            {email ? (
              <span className="font-semibold text-[var(--color-text-primary)]">{email}</span>
            ) : (
              "your email"
            )}
            . Please verify to activate your account.
          </p>
        )}
        <ResendVerificationForm email={email} />
        {session?.user ? (
          <form action={logoutAction}>
            <button
              type="submit"
              className="inline-flex h-12 items-center justify-center w-full rounded-[var(--radius-control)] bg-[var(--color-action-primary)] text-sm font-semibold text-[var(--color-action-on-primary)] hover:bg-[var(--color-action-hover)] cursor-pointer"
            >
              Sign out
            </button>
          </form>
        ) : (
          <Link
            href="/login"
            className="inline-flex h-12 items-center justify-center w-full rounded-[var(--radius-control)] bg-[var(--color-action-primary)] text-sm font-semibold text-[var(--color-action-on-primary)] hover:bg-[var(--color-action-hover)]"
          >
            Back to sign in
          </Link>
        )}
      </div>
    </AuthCard>
  );
}
