"use client";

import { useState, useTransition } from "react";
import { TextField } from "@/shared/components/ui/text-field";
import { Button } from "@/features/auth/components/auth-form";
import { forceResetPasswordAction } from "@/features/auth/actions/force-reset.action";
import { signOut } from "next-auth/react";
import { ShieldAlert } from "lucide-react";

export function ForceResetForm() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    startTransition(async () => {
      const result = await forceResetPasswordAction({ password, confirmPassword });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setDone(true);
      // Sign out so the user gets a fresh JWT without forcePasswordReset
      await signOut({ callbackUrl: "/login?reset=success" });
    });
  };

  if (done) {
    return (
      <p className="rounded-[var(--radius-control)] bg-[var(--color-status-success-bg)] px-3 py-3 text-sm text-[var(--color-status-success)] font-medium">
        Password set! Redirecting you to login…
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {/* Security notice */}
      <div className="flex items-start gap-2.5 rounded-[var(--radius-control)] border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-3 py-3">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warning-text)]" />
        <p className="text-xs leading-relaxed text-[var(--color-warning-text)]">
          <strong>Security required:</strong> You were assigned a temporary password by your HR admin. You must set a
          personal password before you can access the platform.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] px-3 py-2 text-sm text-[var(--color-error-text)]">
          {error}
        </p>
      )}

      <TextField
        id="force-new-password"
        label="New password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Minimum 8 characters"
        autoComplete="new-password"
        hint="At least 8 characters."
      />

      <TextField
        id="force-confirm-password"
        label="Confirm password"
        type="password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        placeholder="Re-enter your password"
        autoComplete="new-password"
      />

      <Button type="submit" variant="primary" className="w-full" disabled={pending}>
        {pending ? "Saving…" : "Set my password"}
      </Button>
    </form>
  );
}
