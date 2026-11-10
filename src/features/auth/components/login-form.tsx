"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { TextField } from "@/shared/components/ui/text-field";
import { Button } from "@/features/auth/components/auth-form";
import { loginAction } from "@/features/auth/actions/auth.action";
import { loginSchema, type LoginInput } from "@/features/auth/schemas/auth.schema";

export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const [serverError, setServerError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    mode: "onBlur",
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = (values: LoginInput) => {
    setServerError(undefined);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("email", values.email);
      formData.set("password", values.password);
      formData.set("callbackUrl", callbackUrl);
      const result = await loginAction({}, formData);
      if (result?.error) setServerError(result.error);
    });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      {serverError && (
        <p role="alert" className="rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] px-3 py-2 text-sm text-[var(--color-text-primary)]">
          {serverError}
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
      <TextField
        {...register("password")}
        label="Password"
        type="password"
        placeholder="Enter your password"
        autoComplete="current-password"
        error={errors.password?.message}
      />
      <div className="flex items-center justify-between text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="h-4 w-4 shrink-0 rounded-[calc(var(--radius-control)*0.5)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] accent-[var(--color-action-primary)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-[2px] focus-visible:ring-offset-[var(--color-bg-surface)]"
          />
          <span>Remember me</span>
        </label>
        <Link href="/forgot-password" className="text-[var(--color-text-secondary)] hover:underline">
          Forgot password?
        </Link>
      </div>
      <Button type="submit" variant="primary" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-center text-sm text-[var(--color-text-secondary)]">
        Don&apos;t have an account?{" "}
        <Link href="/trial" className="text-[var(--color-text-primary)] font-medium hover:underline">
          Create account
        </Link>
      </p>
    </form>
  );
}
