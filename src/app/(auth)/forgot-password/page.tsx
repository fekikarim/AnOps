import { AuthCard } from "@/features/auth/components/auth-form";
import { ForgotPasswordForm } from "@/features/auth/components/forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <AuthCard title="Reset password" description="We'll send you a reset link">
      <ForgotPasswordForm />
    </AuthCard>
  );
}
