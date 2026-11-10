import Link from "next/link";
import { FileSearch, Inbox, RotateCw, TriangleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ButtonLink, buttonClass } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

export type EmptyStateVariant = "empty" | "filtered" | "error";

const VARIANTS: Record<EmptyStateVariant, { icon: LucideIcon; iconWrap: string }> = {
  empty: { icon: Inbox, iconWrap: "bg-[var(--color-bg-subtle)] text-[var(--color-text-primary)]" },
  filtered: { icon: FileSearch, iconWrap: "bg-[var(--color-bg-subtle)] text-[var(--color-text-primary)]" },
  error: { icon: TriangleAlert, iconWrap: "bg-[var(--color-status-error-bg)] text-[var(--color-status-error)]" },
};

/**
 * One pattern for all table states.
 * - empty: nothing exists yet (primary action creates the first record, only when permitted)
 * - filtered: records exist but none match the current search or filters (action clears them)
 * - error: the request failed (action retries); never styled like an empty dataset
 */
export function EmptyState({
  title,
  description,
  actionHref,
  actionLabel,
  actionIcon: ActionIcon,
  variant = "empty",
  icon,
  secondaryHref,
  secondaryLabel,
  className,
}: {
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
  actionIcon?: LucideIcon;
  variant?: EmptyStateVariant;
  icon?: LucideIcon;
  secondaryHref?: string;
  secondaryLabel?: string;
  className?: string;
}) {
  const config = VARIANTS[variant];
  const Icon = icon ?? config.icon;
  const isError = variant === "error";
  return (
    <div
      role={isError ? "alert" : "status"}
      className={cn(
        "flex flex-col items-center rounded-[var(--radius-card)] border border-dashed bg-[var(--color-bg-surface)] px-6 py-12 text-center",
        isError ? "border-[var(--color-status-error)]" : "border-[var(--color-border-control)]",
        className
      )}
    >
      <span className={cn("flex size-12 items-center justify-center rounded-full", config.iconWrap)}>
        <Icon aria-hidden className="size-6" />
      </span>
      <p className="mt-4 text-base font-semibold text-[var(--color-text-primary)]">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-[var(--color-text-secondary)]">{description}</p>
      {(actionHref || secondaryHref) && (
        <div className="mt-6 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          {actionHref && actionLabel && (
            <ButtonLink href={actionHref} variant={isError || variant === "filtered" ? "secondary" : "primary"}>
              {isError ? <RotateCw aria-hidden className="size-4" /> : ActionIcon ? <ActionIcon aria-hidden className="size-4" /> : null}
              {actionLabel}
            </ButtonLink>
          )}
          {secondaryHref && secondaryLabel && (
            <Link href={secondaryHref} className={buttonClass("ghost")}>
              {secondaryLabel}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
