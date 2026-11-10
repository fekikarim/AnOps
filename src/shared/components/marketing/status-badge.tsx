import { statusMeta, type AppStatus } from "@/shared/config/catalog";

const tone: Record<AppStatus, string> = {
  "in-progress": "bg-[var(--color-status-warning-bg)] text-[var(--color-status-warning)]",
  "coming-soon": "bg-[var(--color-status-neutral-bg)] text-[var(--color-status-neutral)]",
  available: "bg-[var(--color-status-success-bg)] text-[var(--color-status-success)]",
};

export function StatusBadge({ status }: { status: AppStatus }) {
  const meta = statusMeta[status];
  return (
    <span
      title={meta.label}
      className={`inline-flex items-center rounded-[var(--radius-pill)] px-2.5 py-1 text-xs font-semibold ${tone[status]}`}
    >
      <span className="sr-only">Status: </span>
      {meta.abbr}
    </span>
  );
}
