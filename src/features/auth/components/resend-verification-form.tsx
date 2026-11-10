"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { TextField } from "@/shared/components/ui/text-field";
import { Button } from "@/features/auth/components/auth-form";
import {
  resendVerificationAction,
  type ResendVerificationResult,
} from "@/features/auth/actions/resend-verification.action";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/features/auth/schemas/auth.schema";

export function ResendVerificationForm({ email }: { email?: string }) {
  const [state, setState] = useState<ResendVerificationResult>({});
  const [pending, startTransition] = useTransition();

  const knownEmail = Boolean(email);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    mode: "onBlur",
    defaultValues: { email: email ?? "" },
  });

  const onSubmit = (values: ForgotPasswordInput) => {
    setState({});
    startTransition(async () => {
      const formData = new FormData();
      formData.set("email", values.email);
      const result = await resendVerificationAction({}, formData);
      setState(result);
    });
  };

  return (
    <div className="space-y-3 border-t border-[var(--color-border-subtle)] pt-4 text-left">
      <p className="text-sm text-[var(--color-text-secondary)]">
        {knownEmail ? (
          <>
            Didn&apos;t get the email? We&apos;ll resend it to{" "}
            <span className="font-semibold text-[var(--color-text-primary)]">{email}</span>.
          </>
        ) : (
          "Didn't get the email?"
        )}
      </p>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-3">
        {state.error && (
          <p
            role="alert"
            className="rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
          >
            {state.error}
          </p>
        )}
        {state.success && (
          <p
            role="status"
            className="rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
          >
            {state.success}
          </p>
        )}
        {state.warning && (
          <p
            role="alert"
            className="rounded-[var(--radius-control)] border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-3 py-2 text-sm text-[var(--color-warning-text)]"
          >
            <span className="font-semibold">Email not sent. </span>
            {state.warning}
          </p>
        )}
        {knownEmail ? (
          <input type="hidden" {...register("email")} />
        ) : (
          <TextField
            {...register("email")}
            label="Email"
            type="email"
            placeholder="you@company.com"
            autoComplete="email"
            error={errors.email?.message}
          />
        )}
        <Button type="submit" variant="secondary" className="w-full" disabled={pending}>
          {pending ? "Sending…" : "Resend verification email"}
        </Button>
      </form>
    </div>
  );
}
