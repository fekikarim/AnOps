"use client";

import { useState, useRef, useEffect } from "react";
import { Briefcase, Check, Plus, ChevronDown, Sparkles } from "lucide-react";
import type { JobTitle } from "@/features/hr/types";
import { cn } from "@/shared/lib/utils";

type JobTitleComboboxProps = {
  jobTitles: JobTitle[];
  value: string;
  onChange: (title: string, isCustom: boolean) => void;
  selectedDepartmentId?: string;
  error?: string;
};

export function JobTitleCombobox({
  jobTitles,
  value,
  onChange,
  selectedDepartmentId,
  error,
}: JobTitleComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [customMode, setCustomMode] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Filter and prioritize titles belonging to selected department
  const filteredTitles = jobTitles.filter((item) => {
    return item.title.toLowerCase().includes(search.toLowerCase());
  }).sort((a, b) => {
    if (selectedDepartmentId) {
      if (a.departmentId === selectedDepartmentId && b.departmentId !== selectedDepartmentId) return -1;
      if (b.departmentId === selectedDepartmentId && a.departmentId !== selectedDepartmentId) return 1;
    }
    return 0;
  });

  const exactMatchExists = jobTitles.some(
    (t) => t.title.trim().toLowerCase() === search.trim().toLowerCase()
  );

  const handleSelect = (title: string, isPredefined: boolean) => {
    onChange(title, !isPredefined);
    setOpen(false);
    setCustomMode(false);
    setSearch("");
  };

  const handleApplyCustom = () => {
    const trimmed = customInput.trim();
    if (trimmed) {
      onChange(trimmed, true);
      setOpen(false);
      setCustomMode(false);
      setCustomInput("");
      setSearch("");
    }
  };

  return (
    <div className="relative space-y-1.5" ref={containerRef}>
      <label className="block text-xs font-semibold tracking-wide text-[var(--color-text-secondary)] uppercase">
        Job Title / Role <span className="text-[var(--color-status-error)]">*</span>
      </label>

      {/* Main trigger / display button */}
      <div
        onClick={() => setOpen(!open)}
        className={cn(
          "flex min-h-[44px] w-full cursor-pointer items-center justify-between rounded-[var(--radius-control)] border bg-[var(--color-bg-surface)] px-3.5 py-2 text-sm transition-colors",
          error
            ? "border-[var(--color-status-error)] ring-1 ring-[var(--color-status-error)]"
            : "border-[var(--color-border-control)] hover:border-[var(--color-text-primary)]",
          open && "ring-2 ring-[var(--color-focus-ring)] border-transparent"
        )}
      >
        <div className="flex items-center gap-2.5 truncate">
          <Briefcase className="h-4 w-4 shrink-0 text-[var(--color-text-secondary)]" />
          {value ? (
            <span className="font-medium text-[var(--color-text-primary)] truncate">
              {value}
            </span>
          ) : (
            <span className="text-[var(--color-text-secondary)]">Select or type a job title...</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {value && (
            <span className="rounded-[var(--radius-pill)] bg-[var(--color-bg-subtle)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-text-secondary)]">
              {jobTitles.find((t) => t.title === value)?.isPredefined ? "Standard" : "Custom"}
            </span>
          )}
          <ChevronDown
            className={cn(
              "h-4 w-4 text-[var(--color-text-secondary)] transition-transform",
              open && "rotate-180"
            )}
          />
        </div>
      </div>

      {error && <p className="text-xs text-[var(--color-status-error)]">{error}</p>}

      {/* Dropdown Menu */}
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-80 overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] shadow-[0_12px_32px_-8px_rgba(17,31,29,0.25)] animate-in fade-in-50 zoom-in-95">
          {/* Search box or Custom creation input */}
          <div className="border-b border-[var(--color-border-subtle)] p-2">
            {!customMode ? (
              <div className="relative">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search predefined titles or type new..."
                  autoFocus
                  className="w-full min-h-[44px] rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-canvas)] px-3 py-2 text-base sm:text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-focus-ring)]"
                />
              </div>
            ) : (
              <div className="space-y-2 p-1">
                <p className="text-xs font-medium text-[var(--color-text-secondary)]">
                  Enter new custom title:
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customInput}
                    onChange={(e) => setCustomInput(e.target.value)}
                    placeholder="e.g. AI Prompt Engineer"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleApplyCustom();
                      }
                    }}
                    className="flex-1 min-h-[44px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-canvas)] px-3 py-1.5 text-base sm:text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                  />
                  <button
                    type="button"
                    onClick={handleApplyCustom}
                    className="min-h-[44px] rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-3.5 py-1.5 text-xs font-semibold text-[var(--color-action-on-primary)] hover:bg-[var(--color-action-hover)]"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomMode(false)}
                    className="min-h-[44px] rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Quick Create Custom Banner */}
          {!customMode && search.trim() && !exactMatchExists && (
            <div
              onClick={() => {
                onChange(search.trim(), true);
                setOpen(false);
                setSearch("");
              }}
              className="flex min-h-[44px] cursor-pointer items-center gap-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-3.5 py-2.5 text-xs font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-action-primary)]/20"
            >
              <Sparkles className="h-3.5 w-3.5 text-[var(--color-text-primary)]" />
              <span>
                Use custom title: <strong className="underline">&ldquo;{search.trim()}&rdquo;</strong>
              </span>
            </div>
          )}

          {/* Titles List */}
          <div className="max-h-56 overflow-y-auto p-1 space-y-0.5">
            {filteredTitles.map((t) => {
              const isSelected = value.toLowerCase() === t.title.toLowerCase();
              return (
                <div
                  key={t.id}
                  onClick={() => handleSelect(t.title, t.isPredefined)}
                  className={cn(
                    "flex min-h-[44px] cursor-pointer items-center justify-between rounded-[var(--radius-control)] px-3 py-2 text-sm transition-colors",
                    isSelected
                      ? "bg-[var(--color-action-primary)] text-[var(--color-action-on-primary)] font-semibold"
                      : "text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)]"
                  )}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="truncate">{t.title}</span>
                    {t.isPredefined ? (
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-medium shrink-0",
                          isSelected
                            ? "bg-[var(--color-action-on-primary)]/10 text-[var(--color-action-on-primary)]"
                            : "bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]"
                        )}
                      >
                        Predefined
                      </span>
                    ) : (
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-medium shrink-0",
                          isSelected
                            ? "bg-[var(--color-action-on-primary)]/10 text-[var(--color-action-on-primary)]"
                            : "bg-[#fbf2da] text-[#7b5915]"
                        )}
                      >
                        Custom
                      </span>
                    )}
                  </div>
                  {isSelected && <Check className="h-4 w-4 shrink-0" />}
                </div>
              );
            })}

            {filteredTitles.length === 0 && !search.trim() && (
              <p className="p-4 text-center text-xs text-[var(--color-text-secondary)]">
                No job titles found.
              </p>
            )}
          </div>

          {/* Footer action to trigger custom modal */}
          {!customMode && (
            <div className="border-t border-[var(--color-border-subtle)] p-2">
              <button
                type="button"
                onClick={() => {
                  setCustomMode(true);
                  setCustomInput(search);
                }}
                className="flex w-full min-h-[36px] items-center justify-center gap-2 rounded-[var(--radius-control)] border border-dashed border-[var(--color-border-control)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-primary)] hover:border-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)]"
              >
                <Plus className="h-3.5 w-3.5" />
                Type a custom title...
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
