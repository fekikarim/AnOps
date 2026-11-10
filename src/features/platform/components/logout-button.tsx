"use client";

import { useFormStatus } from "react-dom";
import { logoutAction } from "@/features/auth/actions/auth.action";
import { IconLogOut } from "@/shared/components/ui/brand-icons";
import { cn } from "@/shared/lib/utils";

function Inner({ className }: { className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label="Sign out"
      title="Sign out"
      className={cn(
        "group inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-control)] px-2.5 text-sm font-medium text-[var(--color-text-secondary)] transition-colors duration-200 hover:bg-[var(--color-status-error-bg)] hover:text-[var(--color-status-error-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] disabled:cursor-wait disabled:opacity-70",
        className
      )}
    >
      {pending ? (
        <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : (
        <IconLogOut size={16} className="transition-transform duration-200 motion-safe:group-hover:translate-x-0.5" />
      )}
      <span className="hidden md:inline">{pending ? "Signing out…" : "Sign out"}</span>
    </button>
  );
}

/** Signs the person out (server action) and returns them to the sign-in page. Icon-only on phones, labelled from md up. */
export function LogoutButton({ className }: { className?: string }) {
  return (
    <form action={logoutAction}>
      <Inner className={className} />
    </form>
  );
}
