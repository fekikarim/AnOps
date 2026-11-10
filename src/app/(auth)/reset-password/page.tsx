import { AuthCard } from "@/features/auth/components/auth-form";
import { ResetPasswordForm } from "@/features/auth/components/reset-password-form";
import { ForceResetForm } from "@/features/auth/components/force-reset-form";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; force?: string }>;
}) {
  const params = await searchParams;
  const isForced = params.force === "1";
  const token = params.token || "";

  if (isForced) {
    return (
      <AuthCard
        title="Set your password"
        description="Your account was provisioned by HR. Please set a personal password to continue."
      >
        <ForceResetForm />
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Set new password" description="Enter your new password">
      <ResetPasswordForm token={token} />
    </AuthCard>
  );
}
