import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

/** Centered, branded frame for activation, invitation and onboarding screens. */
export function PlatformShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="relative flex min-h-[100dvh] flex-col overflow-x-hidden bg-[var(--color-bg-canvas)]">
      <div aria-hidden="true" className="portal-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_70%_55%_at_50%_0%,black,transparent)]" />
      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-[-260px] h-[520px] w-[760px] -translate-x-1/2 rounded-full bg-[var(--color-action-primary)] opacity-[0.12] blur-[120px]" />
      <header className="relative mx-auto flex w-full max-w-[1100px] items-center px-4 pt-[max(24px,env(safe-area-inset-top))] sm:px-6">
        <Link href="/" aria-label="AnOps home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand-kit/01-brand-identity/logos/anops-logo-horizontal-dark.svg" alt="" className="block h-7 dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand-kit/01-brand-identity/logos/anops-logo-horizontal-white.svg" alt="" className="hidden h-7 dark:block" />
        </Link>
      </header>
      <main className="relative flex flex-1 items-center justify-center px-4 py-10 sm:px-6">
        <div className={cn("w-full motion-safe:animate-[anops-rise_600ms_var(--ease-out)_both]", wide ? "max-w-[880px]" : "max-w-[520px]")}>{children}</div>
      </main>
    </div>
  );
}

export const panel = "rounded-[24px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-6 shadow-[0_40px_90px_-50px_rgba(17,31,29,0.55)] sm:p-9";
