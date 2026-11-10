"use client";

import { useToast } from "@/shared/components/ui/toast";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { socialPostInputSchema } from "@/features/marketing/schemas/marketing.schema";
import { createSocialPostAction, updateSocialPostAction } from "@/features/marketing/actions/social.action";
import { Button, selectClass } from "@/shared/components/ui/button";
import { SOCIAL_CONTENT_LIMITS } from "@/features/marketing/utils/social-state";
import type { SocialPostDto } from "@/server/marketing/social/post.service";

type FormValues = { socialAccountId: string; content: string };

export function SocialPostForm({
  post,
  accounts,
}: {
  post?: SocialPostDto;
  accounts: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(socialPostInputSchema) as unknown as Resolver<FormValues>,
    mode: "onBlur",
    defaultValues: post ? { socialAccountId: post.socialAccountId, content: post.content } : { socialAccountId: accounts[0]?.id ?? "", content: "" },
  });
  const content = watch("content") ?? "";
  const limit = SOCIAL_CONTENT_LIMITS.facebook_page;

  const submit = (values: FormValues) =>
    startTransition(async () => {
      const result = post
        ? await updateSocialPostAction(post.id, { ...values, expectedVersion: post.version })
        : await createSocialPostAction(values);
      if (!result.ok) return toast.fromError(result.error);
      if (post) {
        toast.success("Draft saved.");
        router.refresh();
      } else {
        router.push(`/marketing/social/posts/${result.data.id}`);
        router.refresh();
      }
    });

  if (accounts.length === 0) {
    return (
      <p className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border-control)] p-6 text-sm text-[var(--color-text-secondary)]">
        Connect a Facebook Page before writing a post. <Link className="underline" href="/marketing/social">Go to social accounts</Link>
      </p>
    );
  }

  return (
    <form noValidate onSubmit={handleSubmit(submit)} className="grid gap-6 xl:grid-cols-2">
      <div className="space-y-5">
        <div className="space-y-1.5">
          <label htmlFor="socialAccountId" className="text-sm font-semibold">Page</label>
          <select id="socialAccountId" className={selectClass} {...register("socialAccountId")}>
            {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
          {errors.socialAccountId?.message && <p role="alert" className="text-xs text-[#c0392b]">{errors.socialAccountId.message}</p>}
        </div>
        <div className="space-y-1.5">
          <label htmlFor="content" className="text-sm font-semibold">Post text</label>
          <textarea id="content" rows={8} aria-invalid={Boolean(errors.content)} aria-describedby="content-count" className="w-full rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] p-3 text-sm focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]" {...register("content")} />
          <p id="content-count" aria-live="polite" className={`text-xs ${content.length > limit ? "text-[#c0392b]" : "text-[var(--color-text-secondary)]"}`}>
            {content.length} / {limit} characters
          </p>
          {errors.content?.message && <p role="alert" className="text-xs text-[#c0392b]">{errors.content.message}</p>}
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Link href="/marketing/social" className="inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-border-control)] px-4 text-sm">Back</Link>
          <Button type="submit" variant="primary" disabled={pending}>{pending ? "Saving…" : post ? "Save draft" : "Create draft"}</Button>
        </div>
        <p className="text-xs text-[var(--color-text-secondary)]">A draft is never published. Scheduling is a separate step.</p>
      </div>
      <aside aria-label="Post preview" className="space-y-2 xl:sticky xl:top-6 xl:self-start">
        <h2 className="text-base font-semibold">Preview</h2>
        <div className="whitespace-pre-wrap break-words rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 text-sm">
          {content.trim() || "Your post text appears here."}
        </div>
      </aside>
    </form>
  );
}
