"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { generateLogoAction, setOrganizationLogoAction } from "@/features/platform/actions/organization.action";
import { CANVAS_SIZE, composeLogo, DEFAULT_EDIT, exportPng, loadImage, type LogoEdit } from "@/features/platform/logo/compose";
import { Button, selectClass, textareaClass } from "@/shared/components/ui/button";
import { DialogOverlay } from "@/shared/components/ui/dialog-overlay";
import { FormMessage } from "@/shared/components/ui/form-message";
import { OrgAvatar } from "@/shared/components/ui/org-avatar";
import { cn } from "@/shared/lib/utils";

type Candidate = { id: string; mimeType: string; dataBase64: string; origin: string };
type Studio =
  | { available: true; currentLogoUrl: string | null }
  | { available: false; reason: "not_owner" | "plan" | "paused" | "not_configured"; message: string; currentLogoUrl: string | null };

const STYLES = ["", "minimal", "geometric", "modern", "playful", "elegant", "bold", "hand-drawn"] as const;
const BACKGROUNDS: { id: LogoEdit["background"]; label: string }[] = [
  { id: "white", label: "White" },
  { id: "transparent", label: "Transparent" },
  { id: "ink", label: "Deep ink" },
  { id: "lime", label: "Citron" },
  { id: "custom", label: "Custom" },
];
const label = "text-sm font-medium text-[var(--color-text-primary)]";
const hint = "text-xs text-[var(--color-text-secondary)]";
const card = "rounded-[22px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 sm:p-6";

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "organization";

/**
 * Owner-only AI logo studio. Gemini creates or edits a candidate; nothing is stored until the owner confirms. The prompt,
 * preferences and every candidate stay in this page through errors, and the current logo is never touched before then.
 */
export function LogoStudio({ orgId, orgName, studio }: { orgId: string; orgName: string; studio: Studio }) {
  const router = useRouter();
  const uid = useId();
  const [currentLogo, setCurrentLogo] = useState<string | null>(studio.currentLogoUrl);
  const [description, setDescription] = useState("");
  const [style, setStyle] = useState<(typeof STYLES)[number]>("");
  const [colors, setColors] = useState("");
  const [industry, setIndustry] = useState("");
  const [instruction, setInstruction] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [edit, setEdit] = useState<LogoEdit>(DEFAULT_EDIT);
  const [busy, setBusy] = useState<null | "generate" | "edit">(null);
  const [slow, setSlow] = useState<0 | 1 | 2>(0);
  const [error, setError] = useState<{ message: string; canRetry?: boolean } | null>(null);
  const lastRequest = useRef<{ kind: "generate" | "edit"; input: Record<string, unknown>; origin: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [finalImage, setFinalImage] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const requestToken = useRef(0);
  const previewRef = useRef<HTMLImageElement | null>(null);

  const selected = candidates.find((candidate) => candidate.id === selectedId) ?? null;
  const available = studio.available;

  // Progress hints while Gemini works: no fake percentages, only honest "still working" messages.
  useEffect(() => {
    if (!busy) return;
    const first = setTimeout(() => setSlow(1), 12_000);
    const second = setTimeout(() => setSlow(2), 35_000);
    return () => {
      clearTimeout(first);
      clearTimeout(second);
    };
  }, [busy]);

  // Re-draw the preview whenever the artwork or an edit control changes.
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    (async () => {
      try {
        const image = previewRef.current?.dataset.src === selected.id && previewRef.current ? previewRef.current : await loadImage(`data:${selected.mimeType};base64,${selected.dataBase64}`);
        image.dataset.src = selected.id;
        previewRef.current = image;
        const canvas = await composeLogo(image, edit, orgName, 560);
        if (!cancelled) setPreviewUrl(canvas.toDataURL("image/png"));
      } catch {
        if (!cancelled) setPreviewUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, edit, orgName]);

  const run = useCallback(
    async (kind: "generate" | "edit", input: Record<string, unknown>, origin: string) => {
      if (busy) return; // a second click while a request is running does nothing
      lastRequest.current = { kind, input, origin };
      const token = ++requestToken.current;
      setBusy(kind);
      setSlow(0);
      setError(null);
      setSaved(false);
      const result = await generateLogoAction(orgId, input);
      if (token !== requestToken.current) return; // cancelled: the answer is ignored
      setBusy(null);
      if (!result.ok) {
        setError({ message: result.error.message, canRetry: true });
        return;
      }
      const candidate: Candidate = { id: crypto.randomUUID(), mimeType: result.data.mimeType, dataBase64: result.data.dataBase64, origin };
      previewRef.current = null;
      setCandidates((list) => [candidate, ...list].slice(0, 8));
      setSelectedId(candidate.id);
      setEdit(DEFAULT_EDIT);
    },
    [busy, orgId]
  );

  const retry = () => {
    const last = lastRequest.current;
    if (last) void run(last.kind, last.input, last.origin);
  };

  const generate = () => run("generate", { mode: "new", description, ...(style ? { style } : {}), ...(colors.trim() ? { colors } : {}), ...(industry.trim() ? { industry } : {}) }, description);
  const modify = () => {
    if (!selected || !instruction.trim()) return;
    void run("edit", { mode: "edit", instruction, image: { mimeType: selected.mimeType, dataBase64: selected.dataBase64 } }, instruction).then(() => setInstruction(""));
  };
  const cancel = () => {
    requestToken.current++;
    setBusy(null);
    setError({ message: "Cancelled. Nothing was changed. Gemini may still finish this request in the background, so wait a moment before starting another." });
  };

  const prepareConfirm = async () => {
    if (!selected) return;
    setSaveError(null);
    try {
      const image = previewRef.current ?? (await loadImage(`data:${selected.mimeType};base64,${selected.dataBase64}`));
      setFinalImage(await exportPng(image, edit, orgName));
      setConfirming(true);
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : "The logo could not be prepared." });
    }
  };

  const confirm = async () => {
    if (!finalImage || saving) return;
    setSaving(true);
    setSaveError(null);
    const result = await setOrganizationLogoAction(orgId, finalImage);
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.error.message); // the dialog stays open with the image, so the owner can simply retry
      return;
    }
    setCurrentLogo(result.data.logoUrl);
    setConfirming(false);
    setSaved(true);
    router.refresh();
  };

  const download = async () => {
    if (!selected) return;
    const image = previewRef.current ?? (await loadImage(`data:${selected.mimeType};base64,${selected.dataBase64}`));
    const url = await exportPng(image, edit, orgName);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${slug(orgName)}-logo.png`;
    link.click();
  };

  const discard = () => {
    setCandidates((list) => list.filter((candidate) => candidate.id !== selectedId));
    setSelectedId(candidates.find((candidate) => candidate.id !== selectedId)?.id ?? null);
    setEdit(DEFAULT_EDIT);
  };

  const slider = (name: keyof LogoEdit, text: string, min: number, max: number, step: number, unit = "") => (
    <div className="space-y-1">
      <label htmlFor={`${uid}-${name}`} className={cn(label, "flex justify-between")}>
        {text}
        <span className="font-normal text-[var(--color-text-secondary)]">
          {String(edit[name])}
          {unit}
        </span>
      </label>
      <input
        id={`${uid}-${name}`}
        type="range"
        min={min}
        max={max}
        step={step}
        value={Number(edit[name])}
        onChange={(event) => setEdit((current) => ({ ...current, [name]: Number(event.target.value) }))}
        className="h-11 w-full accent-[var(--color-text-primary)]"
      />
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Current logo */}
      <section className={cn(card, "flex flex-col gap-4 sm:flex-row sm:items-center")} aria-labelledby={`${uid}-current`}>
        <OrgAvatar name={orgName} logoUrl={currentLogo} className="h-24 w-24 rounded-[22px] border border-[var(--color-border-subtle)] bg-[var(--color-action-primary)] font-[family-name:var(--font-heading)] text-3xl font-bold text-[#111F1D]" />
        <div className="min-w-0 flex-1">
          <h2 id={`${uid}-current`} className="text-base font-semibold text-[var(--color-text-primary)]">
            Current organization logo
          </h2>
          <p className={cn(hint, "mt-1 text-sm")}>{currentLogo ? "This is shown in the app launcher, the Dock and your organization pages. It stays as it is until you confirm a new one." : "No logo yet: your organization shows its initials."}</p>
        </div>
      </section>

      {saved && (
        <FormMessage kind="success">
          <strong>Your organization logo has been successfully updated!</strong> It now appears across your organization.
        </FormMessage>
      )}

      {!available ? (
        <section className={card}>
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">AI Logo Studio is not available</h2>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{studio.message}</p>
          {studio.reason === "plan" && (
            <Link href={`/organization/${orgId}/billing`} className="mt-4 inline-flex min-h-[44px] items-center text-sm font-semibold underline">
              See plans with AI features
            </Link>
          )}
        </section>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
          {/* Brief */}
          <form
            className={cn(card, "space-y-4")}
            onSubmit={(event) => {
              event.preventDefault();
              void generate();
            }}
            aria-busy={busy !== null}
          >
            <div>
              <h2 className="font-[family-name:var(--font-heading)] text-xl font-semibold tracking-[-0.02em] text-[var(--color-text-primary)]">Describe your logo</h2>
              <p className={cn(hint, "mt-1 text-sm")}>Gemini designs the symbol. Your name is added separately in clean type, so it is always spelled correctly.</p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${uid}-description`} className={label}>
                What should it show? <span aria-hidden="true">*</span>
              </label>
              <textarea
                id={`${uid}-description`}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={4}
                maxLength={800}
                required
                minLength={10}
                placeholder="e.g. A simple window frame made of two overlapping squares, friendly and trustworthy"
                className={textareaClass}
              />
              <p className={hint}>{description.length}/800</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor={`${uid}-style`} className={label}>
                  Style
                </label>
                <select id={`${uid}-style`} value={style} onChange={(event) => setStyle(event.target.value as (typeof STYLES)[number])} className={selectClass}>
                  {STYLES.map((value) => (
                    <option key={value} value={value}>
                      {value ? value[0].toUpperCase() + value.slice(1) : "No preference"}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor={`${uid}-industry`} className={label}>
                  Industry
                </label>
                <input id={`${uid}-industry`} value={industry} onChange={(event) => setIndustry(event.target.value)} maxLength={80} placeholder="e.g. Manufacturing" className={selectClass} style={{ appearance: "auto" }} />
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${uid}-colors`} className={label}>
                Preferred colors
              </label>
              <input id={`${uid}-colors`} value={colors} onChange={(event) => setColors(event.target.value)} maxLength={80} placeholder="e.g. deep green and lime" className={selectClass} style={{ appearance: "auto" }} />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="submit" variant="primary" disabled={busy !== null || description.trim().length < 10} className="flex-1">
                {busy === "generate" ? "Generating…" : candidates.length ? "Generate another concept" : "Generate logo"}
              </Button>
              {busy && (
                <Button variant="secondary" onClick={cancel}>
                  Cancel
                </Button>
              )}
            </div>
            {error && (
              <div className="space-y-2">
                <FormMessage kind="error">{error.message}</FormMessage>
                {error.canRetry && !busy && (
                  <Button variant="secondary" onClick={retry}>
                    Try again
                  </Button>
                )}
              </div>
            )}
          </form>

          {/* Preview and editing */}
          <section className={cn(card, "space-y-5")} aria-labelledby={`${uid}-preview`} aria-live="polite">
            <h2 id={`${uid}-preview`} className="font-[family-name:var(--font-heading)] text-xl font-semibold tracking-[-0.02em] text-[var(--color-text-primary)]">
              Preview
            </h2>
            <div className="mx-auto aspect-square w-full max-w-[420px] overflow-hidden rounded-[20px] border border-[var(--color-border-subtle)] bg-[repeating-conic-gradient(var(--color-bg-subtle)_0_25%,var(--color-bg-surface)_0_50%)] [background-size:20px_20px]">
              {busy ? (
                <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-[var(--color-bg-surface)] p-6 text-center" role="status">
                  <span className="h-14 w-14 rounded-2xl bg-[var(--color-bg-subtle)] motion-safe:animate-pulse" aria-hidden="true" />
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">{busy === "edit" ? "Applying your change…" : "Designing your logo…"}</p>
                  <p className={hint}>{slow === 0 ? "This usually takes 10–30 seconds." : slow === 1 ? "Still working. Gemini is a little slower than usual." : "This is taking longer than usual. You can keep waiting or cancel."}</p>
                </div>
              ) : previewUrl && selected ? (
                // eslint-disable-next-line @next/next/no-img-element -- local data URL
                <img src={previewUrl} alt={`Logo preview for ${orgName}`} width={CANVAS_SIZE / 2} height={CANVAS_SIZE / 2} className="h-full w-full object-contain motion-safe:animate-[anops-fade_300ms_ease-out]" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-[var(--color-bg-surface)] p-6 text-center text-sm text-[var(--color-text-secondary)]">Your generated logo will appear here.</div>
              )}
            </div>

            {candidates.length > 1 && (
              <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="Generated concepts">
                {candidates.map((candidate, index) => (
                  <li key={candidate.id} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        previewRef.current = null;
                        setSelectedId(candidate.id);
                        setEdit(DEFAULT_EDIT);
                      }}
                      aria-pressed={candidate.id === selectedId}
                      aria-label={`Concept ${candidates.length - index}`}
                      className={cn("h-16 w-16 overflow-hidden rounded-[12px] border-2 bg-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]", candidate.id === selectedId ? "border-[var(--color-text-primary)]" : "border-[var(--color-border-subtle)]")}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
                      <img src={`data:${candidate.mimeType};base64,${candidate.dataBase64}`} alt="" className="h-full w-full object-cover" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {selected && !busy && (
              <>
                <div className="space-y-1.5">
                  <label htmlFor={`${uid}-instruction`} className={label}>
                    Ask Gemini to change something
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      id={`${uid}-instruction`}
                      value={instruction}
                      onChange={(event) => setInstruction(event.target.value)}
                      maxLength={400}
                      placeholder="e.g. Make the shapes rounder and use a darker green"
                      className={cn(selectClass, "flex-1")}
                      style={{ appearance: "auto" }}
                      onKeyDown={(event) => event.key === "Enter" && modify()}
                    />
                    <Button variant="secondary" onClick={modify} disabled={instruction.trim().length < 3}>
                      Apply change
                    </Button>
                  </div>
                </div>

                <details className="rounded-[16px] border border-[var(--color-border-subtle)] p-4" open>
                  <summary className="cursor-pointer text-sm font-semibold text-[var(--color-text-primary)]">Position, background and name</summary>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    {slider("zoom", "Zoom", 0.5, 3, 0.05, "×")}
                    {slider("padding", "Margin", 0, 30, 1, "%")}
                    {slider("x", "Move left / right", -40, 40, 1)}
                    {slider("y", "Move up / down", -40, 40, 1)}
                  </div>
                  <fieldset className="mt-4">
                    <legend className={label}>Background</legend>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {BACKGROUNDS.map((background) => (
                        <button
                          key={background.id}
                          type="button"
                          aria-pressed={edit.background === background.id}
                          onClick={() => setEdit((current) => ({ ...current, background: background.id }))}
                          className={cn("min-h-[44px] rounded-full border px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]", edit.background === background.id ? "border-[var(--color-text-primary)] bg-[var(--color-text-primary)] text-[var(--color-bg-canvas)]" : "border-[var(--color-border-control)] text-[var(--color-text-primary)]")}
                        >
                          {background.label}
                        </button>
                      ))}
                      {edit.background === "custom" && (
                        <label className="inline-flex min-h-[44px] items-center gap-2 text-sm">
                          <span className="sr-only">Custom background color</span>
                          <input type="color" value={edit.customColor} onChange={(event) => setEdit((current) => ({ ...current, customColor: event.target.value }))} className="h-11 w-14 rounded-md border border-[var(--color-border-control)] bg-transparent" />
                        </label>
                      )}
                    </div>
                  </fieldset>
                  <label className="mt-4 flex min-h-[44px] items-center gap-3 text-sm text-[var(--color-text-primary)]">
                    <input type="checkbox" checked={edit.removePlainBackground} onChange={(event) => setEdit((current) => ({ ...current, removePlainBackground: event.target.checked }))} className="h-5 w-5 accent-[var(--color-text-primary)]" />
                    Remove the plain background around the artwork
                  </label>
                  {edit.removePlainBackground && <div className="mt-2">{slider("tolerance", "Background tolerance", 4, 80, 1)}</div>}
                  <label className="mt-2 flex min-h-[44px] items-center gap-3 text-sm text-[var(--color-text-primary)]">
                    <input type="checkbox" checked={edit.showName} onChange={(event) => setEdit((current) => ({ ...current, showName: event.target.checked }))} className="h-5 w-5 accent-[var(--color-text-primary)]" />
                    Add “{orgName}” below the symbol
                  </label>
                </details>

                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <Button variant="primary" onClick={() => void prepareConfirm()} className="sm:flex-1">
                    Use as Organization Logo
                  </Button>
                  <Button variant="secondary" onClick={() => void download()}>
                    Download PNG
                  </Button>
                  <Button variant="ghost" onClick={discard}>
                    Discard
                  </Button>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {confirming && finalImage && (
        <DialogOverlay label="Use as organization logo" onClose={() => !saving && setConfirming(false)} className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4">
          <div className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-[24px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 shadow-2xl sm:rounded-[24px] sm:p-6">
            <h3 className="font-[family-name:var(--font-heading)] text-xl font-semibold tracking-[-0.02em] text-[var(--color-text-primary)]">Use this as your organization logo?</h3>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              It will become the official logo of <strong className="text-[var(--color-text-primary)]">{orgName}</strong> and appear in the app launcher, the Dock and your organization pages for every member.
            </p>
            <div className="mt-4 grid grid-cols-2 items-center gap-3 text-center text-xs text-[var(--color-text-secondary)]">
              <div>
                <OrgAvatar name={orgName} logoUrl={currentLogo} className="mx-auto h-24 w-24 rounded-[18px] border border-[var(--color-border-subtle)] bg-[var(--color-action-primary)] text-2xl font-bold text-[#111F1D]" />
                <p className="mt-1">Current</p>
              </div>
              <div>
                {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
                <img src={finalImage} alt="The logo you selected" className="mx-auto h-24 w-24 rounded-[18px] border-2 border-[var(--color-text-primary)] bg-white object-contain" />
                <p className="mt-1 font-semibold text-[var(--color-text-primary)]">New</p>
              </div>
            </div>
            {saveError && (
              <div className="mt-4">
                <FormMessage kind="error">{saveError}</FormMessage>
              </div>
            )}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={() => setConfirming(false)} disabled={saving}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void confirm()} disabled={saving} data-autofocus>
                {saving ? "Saving…" : saveError ? "Try again" : "Use as Organization Logo"}
              </Button>
            </div>
          </div>
        </DialogOverlay>
      )}
    </div>
  );
}
