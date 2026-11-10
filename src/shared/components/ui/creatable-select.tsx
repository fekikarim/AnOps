"use client";

import { useId, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Drawer } from "@/shared/components/ui/drawer";
import { Select } from "@/shared/components/ui/form-kit";
import { cn } from "@/shared/lib/utils";

export type SelectOption = {
  id: string;
  label: string;
  /** Extra facts the caller wants back when this option is chosen, such as a default price. */
  data?: Record<string, string>;
};

export type CreateFormProps = {
  /** Call with the record the server returned. The select picks it immediately. */
  onCreated: (option: SelectOption) => void;
  /** Omitted when the form is not inside something that can be dismissed, such as a wizard step. */
  onCancel?: () => void;
};

/**
 * A select whose missing option can be created without leaving the form.
 *
 * Creation always goes through the real server action in `renderCreate`; the option added here is the record the
 * server returned, so there is never a client-only "pending" entry. If a refresh later delivers the same id in
 * `options`, it is shown once. Hidden when the caller may not create the entity (`renderCreate` omitted).
 */
export function CreatableSelect({
  id,
  label,
  value,
  onChange,
  onSelectOption,
  options,
  placeholder,
  createLabel,
  createTitle,
  createDescription,
  renderCreate,
  required,
  hint,
  error,
  disabled,
  emptyHint,
  className,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Called with the chosen option (or undefined when cleared), including options created inline. */
  onSelectOption?: (option: SelectOption | undefined) => void;
  options: SelectOption[];
  placeholder: string;
  createLabel?: string;
  createTitle?: string;
  createDescription?: string;
  renderCreate?: (props: CreateFormProps) => React.ReactNode;
  required?: boolean;
  hint?: string;
  error?: string;
  disabled?: boolean;
  /** Shown instead of the hint while there is nothing to choose yet. */
  emptyHint?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<SelectOption[]>([]);
  const labelId = useId();

  const merged = useMemo(() => {
    const known = new Set(options.map((option) => option.id));
    return [...options, ...created.filter((option) => !known.has(option.id))];
  }, [options, created]);

  const describedBy = error ? `${id}-error` : hint || (merged.length === 0 && emptyHint) ? `${id}-hint` : undefined;

  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-3">
        <label id={labelId} htmlFor={id} className="block text-sm font-semibold text-[var(--color-text-primary)]">
          {label}
          {required && <span aria-hidden="true" className="ml-0.5 text-[var(--color-status-error)]">*</span>}
        </label>
        {renderCreate && createLabel && !disabled && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="-my-2 inline-flex min-h-[44px] shrink-0 items-center gap-1 whitespace-nowrap rounded-[var(--radius-control)] px-2 text-sm font-semibold text-[var(--color-text-primary)] underline decoration-[var(--color-border-control)] underline-offset-4 hover:decoration-current focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]"
          >
            <Plus aria-hidden className="size-4" />
            {createLabel}
          </button>
        )}
      </div>
      <Select
        id={id}
        value={value}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        onChange={(event) => {
          onChange(event.target.value);
          onSelectOption?.(merged.find((option) => option.id === event.target.value));
        }}
      >
        <option value="">{placeholder}</option>
        {merged.map((option) => (
          <option key={option.id} value={option.id}>{option.label}</option>
        ))}
      </Select>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-[var(--color-status-error)]">{error}</p>
      ) : merged.length === 0 && emptyHint ? (
        <p id={`${id}-hint`} className="text-xs text-[var(--color-text-secondary)]">{emptyHint}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-[var(--color-text-secondary)]">{hint}</p>
      ) : null}

      {renderCreate && createTitle && (
        <Drawer open={open} onClose={() => setOpen(false)} title={createTitle} description={createDescription}>
          {renderCreate({
            onCreated: (option) => {
              setCreated((current) => [...current.filter((item) => item.id !== option.id), option]);
              onChange(option.id);
              onSelectOption?.(option);
              setOpen(false);
            },
            onCancel: () => setOpen(false),
          })}
        </Drawer>
      )}
    </div>
  );
}
