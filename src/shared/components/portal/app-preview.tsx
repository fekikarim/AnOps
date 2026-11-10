import type { App } from "@/shared/config/catalog";
import { cn } from "@/shared/lib/utils";

const tone = (value: string) => {
  const v = value.toLowerCase();
  if (/(paid|completed|sent|answered|active|published|approve$|ready)/.test(v)) return "bg-[var(--color-status-success-bg)] text-[var(--color-status-success)]";
  if (/(overdue|blocked)/.test(v)) return "bg-[var(--color-status-error-bg)] text-[var(--color-status-error)]";
  if (/(awaiting|pending|review|partially|scheduled|in progress|invited|draft|approved)/.test(v))
    return "bg-[var(--color-status-warning-bg)] text-[var(--color-status-warning)]";
  return "bg-[var(--color-status-neutral-bg)] text-[var(--color-status-neutral)]";
};

/**
 * Illustrative product frame rendered from data. Not a screenshot: it mirrors the real screens' structure
 * (KPIs + records + status) with example values, and is labelled as such.
 */
export function AppPreview({ app, className, label = true }: { app: App; className?: string; label?: boolean }) {
  const { preview } = app;
  return (
    <figure
      className={cn(
        "relative overflow-hidden rounded-[16px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] shadow-[0_30px_70px_-40px_rgba(17,31,29,0.45)]",
        className
      )}
      style={{ ["--accent" as string]: app.accent }}
    >
      <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-4 py-2.5">
        <span aria-hidden="true" className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-border-subtle)]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-border-subtle)]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-border-subtle)]" />
        </span>
        <span className="ml-2 truncate text-xs font-medium text-[var(--color-text-secondary)]">
          AnOps · {app.name} · {preview.title}
        </span>
        <span aria-hidden="true" className="ml-auto h-2 w-10 rounded-full bg-[var(--accent)]" />
      </div>
      <div className="p-4 sm:p-5">
        <dl className="grid grid-cols-3 gap-2 sm:gap-3">
          {preview.kpis.map((kpi) => (
            <div key={kpi.label} className="min-w-0 rounded-[10px] border border-[var(--color-border-subtle)] p-2.5 sm:p-3">
              <dt className="truncate text-[11px] text-[var(--color-text-secondary)] sm:text-xs">{kpi.label}</dt>
              <dd className="mt-1 truncate font-[family-name:var(--font-heading)] text-base font-semibold tracking-[-0.02em] text-[var(--color-text-primary)] sm:text-lg">
                {kpi.value}
              </dd>
            </div>
          ))}
        </dl>
        <table className="mt-4 w-full table-fixed text-left text-xs sm:text-sm">
          <thead>
            <tr className="text-[var(--color-text-secondary)]">
              {preview.columns.map((column) => (
                <th key={column} scope="col" className="pb-2 font-medium">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-t border-[var(--color-border-subtle)]">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="truncate py-2.5 pr-2 text-[var(--color-text-primary)]">
                    {cellIndex === row.length - 1 ? (
                      <span className={cn("inline-block max-w-full truncate rounded-full px-2 py-0.5 text-[11px] font-semibold", tone(cell))}>{cell}</span>
                    ) : (
                      cell
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {label && (
        <figcaption className="border-t border-[var(--color-border-subtle)] px-4 py-2 text-[11px] text-[var(--color-text-secondary)]">
          Illustrative example with sample data
        </figcaption>
      )}
    </figure>
  );
}
