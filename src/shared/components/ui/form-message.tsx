import { cn } from "@/shared/lib/utils";

/** Form-level feedback. role="alert" for errors so screen readers announce failures immediately. */
export function FormMessage({ kind, children }: { kind: "error" | "success"; children: React.ReactNode }) {
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={cn(
        "rounded-[var(--radius-control)] border px-4 py-3 text-sm",
        kind === "error"
          ? "border-[var(--color-status-error)] bg-[var(--color-status-error-bg)] text-[var(--color-status-error)]"
          : "border-[var(--color-status-success)] bg-[var(--color-status-success-bg)] text-[var(--color-status-success)]"
      )}
    >
      {children}
    </div>
  );
}
