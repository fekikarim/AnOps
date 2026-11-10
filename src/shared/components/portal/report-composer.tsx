"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { apps } from "@/shared/config/catalog";
import { cn } from "@/shared/lib/utils";

const kinds = [
  { value: "bug", label: "Bug report" },
  { value: "feature", label: "Feature request" },
  { value: "feedback", label: "General feedback" },
] as const;

const field =
  "mt-2 w-full rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-[3px] focus:ring-[var(--color-focus-ring)]";

/**
 * There is no public submission endpoint yet, so this composes a structured report the person can copy
 * and share through the contact page. Nothing is sent from here.
 */
export function ReportComposer() {
  const id = useId();
  const [kind, setKind] = useState<(typeof kinds)[number]["value"]>("bug");
  const [app, setApp] = useState("");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [steps, setSteps] = useState("");
  const [copied, setCopied] = useState<"idle" | "done" | "error">("idle");

  const label = kinds.find((item) => item.value === kind)?.label ?? "";
  const appName = apps.find((item) => item.slug === app)?.name ?? "Not specific";
  const report = [
    `Type: ${label}`,
    `Application: ${appName}`,
    `Title: ${title || "(no title)"}`,
    "",
    kind === "bug" ? "What happened:" : "Details:",
    details || "(empty)",
    ...(kind === "bug" ? ["", "Steps to reproduce:", steps || "(empty)"] : []),
  ].join("\n");
  const ready = title.trim().length > 3 && details.trim().length > 10;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied("done");
    } catch {
      setCopied("error");
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <form className="space-y-5 rounded-[20px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 sm:p-7" onSubmit={(event) => event.preventDefault()}>
        <fieldset>
          <legend className="text-sm font-semibold text-[var(--color-text-primary)]">What would you like to share?</legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {kinds.map((item) => (
              <label
                key={item.value}
                className={cn(
                  "inline-flex min-h-[44px] cursor-pointer items-center rounded-full border px-4 text-sm font-medium has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-[var(--color-focus-ring)]",
                  kind === item.value
                    ? "border-[var(--color-text-primary)] bg-[var(--color-text-primary)] text-[var(--color-bg-canvas)]"
                    : "border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                )}
              >
                <input type="radio" name="kind" value={item.value} checked={kind === item.value} onChange={() => setKind(item.value)} className="sr-only" />
                {item.label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor={`${id}-app`} className="text-sm font-semibold text-[var(--color-text-primary)]">
              Application
            </label>
            <select id={`${id}-app`} value={app} onChange={(event) => setApp(event.target.value)} className={`${field} h-11`}>
              <option value="">Not specific</option>
              {apps.map((item) => (
                <option key={item.slug} value={item.slug}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-title`} className="text-sm font-semibold text-[var(--color-text-primary)]">
              Title
            </label>
            <input id={`${id}-title`} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="A short summary" className={`${field} h-11`} />
          </div>
        </div>
        <div>
          <label htmlFor={`${id}-details`} className="text-sm font-semibold text-[var(--color-text-primary)]">
            {kind === "bug" ? "What happened, and what did you expect?" : "Tell us more"}
          </label>
          <textarea id={`${id}-details`} value={details} onChange={(event) => setDetails(event.target.value)} rows={4} className={`${field} py-2.5`} />
        </div>
        {kind === "bug" && (
          <div>
            <label htmlFor={`${id}-steps`} className="text-sm font-semibold text-[var(--color-text-primary)]">
              Steps to reproduce
            </label>
            <textarea id={`${id}-steps`} value={steps} onChange={(event) => setSteps(event.target.value)} rows={3} placeholder={"1. Open …\n2. Click …"} className={`${field} py-2.5`} />
          </div>
        )}
        <p className="text-xs text-[var(--color-text-secondary)]">Please do not include passwords, payment details or other people&apos;s personal data.</p>
      </form>

      <div className="flex flex-col rounded-[20px] portal-ink p-5 sm:p-7">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">Your report</p>
        <pre className="mt-3 flex-1 overflow-auto whitespace-pre-wrap rounded-[12px] bg-black/25 p-4 font-mono text-xs leading-relaxed text-[#F7F7F2]">{report}</pre>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={copy}
            disabled={!ready}
            className="inline-flex min-h-[44px] items-center rounded-[var(--radius-control)] bg-[#C8F03E] px-5 text-sm font-semibold text-[#111F1D] transition-colors hover:bg-[#B9DE36] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Copy report
          </button>
          <Link href="/contact" className="inline-flex min-h-[44px] items-center rounded-[var(--radius-control)] border border-[#5d7a6f] px-5 text-sm font-semibold text-[#F7F7F2] hover:bg-[#192B27]">
            Go to contact
          </Link>
          <p role="status" className="text-xs text-[var(--color-text-secondary)]">
            {copied === "done" ? "Copied to your clipboard." : copied === "error" ? "Copy failed. Select the text and copy it manually." : !ready ? "Add a title and details to copy." : ""}
          </p>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-[var(--color-text-secondary)]">
          A direct submission channel is being set up. Until then, copy the report and share it through the contact page.
        </p>
      </div>
    </div>
  );
}
