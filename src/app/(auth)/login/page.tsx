import { AuthCard } from "@/features/auth/components/auth-form";
import { LoginForm } from "@/features/auth/components/login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; reset?: string }>;
}) {
  const params = await searchParams;

  return (
    <AuthCard
      title="Sign in"
      description={
        params.reset === "success"
          ? "Password updated. Please sign in."
          : params.reset === "sent"
          ? "If an account exists, a reset link has been sent."
          : "Access your AnOps workspace"
      }
    >
      <LoginForm callbackUrl={params.callbackUrl || "/anops"} />
    </AuthCard>
  );
}
