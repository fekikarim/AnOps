"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import type { CommandDto } from "@/features/ai/types";
import { cn } from "@/shared/lib/utils";

const MAX_CHARS = 2000;

/**
 * Message box with a slash-command palette. The palette is a combobox: the textarea owns focus, the
 * options are announced through aria-activedescendant, and Enter completes a highlighted command
 * instead of sending it half-typed.
 */
export function Composer({
  commands,
  sending,
  disabled,
  onSend,
  onStop,
}: {
  commands: CommandDto[];
  sending: boolean;
  disabled?: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [value, setValue] = useState("");
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const listId = useId();

  const query = value.startsWith("/") && !value.includes(" ") ? value.toLowerCase() : null;
  const matches = useMemo(
    () => (query === null ? [] : commands.filter((c) => c.command.startsWith(query))),
    [query, commands]
  );
  const open = query !== null && !dismissed && !disabled;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 176)}px`;
  }, [value]);

  const submit = () => {
    const text = value.trim();
    if (!text || sending || disabled) return;
    onSend(text);
    setValue("");
    setDismissed(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (matches.length === 0) return;
        event.preventDefault();
        setActive((i) => (event.key === "ArrowDown" ? (i + 1) % matches.length : (i - 1 + matches.length) % matches.length));
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissed(true);
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && matches[active] && matches[active].command !== value.trim().toLowerCase()) {
        event.preventDefault();
        setValue(matches[active].command);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="relative">
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Commands"
          className="absolute inset-x-0 bottom-full z-10 mb-2 max-h-64 overflow-y-auto rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-1.5 shadow-lg"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-3 text-sm text-[var(--color-text-secondary)]">No command matches. Type a question instead, or press Escape.</li>
          ) : (
            matches.map((c, i) => (
              <li
                key={c.command}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setValue(c.command);
                  ref.current?.focus();
                }}
                onMouseEnter={() => setActive(i)}
                className={cn("flex min-h-[44px] cursor-pointer flex-col justify-center rounded-[var(--radius-control)] px-3 py-1.5", i === active && "bg-[var(--color-bg-subtle)]")}
              >
                <span className="text-sm font-semibold text-[var(--color-text-primary)]">{c.command}</span>
                <span className="text-xs text-[var(--color-text-secondary)]">{c.description}</span>
              </li>
            ))
          )}
        </ul>
      )}

      <div className="flex items-end gap-2 rounded-[var(--radius-card)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] p-2 focus-within:ring-[3px] focus-within:ring-[var(--color-focus-ring)]">
        <label htmlFor="ai-composer" className="sr-only">
          Message AnOps AI
        </label>
        {/* ARIA 1.1 combobox: the wrapper owns the popup state, the textarea keeps its textbox role and points at the active option. */}
        <div role="combobox" aria-label="Message AnOps AI" aria-expanded={open} aria-haspopup="listbox" aria-owns={open ? listId : undefined} aria-controls={open ? listId : undefined} className="flex min-w-0 flex-1">
        <textarea
          id="ai-composer"
          ref={ref}
          rows={1}
          value={value}
          maxLength={MAX_CHARS}
          disabled={disabled}
          placeholder={disabled ? "AI is not available to you right now" : "Ask anything, or type / for commands"}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
          onChange={(e) => {
            setValue(e.target.value);
            setActive(0);
            setDismissed(false);
          }}
          onKeyDown={onKeyDown}
          // The container draws the focus ring (focus-within); the global :focus-visible outline would double it, so it is
          // switched off with an important utility class (an inline style caused a hydration mismatch).
          className="max-h-44 min-h-[44px] w-full flex-1 resize-none bg-transparent px-2 py-2.5 text-[15px] text-[var(--color-text-primary)] !outline-none placeholder:text-[var(--color-text-secondary)] disabled:cursor-not-allowed"
        />
        </div>
        {sending ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop generating"
            className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-border-control)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]"
          >
            <Square aria-hidden className="size-4 fill-current" />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={disabled || value.trim().length === 0}
            aria-label="Send message"
            className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-action-primary)] text-[var(--color-action-on-primary)] transition-colors hover:bg-[var(--color-action-hover)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ArrowUp aria-hidden className="size-5" />
          </button>
        )}
      </div>
      <p className="mt-1.5 hidden px-1 text-xs text-[var(--color-text-secondary)] sm:block">Enter to send, Shift+Enter for a new line. Changes are always shown for your confirmation first.</p>
    </div>
  );
}
