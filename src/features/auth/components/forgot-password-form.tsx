"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { TextField } from "@/shared/components/ui/text-field";
import { Button } from "@/features/auth/components/auth-form";
import { forgotPasswordAction } from "@/features/auth/actions/auth.action";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/features/auth/schemas/auth.schema";

export function ForgotPasswordForm() {
  const [serverError, setServerError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [warning, setWarning] = useState<string>();
  const [pending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    mode: "onBlur",
    defaultValues: { email: "" },
  });

  const onSubmit = (values: ForgotPasswordInput) => {
    setServerError(undefined);
    setSuccess(undefined);
    setWarning(undefined);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("email", values.email);
      const result = await forgotPasswordAction({}, formData);
      if (result?.error) setServerError(result.error);
      if (result?.success) setSuccess(result.success);
      if (result?.warning) setWarning(result.warning);
    });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      {serverError && (
        <p role="alert" className="rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] px-3 py-2 text-sm text-[var(--color-text-primary)]">
          {serverError}
        </p>
      )}
      {success && (
        <p role="status" className="rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] px-3 py-2 text-sm text-[var(--color-text-primary)]">
          {success}
        </p>
      )}
      {warning && (
        <p
          role="alert"
          className="rounded-[var(--radius-control)] border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-3 py-2 text-sm text-[var(--color-warning-text)]"
        >
          <span className="font-semibold">Email not sent. </span>
          {warning}
        </p>
      )}
      <TextField
        {...register("email")}
        label="Email"
        type="email"
        placeholder="you@company.com"
        autoComplete="email"
        error={errors.email?.message}
      />
      <Button type="submit" variant="primary" className="w-full" disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </Button>
      <p className="text-center text-sm text-[var(--color-text-secondary)]">
        <Link href="/login" className="hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
