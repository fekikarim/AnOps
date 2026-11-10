"use client";

import { Plus, Trash2 } from "lucide-react";
import { StatusBadge } from "@/shared/components/data-display/status-badge";
import { Button } from "@/shared/components/ui/button";
import { Select } from "@/shared/components/ui/form-kit";
import { cn } from "@/shared/lib/utils";
import type { AiFormField, AiProvenance } from "@/server/db/documents";

type Row = Record<string, string>;

const inputClass =
  "min-h-[44px] w-full rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-[3px] focus:ring-[var(--color-focus-ring)] disabled:opacity-60 aria-[invalid=true]:border-[var(--color-status-error)]";

export function parseClientRows(value: unknown): Row[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as Row[]) : [];
  } catch {
    return [];
  }
}

/**
 * Line items (order lines, BOM components, receipt lines). Each row is a small card that becomes a
 * single wrapped line when the thread is wide, so it works the same on a phone and at a desk. Cells the
 * AI guessed or looked up are marked; anything the person edits becomes theirs.
 */
export function LinesField({
  id,
  field,
  value,
  provenance,
  errors,
  disabled,
  onChange,
  onCellEdit,
}: {
  id: string;
  field: AiFormField;
  value: string;
  provenance?: Record<string, AiProvenance>[];
  errors: Record<string, string>;
  disabled?: boolean;
  onChange: (rows: Row[]) => void;
  onCellEdit?: (row: number, column: string) => void;
}) {
  const spec = field.lines!;
  const rows = parseClientRows(value);
  const editable = spec.columns.filter((c) => c.kind !== "readonly");

  const setCell = (index: number, column: string, cell: string) => {
    onChange(rows.map((r, i) => (i === index ? { ...r, [column]: cell } : r)));
    onCellEdit?.(index, column);
  };
  const add = () => onChange([...rows, Object.fromEntries(spec.columns.map((c) => [c.name, ""]))]);
  const remove = (index: number) => onChange(rows.filter((_, i) => i !== index));
  const fill = () => {
    if (!spec.fillRemaining) return;
    const { from, to } = spec.fillRemaining;
    onChange(rows.map((r) => ({ ...r, [to]: r[from] ?? r[to] ?? "" })));
    rows.forEach((_, i) => onCellEdit?.(i, to));
  };

  return (
    <div className="space-y-3" id={id}>
      {rows.length === 0 && <p className="rounded-[var(--radius-control)] border border-dashed border-[var(--color-border-control)] px-3 py-4 text-center text-sm text-[var(--color-text-secondary)]">No lines yet.</p>}
      <ol className="space-y-3">
        {rows.map((row, index) => (
          <li key={index} className="@container rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] p-3">
            <div className="grid gap-3 @md:grid-cols-2 @3xl:grid-cols-4">
              {spec.columns.map((c) => {
                const p = provenance?.[index]?.[c.name];
                const error = errors[`${field.name}.${index}.${c.name}`];
                const cellId = `${id}-${index}-${c.name}`;
                return (
                  <div key={c.name} className={cn("min-w-0 space-y-1", c.kind === "select" && "@md:col-span-2")}>
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor={cellId} className="text-xs font-semibold text-[var(--color-text-secondary)]">{c.label}</label>
                      {p === "inferred" && <StatusBadge label="AI guess" tone="warning" />}
                      {p === "found" && c.kind !== "readonly" && <StatusBadge label="Found" tone="success" />}
                    </div>
                    {c.kind === "readonly" ? (
                      <p id={cellId} className={cn("flex min-h-[44px] items-center break-words text-sm text-[var(--color-text-primary)]", c.align === "right" && "justify-end tabular-nums")}>{row[c.name] || "None"}</p>
                    ) : c.kind === "select" ? (
                      <Select id={cellId} disabled={disabled} value={row[c.name] ?? ""} aria-invalid={Boolean(error) || undefined} onChange={(e) => setCell(index, c.name, e.target.value)} className={cn(p === "inferred" && "border-[var(--color-status-warning)]")}>
                        <option value="">Choose…</option>
                        {c.options?.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </Select>
                    ) : (
                      <input id={cellId} disabled={disabled} inputMode="decimal" value={row[c.name] ?? ""} placeholder={c.placeholder} aria-invalid={Boolean(error) || undefined} onChange={(e) => setCell(index, c.name, e.target.value)} className={cn(inputClass, p === "inferred" && "border-[var(--color-status-warning)]")} />
                    )}
                    {error && <p role="alert" className="text-xs text-[var(--color-status-error-fg)]">{error}</p>}
                  </div>
                );
              })}
            </div>
            {!spec.fixedRows && (
              <div className="mt-2 flex justify-end">
                <button type="button" disabled={disabled} onClick={() => remove(index)} aria-label={`Remove line ${index + 1}`} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-xs font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-status-error)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]">
                  <Trash2 aria-hidden className="size-4" />
                  Remove
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        {!spec.fixedRows && rows.length < spec.maxRows && (
          <Button disabled={disabled} onClick={add}>
            <Plus aria-hidden className="size-4" />
            {spec.addLabel ?? "Add line"}
          </Button>
        )}
        {spec.fillRemaining && rows.length > 0 && (
          <Button disabled={disabled} onClick={fill}>Fill all remaining</Button>
        )}
      </div>
      {editable.length === 0 && null}
    </div>
  );
}
