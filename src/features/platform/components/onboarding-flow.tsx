"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { InviteRows } from "@/features/platform/components/invite-rows";
import { panel } from "@/features/platform/components/platform-shell";
import { AnimatedIcon } from "@/shared/components/portal/animated-icon";
import { IconArrowRight } from "@/shared/components/ui/brand-icons";
import { getApplication, type ApplicationId } from "@/shared/domain/applications";
import { cn } from "@/shared/lib/utils";

export function OnboardingFlow({ organizationName, apps, isOwner }: { organizationName: string; apps: ApplicationId[]; isOwner: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<0 | 1>(0);
  const [sent, setSent] = useState(0);

  return (
    <div>
      <ol aria-label="Onboarding progress" className="mb-6 flex justify-center gap-2">
        {[0, 1].map((i) => (
          <li key={i} aria-current={step === i ? "step" : undefined} className={cn("h-1.5 rounded-full transition-all duration-500", step === i ? "w-10 bg-[var(--color-text-primary)]" : "w-4 bg-[var(--color-border-control)]")}>
            <span className="sr-only">Step {i + 1} of 2</span>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <section className={cn(panel, "relative overflow-hidden text-center")} aria-labelledby="ready-title">
          <div aria-hidden="true" className="pointer-events-none absolute -top-24 left-1/2 h-60 w-60 -translate-x-1/2 rounded-full bg-[var(--color-action-primary)] opacity-25 blur-3xl" />
          <div className="relative flex justify-center">
            <AnimatedIcon icon="wired-lineal-37-check-hover-pinch.gif" size={88} play="always" />
          </div>
          <p className="relative mt-6 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-text-secondary)]">{organizationName}</p>
          <h1 id="ready-title" className="relative mt-3 font-[family-name:var(--font-heading)] text-[34px] leading-[1.05] tracking-[-0.04em] text-[var(--color-text-primary)] sm:text-[46px]">
            Your organization is ready!
          </h1>
          <p className="relative mx-auto mt-4 max-w-md text-base leading-relaxed text-[var(--color-text-secondary)]">
            Welcome to your new business workspace. Let&apos;s build something great with AnOps.
          </p>
          <ul className="relative mt-8 flex flex-wrap justify-center gap-4">
            {apps.map((id, index) => (
              <li key={id} className="flex w-20 flex-col items-center gap-2 motion-safe:animate-[anops-rise_500ms_var(--ease-out)_both]" style={{ animationDelay: `${300 + index * 120}ms` }}>
                <AnimatedIcon icon={getApplication(id).icon} size={60} play="always" />
                <span className="text-xs font-medium text-[var(--color-text-primary)]">{getApplication(id).name}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => (isOwner ? setStep(1) : router.push("/anops"))}
            className="relative mt-10 inline-flex h-12 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-8 text-sm font-semibold text-[#111F1D] hover:bg-[var(--color-action-hover)]"
          >
            {isOwner ? "Continue" : "Open AnOps"}
            <IconArrowRight size={14} />
          </button>
        </section>
      )}

      {step === 1 && (
        <section className={cn(panel, "motion-safe:animate-[anops-rise_450ms_var(--ease-out)_both]")} aria-labelledby="invite-title">
          <div className="flex items-start gap-4">
            <AnimatedIcon icon="wired-lineal-957-avatars-team-work-hover-pinch.webp" size={56} play="always" />
            <div>
              <h1 id="invite-title" className="font-[family-name:var(--font-heading)] text-2xl font-semibold tracking-[-0.03em] text-[var(--color-text-primary)] sm:text-3xl">
                Invite your colleagues
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">
                Users are unlimited on every plan. Each person receives a secure, single-use link that expires in 7 days.
              </p>
            </div>
          </div>
          <div className="mt-6">
            <InviteRows canInviteAdmins={isOwner} onDone={(outcomes) => setSent((n) => n + outcomes.filter((o) => o.status === "sent").length)} />
          </div>
          <div className="mt-6 flex items-center justify-between gap-3 border-t border-[var(--color-border-subtle)] pt-5">
            <span className="text-sm text-[var(--color-text-secondary)]">{sent > 0 ? `${sent} invitation${sent === 1 ? "" : "s"} sent` : "You can also invite people later from Members."}</span>
            <Link href="/anops" className="inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)] underline underline-offset-4">
              {sent > 0 ? "Go to my workspace" : "Skip for now"}
              <IconArrowRight size={13} />
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
