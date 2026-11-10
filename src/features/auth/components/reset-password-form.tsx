"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { TextField } from "@/shared/components/ui/text-field";
import { Button } from "@/features/auth/components/auth-form";
import { resetPasswordAction } from "@/features/auth/actions/auth.action";
import { resetPasswordSchema, type ResetPasswordInput } from "@/features/auth/schemas/auth.schema";

export function ResetPasswordForm({ token }: { token: string }) {
  const [serverError, setServerError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    mode: "onBlur",
    defaultValues: { token, password: "", confirmPassword: "" },
  });

  const onSubmit = (values: ResetPasswordInput) => {
    setServerError(undefined);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("token", token);
      formData.set("password", values.password);
      formData.set("confirmPassword", values.confirmPassword);
      const result = await resetPasswordAction({}, formData);
      if (result?.error) setServerError(result.error);
    });
  };

  if (!token) {
    return (
      <p role="alert" className="rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] px-3 py-2 text-sm text-[var(--color-text-primary)]">
        This reset link is invalid or missing its token. Please request a new one.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      {serverError && (
        <p role="alert" className="rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] px-3 py-2 text-sm text-[var(--color-text-primary)]">
          {serverError}
        </p>
      )}
      <TextField
        {...register("password")}
        label="New password"
        type="password"
        placeholder="Minimum 8 characters"
        autoComplete="new-password"
        hint="At least 8 characters, including a letter and a number."
        error={errors.password?.message}
      />
      <TextField
        {...register("confirmPassword")}
        label="Confirm password"
        type="password"
        placeholder="Re-enter password"
        autoComplete="new-password"
        error={errors.confirmPassword?.message}
      />
      <Button type="submit" variant="primary" className="w-full" disabled={pending}>
        {pending ? "Updating…" : "Update password"}
      </Button>
    </form>
  );
}
