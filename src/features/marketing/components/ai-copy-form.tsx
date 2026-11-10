"use client";

import { useToast } from "@/shared/components/ui/toast";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { aiRequestSchema, type AiRequestInput } from "@/features/marketing/schemas/marketing.schema";
import { generateCopyAction } from "@/features/marketing/actions/ai.action";
import { Button, selectClass, textareaClass } from "@/shared/components/ui/button";
import { TextField } from "@/shared/components/ui/text-field";
import { AI_CHANNELS, AI_LANGUAGES, AI_TONES } from "@/features/marketing/types/constants";
import { CHANNEL_LABELS } from "@/features/marketing/labels";

const TONE_LABELS: Record<(typeof AI_TONES)[number], string> = {
  friendly: "Friendly",
  professional: "Professional",
  playful: "Playful",
  urgent: "Urgent",
  formal: "Formal",
};
const LANGUAGE_LABELS: Record<(typeof AI_LANGUAGES)[number], string> = { en: "English", fr: "Français", ar: "العربية" };
const CHANNEL_NAMES: Record<(typeof AI_CHANNELS)[number], string> = { email: CHANNEL_LABELS.email, sms: CHANNEL_LABELS.sms, telegram: CHANNEL_LABELS.telegram, facebook_page: "Facebook Page" };

/** Brief form. The brief is sent once to the server; the server builds the prompt and keeps it out of the browser. */
export function AiCopyForm({ aiReady, initial }: { aiReady: boolean; initial?: Partial<AiRequestInput> }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const { register, handleSubmit, formState: { errors } } = useForm<AiRequestInput>({
    resolver: zodResolver(aiRequestSchema) as unknown as Resolver<AiRequestInput>,
    mode: "onBlur",
    defaultValues: {
      channel: initial?.channel ?? "email",
      tone: initial?.tone ?? "friendly",
      language: initial?.language ?? "en",
      goal: initial?.goal ?? "",
      productDescription: initial?.productDescription ?? "",
      targetAudience: initial?.targetAudience ?? "",
    },
  });

  const submit = (values: AiRequestInput) =>
    startTransition(async () => {
      const result = await generateCopyAction(values);
      if (!result.ok) return toast.fromError(result.error);
      router.push(`/marketing/ai/${result.data.id}`);
      router.refresh();
    });

  return (
    <form noValidate onSubmit={handleSubmit(submit)} className="grid gap-4 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 sm:grid-cols-2">
      {!aiReady && (
        <div role="status" className="sm:col-span-2 rounded-[var(--radius-control)] bg-[var(--color-status-warning-bg)] p-3 text-sm text-[var(--color-status-warning)]">
          AI copy is not configured on this server. Generation is disabled; nothing will be invented in its place.
        </div>
      )}
      <div className="space-y-1.5">
        <label htmlFor="channel" className="text-sm font-semibold">Channel</label>
        <select id="channel" className={selectClass} {...register("channel")}>
          {AI_CHANNELS.map((item) => <option key={item} value={item}>{CHANNEL_NAMES[item]}</option>)}
        </select>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="tone" className="text-sm font-semibold">Tone</label>
        <select id="tone" className={selectClass} {...register("tone")}>
          {AI_TONES.map((item) => <option key={item} value={item}>{TONE_LABELS[item]}</option>)}
        </select>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="language" className="text-sm font-semibold">Language</label>
        <select id="language" className={selectClass} {...register("language")}>
          {AI_LANGUAGES.map((item) => <option key={item} value={item}>{LANGUAGE_LABELS[item]}</option>)}
        </select>
      </div>
      <TextField label="Campaign goal (optional)" maxLength={200} error={errors.goal?.message} {...register("goal")} />
      <div className="space-y-1.5 sm:col-span-2">
        <label htmlFor="productDescription" className="text-sm font-semibold">Product or service</label>
        <textarea id="productDescription" rows={3} maxLength={800} aria-invalid={Boolean(errors.productDescription)} className={textareaClass} {...register("productDescription")} />
        {errors.productDescription?.message && <p role="alert" className="text-xs text-[#c0392b]">{errors.productDescription.message}</p>}
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <label htmlFor="targetAudience" className="text-sm font-semibold">Target audience</label>
        <input id="targetAudience" maxLength={300} aria-invalid={Boolean(errors.targetAudience)} className="min-h-[44px] w-full rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-sm" {...register("targetAudience")} />
        {errors.targetAudience?.message && <p role="alert" className="text-xs text-[#c0392b]">{errors.targetAudience.message}</p>}
      </div>
      <div className="flex justify-end sm:col-span-2">
        <Button type="submit" variant="primary" disabled={pending || !aiReady}>{pending ? "Generating…" : "Generate draft"}</Button>
      </div>
      <p className="text-xs text-[var(--color-text-secondary)] sm:col-span-2">Drafts are never sent or published. You review, edit and approve each one before it is used. Do not paste personal data about customers.</p>
    </form>
  );
}
