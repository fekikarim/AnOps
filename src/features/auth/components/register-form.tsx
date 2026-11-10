"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { TextField } from "@/shared/components/ui/text-field";
import { Button } from "@/features/auth/components/auth-form";
import { registerAction } from "@/features/auth/actions/auth.action";
import { registerSchema, type RegisterInput } from "@/features/auth/schemas/auth.schema";

export function RegisterForm() {
  const [serverError, setServerError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    mode: "onBlur",
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
  });

  const onSubmit = (values: RegisterInput) => {
    setServerError(undefined);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("name", values.name);
      formData.set("email", values.email);
      formData.set("password", values.password);
      formData.set("confirmPassword", values.confirmPassword);
      const result = await registerAction({}, formData);
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
        {...register("name")}
        label="Full name"
        placeholder="John Doe"
        autoComplete="name"
        error={errors.name?.message}
      />
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
        {pending ? "Creating account…" : "Create account"}
      </Button>
      <p className="text-center text-sm text-[var(--color-text-secondary)]">
        Already have an account?{" "}
        <Link href="/login" className="text-[var(--color-text-primary)] font-medium hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
