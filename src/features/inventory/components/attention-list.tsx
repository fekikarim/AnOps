import Link from "next/link";
import { ArrowRight, CircleCheck, Factory, Boxes, Truck, TriangleAlert, CircleAlert, Info } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { StatusBadge, type BadgeTone } from "@/shared/components/data-display/status-badge";
import type { AttentionItem, AttentionModule, AttentionSeverity } from "@/features/inventory/attention";

const MODULE_ICONS: Record<AttentionModule, LucideIcon> = { inventory: Boxes, purchasing: Truck, manufacturing: Factory };
const MODULE_LABELS: Record<AttentionModule, string> = { inventory: "Inventory", purchasing: "Purchasing", manufacturing: "Manufacturing" };
const SEVERITY: Record<AttentionSeverity, { label: string; tone: BadgeTone; icon: LucideIcon }> = {
  critical: { label: "Blocked", tone: "error", icon: CircleAlert },
  warning: { label: "Needs action", tone: "warning", icon: TriangleAlert },
  info: { label: "To do", tone: "info", icon: Info },
};

/** Cross-module "what needs my attention" list. Every row names the problem and links straight to its resolution. */
export function AttentionList({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <div role="status" className="flex items-start gap-3 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-status-success-bg)] text-[var(--color-status-success)]">
          <CircleCheck aria-hidden className="size-5" />
        </span>
        <div>
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">Nothing needs your attention</p>
          <p className="text-sm text-[var(--color-text-secondary)]">No low stock, waiting orders or blocked production. New issues will show up here.</p>
        </div>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-[var(--color-border-subtle)] overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
      {items.map((item) => {
        const ModuleIcon = MODULE_ICONS[item.module];
        const severity = SEVERITY[item.severity];
        return (
          <li key={item.id}>
            <Link
              href={item.href}
              className="group flex min-h-[72px] items-start gap-3 p-4 transition-colors hover:bg-[var(--color-bg-subtle)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-[var(--color-focus-ring)]"
            >
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] text-[var(--color-text-primary)]">
                <ModuleIcon aria-hidden className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-[var(--color-text-primary)]">{item.title}</span>
                  <StatusBadge label={severity.label} tone={severity.tone} />
                </span>
                <span className="mt-0.5 block text-sm text-[var(--color-text-secondary)]">{item.detail}</span>
                <span className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-text-primary)] underline decoration-[var(--color-border-control)] underline-offset-4 group-hover:decoration-current">
                  {item.actionLabel}
                  <ArrowRight aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
                </span>
                <span className="sr-only"> ({MODULE_LABELS[item.module]})</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
