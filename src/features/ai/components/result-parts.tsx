"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, PencilLine, Sparkles } from "lucide-react";
import { LinesField } from "@/features/ai/components/lines-field";
import { useThreadActions } from "@/features/ai/components/thread-actions";
import { StatusBadge } from "@/shared/components/data-display/status-badge";
import { Button } from "@/shared/components/ui/button";
import { Field, FieldError, Select, Textarea } from "@/shared/components/ui/form-kit";
import { cn } from "@/shared/lib/utils";
import type { AiAction, AiDiffRow, AiDraftPromptPart, AiEntryChoicePart, AiFormPart, AiProvenance, AiRecordCardPart, AiRecordTablePart } from "@/server/db/documents";

const inputClass =
  "min-h-[44px] w-full rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-[3px] focus:ring-[var(--color-focus-ring)] disabled:opacity-60 aria-[invalid=true]:border-[var(--color-status-error)]";

function ActionButtons({ actions, subject }: { actions: AiAction[]; subject: string }) {
  const { run, busy } = useThreadActions();
  if (actions.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((a) => (
        <Button
          key={`${a.command}-${a.label}`}
          disabled={busy}
          aria-label={`${a.label}: ${subject}`}
          onClick={() => void run({ command: a.command, step: a.step ?? "start", args: a.args, label: `${a.label}: ${subject}` })}
          className="min-h-[44px] px-3"
        >
          {a.label}
        </Button>
      ))}
    </div>
  );
}

/** A table on tablet and desktop, a list of cards on phones: same data, same actions, no horizontal scrolling on small screens. */
export function RecordTable({ part }: { part: AiRecordTablePart }) {
  const { run, busy } = useThreadActions();
  const [first, ...rest] = part.columns;
  const paging = part.paging;

  return (
    <section aria-label={part.title} className="@container overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
      <header className="flex items-baseline justify-between gap-3 border-b border-[var(--color-border-subtle)] px-4 py-3">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{part.title}</h3>
        <span className="text-xs tabular-nums text-[var(--color-text-secondary)]">{part.total} total</span>
      </header>

      {part.rows.length === 0 ? (
        <p role="status" className="px-4 py-8 text-center text-sm text-[var(--color-text-secondary)]">{part.emptyMessage}</p>
      ) : (
        <>
          <div className="hidden overflow-x-auto @2xl:block">
            <table className="w-full text-sm">
              <caption className="sr-only">{part.title}</caption>
              <thead>
                <tr className="text-left text-xs text-[var(--color-text-secondary)]">
                  {part.columns.map((c) => (
                    <th key={c.key} scope="col" className={cn("px-4 py-2 font-semibold", c.align === "right" && "text-right")}>{c.label}</th>
                  ))}
                  <th scope="col" className="px-4 py-2 font-semibold">Status</th>
                  <th scope="col" className="px-4 py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-subtle)]">
                {part.rows.map((row) => (
                  <tr key={row.id} className="align-middle">
                    {part.columns.map((c, i) =>
                      i === 0 ? (
                        <th key={c.key} scope="row" className="px-4 py-1.5 text-left font-medium whitespace-nowrap text-[var(--color-text-primary)]">{row.cells[c.key]}</th>
                      ) : (
                        <td key={c.key} className={cn("max-w-[16rem] truncate px-4 py-1.5 text-[var(--color-text-primary)]", c.align === "right" && "text-right tabular-nums")}>{row.cells[c.key]}</td>
                      )
                    )}
                    <td className="px-4 py-1.5">{row.badge && <StatusBadge label={row.badge.label} tone={row.badge.tone} />}</td>
                    <td className="px-4 py-1.5"><div className="flex justify-end"><ActionButtons actions={row.actions ?? []} subject={row.cells[first.key]} /></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="divide-y divide-[var(--color-border-subtle)] @2xl:hidden">
            {part.rows.map((row) => (
              <li key={row.id} className="space-y-2 px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 break-words text-sm font-semibold text-[var(--color-text-primary)]">{row.cells[first.key]}</p>
                  {row.badge && <StatusBadge label={row.badge.label} tone={row.badge.tone} />}
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
                  {rest.map((c) => (
                    <div key={c.key} className="contents">
                      <dt className="text-[var(--color-text-secondary)]">{c.label}</dt>
                      <dd className="min-w-0 break-words text-right text-[var(--color-text-primary)]">{row.cells[c.key]}</dd>
                    </div>
                  ))}
                </dl>
                <ActionButtons actions={row.actions ?? []} subject={row.cells[first.key]} />
              </li>
            ))}
          </ul>
        </>
      )}

      {paging && paging.totalPages > 1 && (
        <footer className="flex items-center justify-between gap-2 border-t border-[var(--color-border-subtle)] px-3 py-2">
          <Button
            variant="ghost"
            disabled={busy || paging.page <= 1}
            onClick={() => void run({ command: paging.command, step: "start", args: { ...paging.args, page: paging.page - 1 }, label: `${part.title}: page ${paging.page - 1}` })}
          >
            <ChevronLeft aria-hidden className="size-4" />
            Previous
          </Button>
          <span className="text-xs tabular-nums text-[var(--color-text-secondary)]">Page {paging.page} of {paging.totalPages}</span>
          <Button
            variant="ghost"
            disabled={busy || paging.page >= paging.totalPages}
            onClick={() => void run({ command: paging.command, step: "start", args: { ...paging.args, page: paging.page + 1 }, label: `${part.title}: page ${paging.page + 1}` })}
          >
            Next
            <ChevronRight aria-hidden className="size-4" />
          </Button>
        </footer>
      )}
    </section>
  );
}

export function RecordCard({ part }: { part: AiRecordCardPart }) {
  return (
    <section aria-label={part.title} className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="break-words text-base font-semibold text-[var(--color-text-primary)]">{part.title}</h3>
          {part.subtitle && <p className="text-sm text-[var(--color-text-secondary)]">{part.subtitle}</p>}
        </div>
        <div className="flex flex-wrap gap-1.5">{part.badges?.map((b) => <StatusBadge key={b.label} label={b.label} tone={b.tone} />)}</div>
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {part.fields.map((f) => (
          <div key={f.label} className="flex items-baseline justify-between gap-3 border-b border-[var(--color-border-subtle)] pb-1.5 text-sm">
            <dt className="text-[var(--color-text-secondary)]">{f.label}</dt>
            <dd className="min-w-0 break-words text-right font-medium tabular-nums text-[var(--color-text-primary)]">{f.value}</dd>
          </div>
        ))}
      </dl>
      {part.sections?.map((s) => (
        <div key={s.title} className="mt-4">
          <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">{s.title}</h4>
          <dl className="mt-1 divide-y divide-[var(--color-border-subtle)]">
            {s.rows.map((r) => (
              <div key={r.label} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
                <dt className="text-[var(--color-text-secondary)]">{r.label}</dt>
                <dd className="font-medium tabular-nums text-[var(--color-text-primary)]">{r.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
      {part.actions && part.actions.length > 0 && (
        <div className="mt-4 border-t border-[var(--color-border-subtle)] pt-3">
          <ActionButtons actions={part.actions} subject={part.title} />
        </div>
      )}
    </section>
  );
}

/** Before and after, from the server's own comparison of the validated change. */
export function DiffList({ rows }: { rows: AiDiffRow[] }) {
  if (rows.length === 0) return null;
  return (
    <dl className="mt-3 divide-y divide-[var(--color-border-subtle)] rounded-[var(--radius-control)] border border-[var(--color-border-subtle)]">
      {rows.map((r) => (
        <div key={r.label} className="grid gap-0.5 px-3 py-2 text-sm sm:grid-cols-[9rem_1fr] sm:gap-3">
          <dt className="text-[var(--color-text-secondary)]">{r.label}</dt>
          <dd className="min-w-0 break-words text-[var(--color-text-primary)]">
            {r.before !== undefined && (
              <>
                <span className="text-[var(--color-text-secondary)] line-through decoration-[var(--color-text-secondary)]/60">{r.before || "empty"}</span>
                <span aria-hidden className="mx-2 text-[var(--color-text-secondary)]">→</span>
                <span className="sr-only"> changed to </span>
              </>
            )}
            <span className="font-medium">{r.after || "empty"}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function GuidedForm({ part }: { part: AiFormPart }) {
  const { run, busy } = useThreadActions();
  const draft = part.draft;
  const [values, setValues] = useState<Record<string, string | boolean>>(() => Object.fromEntries(part.fields.map((f) => [f.name, f.value ?? (f.kind === "checkbox" ? false : "")])));
  const [prov, setProv] = useState<Record<string, AiProvenance>>(draft?.provenance ?? {});
  const [lineProv, setLineProv] = useState<Record<string, Record<string, AiProvenance>[]>>(draft?.lineProvenance ?? {});
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<null | "submitted" | "refined">(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [change, setChange] = useState("");

  const missing = part.fields.some((f) => f.required && f.kind !== "checkbox" && String(values[f.name] ?? "").trim() === "");
  const edit = (name: string, value: string | boolean) => {
    setValues((v) => ({ ...v, [name]: value }));
    if (draft) setProv((p) => ({ ...p, [name]: "you" }));
  };

  // A question about a field disappears once the field has a value; general questions stay.
  const openQuestions = (draft?.questions ?? []).filter((q) => !q.field || String(values[q.field] ?? "").trim() === "");
  const questionFor = (name: string) => openQuestions.find((q) => q.field === name)?.question;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setPending(true);
    const result = await run({ command: part.command, step: "submit", args: part.context, values: values as Record<string, string | boolean>, label: part.title });
    setPending(false);
    if (result.ok) {
      setDone("submitted");
      return;
    }
    setError(result.error.message ?? "Something went wrong.");
    if (result.error.details) setFieldErrors(result.error.details);
  };

  const refine = async () => {
    const text = change.trim();
    if (text.length < 3 || !draft) return;
    setError(null);
    setPending(true);
    const result = await run({
      command: part.command,
      step: "draft",
      args: draft.targetId ? { targetId: draft.targetId } : {},
      values: values as Record<string, string | boolean>,
      draft: { text, provenance: prov, lineProvenance: lineProv },
      label: text.length > 100 ? `${text.slice(0, 97)}...` : text,
    });
    setPending(false);
    if (result.ok) setDone("refined");
    else setError(result.error.message ?? "Something went wrong.");
  };

  const control = (f: AiFormPart["fields"][number], id: string, invalid: boolean, inferred: boolean) => {
    const common = { id, "aria-invalid": invalid || undefined, "aria-describedby": f.hint ? `${id}-hint` : undefined };
    if (f.kind === "lines" && f.lines) {
      return (
        <LinesField
          id={id}
          field={f}
          value={String(values[f.name] ?? "[]")}
          provenance={lineProv[f.name]}
          errors={fieldErrors}
          disabled={locked}
          onChange={(rows) => edit(f.name, JSON.stringify(rows))}
          onCellEdit={(row, column) =>
            setLineProv((p) => {
              const list = [...(p[f.name] ?? [])];
              while (list.length <= row) list.push({});
              list[row] = { ...list[row], [column]: "you" };
              return { ...p, [f.name]: list };
            })
          }
        />
      );
    }
    if (f.kind === "select")
      return (
        <Select {...common} value={String(values[f.name] ?? "")} onChange={(e) => edit(f.name, e.target.value)} className={cn(inferred && "border-[var(--color-status-warning)]")}>
          {f.options?.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
      );
    if (f.kind === "textarea") return <Textarea {...common} rows={2} value={String(values[f.name] ?? "")} onChange={(e) => edit(f.name, e.target.value)} className={cn(inferred && "border-[var(--color-status-warning)]")} />;
    return (
      <input
        {...common}
        inputMode={f.kind === "number" ? "decimal" : undefined}
        value={String(values[f.name] ?? "")}
        placeholder={f.placeholder}
        onChange={(e) => edit(f.name, e.target.value)}
        className={cn(inputClass, inferred && "border-[var(--color-status-warning)]")}
      />
    );
  };

  const locked = pending || done !== null;

  return (
    <form onSubmit={submit} aria-label={part.title} noValidate className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-base font-semibold text-[var(--color-text-primary)]">{part.title}</h3>
        {draft && <StatusBadge label="AI draft" tone="info" />}
      </div>
      {part.description && <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">{part.description}</p>}

      {draft && openQuestions.length > 0 && (
        <div role="status" className="mt-3 rounded-[var(--radius-control)] bg-[var(--color-status-warning-bg)] p-3 text-sm text-[var(--color-status-warning)]">
          <p className="font-semibold">To finish this draft</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {openQuestions.map((q, i) => (
              <li key={i}>{q.question}</li>
            ))}
          </ul>
        </div>
      )}

      <fieldset disabled={locked} className="mt-4 grid gap-4 sm:grid-cols-2">
        {part.fields.map((f) => {
          const id = `${part.command}-${f.name}`;
          const wide = f.kind === "textarea" || f.kind === "lines";
          const p = prov[f.name];
          const inferred = draft ? p === "inferred" : false;
          const was = draft?.original?.[f.name];
          const changedNow = was !== undefined && String(was) !== String(values[f.name]);
          // A dropdown stores an id; show the person the name it stands for.
          const wasText = was === undefined ? "" : f.kind === "select" ? (f.options?.find((o) => o.value === String(was))?.label ?? String(was)) : String(was);
          const q = questionFor(f.name);

          if (!draft) {
            if (f.kind === "checkbox") {
              return (
                <div key={f.name} className="flex items-start gap-3 sm:col-span-2">
                  <input id={id} type="checkbox" checked={Boolean(values[f.name])} onChange={(e) => edit(f.name, e.target.checked)} className="mt-1 size-5 accent-[var(--color-text-primary)]" />
                  <label htmlFor={id} className="min-h-[28px] text-sm text-[var(--color-text-primary)]">
                    {f.label}
                    {f.hint && <span className="block text-xs text-[var(--color-text-secondary)]">{f.hint}</span>}
                  </label>
                </div>
              );
            }
            return (
              <Field key={f.name} label={f.label} htmlFor={id} required={f.required} hint={f.hint} error={fieldErrors[f.name]} className={cn(wide && "sm:col-span-2")}>
                {control(f, id, Boolean(fieldErrors[f.name]), false)}
              </Field>
            );
          }

          return (
            <div key={f.name} className={cn("min-w-0 space-y-1.5", (wide || f.kind === "checkbox") && "sm:col-span-2")}>
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <label htmlFor={id} className="text-sm font-semibold text-[var(--color-text-primary)]">
                  {f.label}
                  {f.required && <span aria-hidden="true" className="ml-0.5 text-[var(--color-status-error-fg)]">*</span>}
                </label>
                {p && (
                  <span title={PROVENANCE[p].hint}>
                    <StatusBadge label={PROVENANCE[p].label} tone={PROVENANCE[p].tone} />
                  </span>
                )}
              </div>
              {f.kind === "checkbox" ? (
                <div className="flex items-center gap-3">
                  <input id={id} type="checkbox" checked={Boolean(values[f.name])} onChange={(e) => edit(f.name, e.target.checked)} className="size-5 accent-[var(--color-text-primary)]" />
                  <span className="text-sm text-[var(--color-text-secondary)]">{values[f.name] ? "Yes" : "No"}</span>
                </div>
              ) : (
                control(f, id, Boolean(fieldErrors[f.name]), inferred)
              )}
              {changedNow && (
                <p className="text-xs text-[var(--color-text-secondary)]">
                  Was: <span className="line-through">{wasText || "empty"}</span>
                </p>
              )}
              {inferred && <p className="text-xs text-[var(--color-status-warning-fg)]">The AI assumed this. Check it, or change it.</p>}
              {q && <p className="text-xs font-medium text-[var(--color-status-warning-fg)]">{q}</p>}
              {fieldErrors[f.name] ? <FieldError id={`${id}-error`}>{fieldErrors[f.name]}</FieldError> : f.hint ? <p id={`${id}-hint`} className="text-xs text-[var(--color-text-secondary)]">{f.hint}</p> : null}
            </div>
          );
        })}
      </fieldset>

      {draft && done === null && (
        <div className="mt-4 space-y-1.5 border-t border-[var(--color-border-subtle)] pt-3">
          <label htmlFor={`${part.command}-refine`} className="block text-sm font-semibold text-[var(--color-text-primary)]">Ask the AI to change something</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id={`${part.command}-refine`}
              value={change}
              disabled={locked}
              onChange={(e) => setChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void refine();
                }
              }}
              placeholder="For example: make it 15 TND, put it in the Fasteners category"
              className={inputClass}
            />
            <Button onClick={() => void refine()} disabled={locked || busy || change.trim().length < 3} className="sm:shrink-0">
              <Sparkles aria-hidden className="size-4" />
              Update draft
            </Button>
          </div>
        </div>
      )}

      {error && Object.keys(fieldErrors).length === 0 && <FieldError>{error}</FieldError>}
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {done ? (
          <p role="status" className="text-sm text-[var(--color-text-secondary)]">{done === "refined" ? "Updated draft below." : "Sent for your review below."}</p>
        ) : (
          <Button type="submit" variant="primary" disabled={pending || busy || missing}>
            {pending && <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />}
            {part.submitLabel}
          </Button>
        )}
      </div>
    </form>
  );
}

// ─── AI-assisted entry ────────────────────────────────────────────────────────

/** The description box shared by the choice card and the "describe it again" prompt. */
function DescribeBox({
  command,
  args,
  placeholder,
  examples,
  submitLabel,
  onDone,
}: {
  command: string;
  args: Record<string, string | number | boolean>;
  placeholder: string;
  examples: string[];
  submitLabel: string;
  onDone?: () => void;
}) {
  const { run, busy } = useThreadActions();
  const [text, setText] = useState(typeof args.text === "string" ? args.text : "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async (event: React.FormEvent) => {
    event.preventDefault();
    const description = text.trim();
    if (description.length < 3) return;
    setError(null);
    setPending(true);
    const result = await run({ command, step: "draft", args: { ...args, text: description.slice(0, 600) }, draft: { text: description, provenance: {} }, label: description.length > 100 ? `${description.slice(0, 97)}...` : description });
    setPending(false);
    if (result.ok) onDone?.();
    else setError(result.error.message ?? "Something went wrong.");
  };

  return (
    <form onSubmit={go} className="space-y-3">
      <div>
        <label htmlFor={`describe-${command}`} className="mb-1.5 block text-sm font-semibold text-[var(--color-text-primary)]">Describe it in your own words</label>
        <Textarea id={`describe-${command}`} rows={3} value={text} maxLength={2000} placeholder={placeholder} onChange={(e) => setText(e.target.value)} disabled={pending} />
      </div>
      {examples.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {examples.map((ex) => (
            <button key={ex} type="button" onClick={() => setText(ex)} className="min-h-[44px] rounded-[var(--radius-pill)] border border-[var(--color-border-subtle)] px-3 py-1 text-left text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-subtle)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]">
              Try: {ex.length > 70 ? `${ex.slice(0, 67)}...` : ex}
            </button>
          ))}
        </div>
      )}
      {error && <FieldError>{error}</FieldError>}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={pending || busy || text.trim().length < 3}>
          {pending ? <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : <Sparkles aria-hidden className="size-4" />}
          {pending ? "Preparing" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function EntryChoice({ part }: { part: AiEntryChoicePart }) {
  const { run, busy } = useThreadActions();
  const [mode, setMode] = useState<"choose" | "ai" | "manual">("choose");

  const manual = async () => {
    setMode("manual");
    const result = await run({ command: part.command, step: "manual", args: part.args, label: part.manual.label });
    if (!result.ok) setMode("choose");
  };

  return (
    <section aria-label={part.title} className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4">
      <h3 className="text-base font-semibold text-[var(--color-text-primary)]">{part.title}</h3>
      <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">{part.description}</p>

      {mode !== "ai" ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={manual}
            disabled={busy || mode === "manual"}
            className="flex min-h-[44px] flex-col items-start gap-1 rounded-[var(--radius-control)] border border-[var(--color-border-control)] p-3 text-left transition-colors hover:bg-[var(--color-bg-subtle)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)] disabled:opacity-60"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]"><PencilLine aria-hidden className="size-4" />{part.manual.label}</span>
            <span className="text-xs text-[var(--color-text-secondary)]">{part.manual.description}</span>
          </button>
          <button
            type="button"
            onClick={() => setMode("ai")}
            disabled={busy}
            className="flex min-h-[44px] flex-col items-start gap-1 rounded-[var(--radius-control)] border-2 border-[var(--color-action-primary)] bg-[var(--color-bg-subtle)] p-3 text-left transition-colors hover:bg-[var(--color-bg-surface)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)] disabled:opacity-60"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]"><Sparkles aria-hidden className="size-4" />{part.ai.label}</span>
            <span className="text-xs text-[var(--color-text-secondary)]">{part.ai.description}</span>
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]"><Sparkles aria-hidden className="size-4" />{part.ai.label}</p>
            <button type="button" onClick={() => setMode("choose")} className="min-h-[44px] px-2 text-xs font-semibold text-[var(--color-text-secondary)] underline underline-offset-2 hover:text-[var(--color-text-primary)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]">
              Back
            </button>
          </div>
          <DescribeBox command={part.command} args={part.args} placeholder={part.placeholder} examples={part.examples} submitLabel="Prepare draft" onDone={() => setMode("choose")} />
        </div>
      )}
    </section>
  );
}

export function DraftPrompt({ part }: { part: AiDraftPromptPart }) {
  return (
    <section aria-label={part.title} className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4">
      <h3 className="mb-3 text-base font-semibold text-[var(--color-text-primary)]">{part.title}</h3>
      <DescribeBox command={part.command} args={part.args} placeholder={part.placeholder} examples={part.examples} submitLabel={part.submitLabel} />
    </section>
  );
}

const PROVENANCE: Record<AiProvenance, { label: string; tone: "info" | "success" | "warning" | "neutral"; hint: string }> = {
  you: { label: "You said", tone: "info", hint: "Taken from your description or edited by you" },
  found: { label: "Found in your data", tone: "success", hint: "Matched to an existing record, or unchanged from the record" },
  inferred: { label: "AI guess", tone: "warning", hint: "The AI assumed this. Check it." },
  default: { label: "Default", tone: "neutral", hint: "The form's usual starting value" },
};
