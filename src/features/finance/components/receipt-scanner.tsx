"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardPaste,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Loader2,
  ScanLine,
  Send,
  Save,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  applyReceiptAction,
  deleteReceiptExtractionAction,
  scanReceiptAction,
} from "@/features/finance/actions/receipt-ocr.actions";
import { Button, selectClass } from "@/shared/components/ui/button";
import { Field, Select, Textarea } from "@/shared/components/ui/form-kit";
import { FormMessage } from "@/shared/components/ui/form-message";
import { EmptyState } from "@/shared/components/data-display/empty-state";
import { useToast } from "@/shared/components/ui/toast";
import { cn } from "@/shared/lib/utils";

type Warning = { code: string; message: string };

type Proposed = {
  vendor?: string | null;
  date?: string | null;
  amount?: number | null;
  tax?: number | null;
  total?: number | null;
  currency?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  /** Older scans stored a free-text hint instead of a category id. */
  categoryHint?: string | null;
  description?: string | null;
  notes?: string | null;
  confidence?: number | null;
  fieldConfidence?: Partial<Record<"vendor" | "date" | "total" | "tax" | "currency", number>>;
};

export type ReceiptItem = {
  id: string;
  receiptDocumentId: string;
  hasFile: boolean;
  originalName: string;
  mimeType: string;
  source: string;
  proposed: Proposed;
  warnings: Warning[];
  appliedToExpenseId?: string;
  possibleDuplicateExpenseId?: string;
  reviewed: boolean;
  createdAt: string;
};

type Review = {
  extractionId: string;
  receiptDocumentId: string | null;
  mimeType: string | null;
  proposed: Proposed;
  warnings: Warning[];
  duplicateFile: boolean;
  possibleDuplicateExpenseId: string | null;
  appliedToExpenseId?: string;
};

const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf";
const MAX_BYTES = 10 * 1024 * 1024;
const LOW_CONFIDENCE = 0.6;
/** Receipts per batch. They are read one after another, so a batch never floods the AI limits. */
const MAX_BATCH = 10;

type QueueItem = {
  key: string;
  name: string;
  mimeType: string;
  status: "waiting" | "reading" | "done" | "error";
  message?: string;
  review?: Review;
};

const fileUrl = (documentId: string) => `/api/v1/finance/receipts/${documentId}/file`;

function ConfidenceBadge({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-bg-subtle)] px-2.5 py-1 text-xs font-semibold text-[var(--color-text-secondary)]">
        <Sparkles aria-hidden className="size-3.5 shrink-0" /> Confidence not reported
      </span>
    );
  }
  const pct = Math.round(value * 100);
  const tone = value >= 0.8 ? "bg-[var(--color-status-success-bg)] text-[var(--color-status-success)]" : value >= LOW_CONFIDENCE ? "bg-[var(--color-status-warning-bg)] text-[var(--color-status-warning)]" : "bg-[var(--color-status-error-bg)] text-[var(--color-status-error)]";
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", tone)}>
      <Sparkles aria-hidden className="size-3.5 shrink-0" /> {pct}% confidence
    </span>
  );
}

function InfoNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-3 py-2.5 text-sm text-[var(--color-text-secondary)]">
      {children}
    </p>
  );
}

export function ReceiptScanner({
  initialReceipts = [],
  categories,
  canScan,
  canCreateExpense,
}: {
  initialReceipts?: ReceiptItem[];
  categories: Array<{ id: string; name: string }>;
  canScan: boolean;
  canCreateExpense: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Upload
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [batch, setBatch] = useState<File[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const [note, setNote] = useState("");

  // Review
  const [review, setReview] = useState<Review | null>(null);
  const [vendor, setVendor] = useState("");
  const [date, setDate] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [tax, setTax] = useState("");
  const [currency, setCurrency] = useState("TND");
  const [notes, setNotes] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const localPreview = useMemo(() => (file && file.type.startsWith("image/") ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => {
    if (localPreview) URL.revokeObjectURL(localPreview);
  }, [localPreview]);

  const fileProblem = (f: File) =>
    f.size > MAX_BYTES ? "larger than 10 MB" : !ACCEPT.split(",").includes(f.type) && !/\.(jpe?g|png|webp|heic|heif|pdf)$/i.test(f.name) ? "not a photo or PDF" : null;

  function pickFile(f: File | null | undefined) {
    setError(null);
    if (!f) return;
    if (f.size > MAX_BYTES) return setError("Receipts can be at most 10 MB.");
    if (fileProblem(f)) return setError("Choose a JPEG, PNG, WEBP or HEIC photo, or a PDF.");
    setFile(f);
    setBatch([]);
    setPasteMode(false);
  }

  /** One file behaves as before; several become a batch read one after another. */
  function pickFiles(list: FileList | null | undefined) {
    const all = list ? Array.from(list) : [];
    if (all.length <= 1) return pickFile(all[0]);
    setError(null);
    const skipped = all.filter((f) => fileProblem(f)).map((f) => `${f.name} (${fileProblem(f)})`);
    const ok = all.filter((f) => !fileProblem(f));
    const extra = ok.length > MAX_BATCH ? ok.length - MAX_BATCH : 0;
    if (skipped.length || extra) setError([skipped.length ? `Skipped: ${skipped.join(", ")}.` : "", extra ? `Only ${MAX_BATCH} receipts at a time; ${extra} left out.` : ""].filter(Boolean).join(" "));
    setBatch(ok.slice(0, MAX_BATCH));
    setFile(null);
    setPasteMode(false);
  }

  function handleBatch() {
    const files = batch;
    setError(null);
    const items: QueueItem[] = files.map((f, i) => ({ key: `${Date.now()}-${i}`, name: f.name, mimeType: f.type, status: "waiting" }));
    setQueue(items);
    setBatch([]);
    if (inputRef.current) inputRef.current.value = "";
    const update = (key: string, patch: Partial<QueueItem>) => setQueue((q) => q.map((x) => (x.key === key ? { ...x, ...patch } : x)));
    startTransition(async () => {
      let read = 0;
      for (let i = 0; i < files.length; i++) {
        update(items[i].key, { status: "reading" });
        const fd = new FormData();
        fd.set("receipt", files[i]);
        if (note.trim()) fd.set("notes", note.trim());
        const res = await scanReceiptAction(fd);
        if (res.error || !res.data) {
          update(items[i].key, { status: "error", message: res.error ?? "Could not be read." });
          continue;
        }
        const d = res.data;
        read++;
        const total = d.proposed.total != null ? `${d.proposed.total.toFixed(2)} ${d.proposed.currency ?? "TND"}` : "no total";
        update(items[i].key, {
          status: "done",
          message: d.duplicateFile ? "Already scanned before" : `${d.proposed.vendor ?? "Unknown vendor"} · ${total}${d.warnings.length ? ` · ${d.warnings.length} to check` : ""}`,
          review: { extractionId: d.extractionId, receiptDocumentId: d.receiptDocumentId, mimeType: items[i].mimeType || null, proposed: d.proposed, warnings: d.warnings, duplicateFile: d.duplicateFile, possibleDuplicateExpenseId: d.possibleDuplicateExpenseId },
        });
      }
      setNote("");
      toast.success("Batch finished", `${read} of ${files.length} receipts read. Review each one to create its expense.`);
      router.refresh();
    });
  }

  function openReview(r: Review) {
    const p = r.proposed;
    setReview(r);
    setVendor(p.vendor ?? "");
    setDate(p.date ?? "");
    const legacy = p.categoryHint ? categories.find((c) => c.name.toLowerCase() === p.categoryHint?.toLowerCase())?.id : undefined;
    setCategoryId(p.categoryId ?? legacy ?? "");
    setDescription(p.description ?? (p.vendor ? `Purchase at ${p.vendor}` : ""));
    setAmount(p.amount != null ? String(p.amount) : p.total != null ? String(p.total) : "");
    setTax(p.tax != null ? String(p.tax) : "0");
    setCurrency(p.currency ?? "TND");
    setNotes(p.notes ?? "");
    requestAnimationFrame(() => document.getElementById("receipt-review")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function handleScan() {
    setError(null);
    if (!file && !pastedText.trim()) return setError("Choose a receipt photo or PDF, or paste the receipt text.");
    const fd = new FormData();
    if (file) fd.set("receipt", file);
    if (pastedText.trim()) fd.set("receiptText", pastedText.trim());
    if (note.trim()) fd.set("notes", note.trim());
    startTransition(async () => {
      const res = await scanReceiptAction(fd);
      if (res.error || !res.data) return setError(res.error ?? "The receipt could not be scanned.");
      const d = res.data;
      openReview({
        extractionId: d.extractionId,
        receiptDocumentId: d.receiptDocumentId,
        mimeType: file?.type || null,
        proposed: d.proposed,
        warnings: d.warnings,
        duplicateFile: d.duplicateFile,
        possibleDuplicateExpenseId: d.possibleDuplicateExpenseId,
      });
      setFile(null);
      setPastedText("");
      setNote("");
      if (inputRef.current) inputRef.current.value = "";
      if (d.duplicateFile) toast.info("Already scanned", "This exact file was scanned before; showing that result.");
      else toast.success("Receipt read", "Check the values, then create the expense.");
      router.refresh();
    });
  }

  function handleApply(submit: boolean) {
    if (!review) return;
    setError(null);
    const net = Number(amount);
    if (!date) return setError("Enter the receipt date.");
    if (!Number.isFinite(net) || net <= 0) return setError("Enter a net amount greater than 0.");
    if (description.trim().length < 3) return setError("Enter a short description (at least 3 characters).");
    startTransition(async () => {
      const res = await applyReceiptAction(
        review.extractionId,
        { expenseDate: date, categoryId, vendor, description: description.trim(), amount: net, tax: Number(tax) || 0, currency, notes },
        { submit }
      );
      if (res.error || !res.data) return setError(res.error ?? "The expense could not be created.");
      toast.success(submit ? "Expense submitted" : "Draft expense saved", vendor ? `${vendor}: ${(net + (Number(tax) || 0)).toFixed(2)} ${currency}` : undefined);
      setReview(null);
      router.refresh();
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const res = await deleteReceiptExtractionAction(id);
      setConfirmDelete(null);
      if (res.error) return toast.error("Not deleted", res.error);
      if (review?.extractionId === id) setReview(null);
      toast.success("Receipt deleted");
      router.refresh();
    });
  }

  const lowField = (k: "vendor" | "date" | "total" | "tax" | "currency") => {
    const v = review?.proposed.fieldConfidence?.[k];
    return typeof v === "number" && v < LOW_CONFIDENCE ? "The AI was unsure about this value. Check it against the receipt." : undefined;
  };
  const total = (Number(amount) || 0) + (Number(tax) || 0);
  const previewDoc = review?.receiptDocumentId ?? null;
  const previewIsPdf = review?.mimeType === "application/pdf";

  return (
    <div className="space-y-6">
      {/* Upload */}
      {canScan ? (
        <section aria-labelledby="scan-heading" className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 sm:p-6 space-y-4" data-tour="receipt-upload">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-action-primary)]/10 text-[var(--color-action-primary)]">
              <ScanLine aria-hidden className="size-5" />
            </span>
            <div className="min-w-0">
              <h2 id="scan-heading" className="text-base font-semibold text-[var(--color-text-primary)]">Scan a receipt</h2>
              <p className="text-sm text-[var(--color-text-secondary)]">The AI reads vendor, date, amounts, tax and category from a photo or PDF. You check the values before anything is saved.</p>
            </div>
          </div>

          {!pasteMode && (
            <div
              role="button"
              tabIndex={0}
              aria-label="Choose a receipt photo or PDF"
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), inputRef.current?.click())}
              onDragOver={(e) => (e.preventDefault(), setDragging(true))}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                pickFiles(e.dataTransfer.files);
              }}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-[var(--radius-card)] border-2 border-dashed p-6 text-center transition-colors focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]",
                dragging ? "border-[var(--color-action-primary)] bg-[var(--color-action-primary)]/5" : "border-[var(--color-border-control)] hover:bg-[var(--color-bg-subtle)]"
              )}
            >
              <input ref={inputRef} type="file" accept={ACCEPT} multiple className="sr-only" tabIndex={-1} onChange={(e) => pickFiles(e.target.files)} />
              {batch.length > 1 ? (
                <div className="flex w-full max-w-md items-center gap-3 text-left">
                  <span className="flex size-16 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)]">
                    <Upload aria-hidden className="size-7 text-[var(--color-text-secondary)]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[var(--color-text-primary)]">{batch.length} receipts ready</p>
                    <p className="truncate text-xs text-[var(--color-text-secondary)]" title={batch.map((f) => f.name).join(", ")}>{batch.map((f) => f.name).join(", ")}</p>
                  </div>
                  <button
                    type="button"
                    aria-label="Remove the selected files"
                    title="Remove files"
                    onClick={(e) => {
                      e.stopPropagation();
                      setBatch([]);
                      if (inputRef.current) inputRef.current.value = "";
                    }}
                    className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]"
                  >
                    <X aria-hidden className="size-4" />
                  </button>
                </div>
              ) : file ? (
                <div className="flex w-full max-w-md items-center gap-3 text-left">
                  {localPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
                    <img src={localPreview} alt="" className="size-16 shrink-0 rounded-[var(--radius-control)] object-cover border border-[var(--color-border-subtle)]" />
                  ) : (
                    <span className="flex size-16 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)]">
                      <FileText aria-hidden className="size-7 text-[var(--color-text-secondary)]" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[var(--color-text-primary)]" title={file.name}>{file.name}</p>
                    <p className="text-xs text-[var(--color-text-secondary)]">{(file.size / 1024 / 1024).toFixed(2)} MB · ready to scan</p>
                  </div>
                  <button
                    type="button"
                    aria-label="Remove the selected file"
                    title="Remove file"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFile(null);
                      if (inputRef.current) inputRef.current.value = "";
                    }}
                    className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]"
                  >
                    <X aria-hidden className="size-4" />
                  </button>
                </div>
              ) : (
                <>
                  <Upload aria-hidden className="size-8 text-[var(--color-text-secondary)]" />
                  <div>
                    <p className="text-sm font-semibold text-[var(--color-text-primary)]">Drop receipts here, or click to choose</p>
                    <p className="text-xs text-[var(--color-text-secondary)]">JPEG, PNG, WEBP, HEIC or PDF, up to 10 MB each, up to {MAX_BATCH} at once. On a phone you can take a photo.</p>
                  </div>
                </>
              )}
            </div>
          )}

          {pasteMode && (
            <Field label="Receipt text" htmlFor="receipt-text" hint="Paste the lines of a receipt or an e-mailed invoice.">
              <Textarea
                id="receipt-text"
                rows={5}
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder={"e.g. MONOPRIX LAC 2\n12/10/2026\nTOTAL TTC 84.500 DT\nTVA 19% 13.490"}
              />
            </Field>
          )}

          <Field label="Note for the AI (optional)" htmlFor="receipt-note" hint="Context the receipt does not show, such as who or what it was for.">
            <input id="receipt-note" className={selectClass} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Lunch with a prospective client" />
          </Field>

          {error && !review && <FormMessage kind="error">{error}</FormMessage>}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="ghost" onClick={() => (setPasteMode((v) => !v), setFile(null))} disabled={pending}>
              {pasteMode ? <ImageIcon aria-hidden className="size-4 shrink-0" /> : <ClipboardPaste aria-hidden className="size-4 shrink-0" />}
              {pasteMode ? "Upload a file instead" : "Paste text instead"}
            </Button>
            <Button variant="primary" onClick={batch.length > 1 ? handleBatch : handleScan} disabled={pending || (!file && batch.length < 2 && !pastedText.trim())}>
              {pending && !review ? <Loader2 aria-hidden className="size-4 shrink-0 animate-spin motion-reduce:animate-none" /> : <ScanLine aria-hidden className="size-4 shrink-0" />}
              {pending && !review ? "Reading..." : batch.length > 1 ? `Scan ${batch.length} receipts` : "Scan receipt"}
            </Button>
          </div>
        </section>
      ) : (
        <InfoNote>You can view scanned receipts, but your role cannot scan new ones.</InfoNote>
      )}

      {/* Batch progress */}
      {queue.length > 0 && (
        <section aria-labelledby="batch-heading" className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 id="batch-heading" className="text-base font-semibold text-[var(--color-text-primary)]">
              Batch: {queue.filter((q) => q.status === "done" || q.status === "error").length} of {queue.length} processed
            </h2>
            {!pending && (
              <Button variant="ghost" onClick={() => setQueue([])} aria-label="Hide the batch results">
                <X aria-hidden className="size-4 shrink-0" /> Close
              </Button>
            )}
          </div>
          <div className="h-1.5 rounded-full bg-[var(--color-bg-subtle)]" role="progressbar" aria-valuemin={0} aria-valuemax={queue.length} aria-valuenow={queue.filter((q) => q.status === "done" || q.status === "error").length}>
            <div className="h-1.5 rounded-full bg-[var(--color-action-primary)] transition-[width] motion-reduce:transition-none" style={{ width: `${(queue.filter((q) => q.status === "done" || q.status === "error").length / queue.length) * 100}%` }} />
          </div>
          <ul className="divide-y divide-[var(--color-border-subtle)]" aria-live="polite">
            {queue.map((q) => (
              <li key={q.key} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  {q.status === "reading" ? (
                    <Loader2 aria-hidden className="size-4 shrink-0 animate-spin text-[var(--color-action-primary)] motion-reduce:animate-none" />
                  ) : q.status === "done" ? (
                    <CheckCircle2 aria-hidden className="size-4 shrink-0 text-[var(--color-status-success)]" />
                  ) : q.status === "error" ? (
                    <AlertTriangle aria-hidden className="size-4 shrink-0 text-[var(--color-status-error)]" />
                  ) : (
                    <span aria-hidden className="size-4 shrink-0 rounded-full border border-[var(--color-border-control)]" />
                  )}
                  <span className="truncate font-medium text-[var(--color-text-primary)]" title={q.name}>{q.name}</span>
                  <span className={`truncate text-xs ${q.status === "error" ? "text-[var(--color-status-error)]" : "text-[var(--color-text-secondary)]"}`}>
                    {q.status === "waiting" ? "Waiting" : q.status === "reading" ? "Reading…" : q.message}
                  </span>
                </span>
                {q.review && (
                  <Button className="min-h-[36px] px-3 text-xs" onClick={() => openReview(q.review!)}>
                    <ScanLine aria-hidden className="size-3.5 shrink-0" /> Review
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Review */}
      {review && (
        <section id="receipt-review" aria-labelledby="review-heading" className="rounded-[var(--radius-card)] border-2 border-[var(--color-action-primary)]/40 bg-[var(--color-bg-surface)] p-4 sm:p-6 space-y-5 scroll-mt-20">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <ConfidenceBadge value={review.proposed.confidence} />
              <h2 id="review-heading" className="text-lg font-semibold text-[var(--color-text-primary)]">Check the values</h2>
              <p className="text-sm text-[var(--color-text-secondary)]">Nothing is saved until you create the expense. Correct anything the AI misread.</p>
            </div>
            <Button variant="ghost" onClick={() => setReview(null)} disabled={pending} aria-label="Close the review">
              <X aria-hidden className="size-4 shrink-0" /> Close
            </Button>
          </div>

          {(review.warnings.length > 0 || review.duplicateFile) && (
            <div role="status" className="rounded-[var(--radius-control)] border border-[var(--color-status-warning)] bg-[var(--color-status-warning-bg)] p-3 text-sm text-[var(--color-text-primary)]">
              <p className="mb-1 flex items-center gap-2 font-semibold">
                <AlertTriangle aria-hidden className="size-4 shrink-0 text-[var(--color-status-warning)]" /> Please check
              </p>
              <ul className="list-disc space-y-0.5 pl-6">
                {review.duplicateFile && <li>This exact file was scanned before. This is the earlier result.</li>}
                {review.warnings.map((w) => (
                  <li key={w.code}>
                    {w.message}
                    {w.code === "possible_duplicate" && review.possibleDuplicateExpenseId && (
                      <>
                        {" "}
                        <Link href={`/finance/expenses/${review.possibleDuplicateExpenseId}/edit`} className="font-semibold underline">View it</Link>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            {/* Preview */}
            <div className="min-w-0">
              {previewDoc && !previewIsPdf ? (
                <a href={fileUrl(previewDoc)} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)]">
                  {/* eslint-disable-next-line @next/next/no-img-element -- authenticated file route, not optimisable */}
                  <img src={fileUrl(previewDoc)} alt="Scanned receipt" className="max-h-[520px] w-full object-contain" />
                </a>
              ) : previewDoc ? (
                <a href={fileUrl(previewDoc)} target="_blank" rel="noreferrer" className="flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] p-6 text-sm font-semibold text-[var(--color-text-primary)] hover:opacity-90">
                  <FileText aria-hidden className="size-8" /> Open the PDF <ExternalLink aria-hidden className="size-4" />
                </a>
              ) : (
                <div className="flex min-h-[160px] items-center justify-center rounded-[var(--radius-control)] border border-dashed border-[var(--color-border-subtle)] p-6 text-sm text-[var(--color-text-secondary)]">Read from pasted text: no file.</div>
              )}
            </div>

            {/* Editable proposal */}
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <Field label="Vendor" htmlFor="rv-vendor" hint={lowField("vendor")} className="sm:col-span-2">
                <input id="rv-vendor" className={selectClass} value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="e.g. Monoprix, Ooredoo, Shell" />
              </Field>
              <Field label="Receipt date" htmlFor="rv-date" required hint={lowField("date")}>
                <input id="rv-date" type="date" className={selectClass} value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="Category" htmlFor="rv-category" hint={review.proposed.categoryName ? `AI suggestion: ${review.proposed.categoryName}` : "The AI did not suggest a category."}>
                <Select id="rv-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  <option value="">Uncategorized</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Description" htmlFor="rv-description" required className="sm:col-span-2">
                <input id="rv-description" className={selectClass} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Printer paper and toner" />
              </Field>
              <Field label="Net amount" htmlFor="rv-amount" required hint={lowField("total")}>
                <input id="rv-amount" type="number" inputMode="decimal" step="0.01" min="0" className={selectClass} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
              </Field>
              <Field label="Tax / VAT" htmlFor="rv-tax" hint={lowField("tax")}>
                <input id="rv-tax" type="number" inputMode="decimal" step="0.01" min="0" className={selectClass} value={tax} onChange={(e) => setTax(e.target.value)} placeholder="0.00" />
              </Field>
              <Field label="Currency" htmlFor="rv-currency" hint={lowField("currency")}>
                <Select id="rv-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  <option value="TND">TND</option>
                  <option value="EUR">EUR</option>
                  <option value="USD">USD</option>
                  <option value="GBP">GBP</option>
                </Select>
              </Field>
              <div className="min-w-0 space-y-1.5">
                <span className="block text-sm font-semibold text-[var(--color-text-primary)]">Total</span>
                <div className="flex min-h-[44px] items-center rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-3 text-sm font-semibold text-[var(--color-text-primary)]">
                  {total.toFixed(2)} {currency}
                </div>
              </div>
              <Field label="Notes" htmlFor="rv-notes" className="sm:col-span-2" hint="Receipt number, payment method or anything an approver should know.">
                <Textarea id="rv-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Ticket #4521, paid by card" />
              </Field>
            </div>
          </div>

          {error && <FormMessage kind="error">{error}</FormMessage>}

          {review.appliedToExpenseId ? (
            <FormMessage kind="success">
              This receipt is already an expense. <Link className="font-semibold underline" href="/finance/expenses">Go to expenses</Link>
            </FormMessage>
          ) : canCreateExpense ? (
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button onClick={() => handleApply(false)} disabled={pending}>
                <Save aria-hidden className="size-4 shrink-0" /> Save as draft
              </Button>
              <Button variant="primary" onClick={() => handleApply(true)} disabled={pending}>
                {pending ? <Loader2 aria-hidden className="size-4 shrink-0 animate-spin motion-reduce:animate-none" /> : <Send aria-hidden className="size-4 shrink-0" />}
                Create and submit
              </Button>
            </div>
          ) : (
            <InfoNote>Your role cannot create expenses. Ask a finance manager to apply this receipt.</InfoNote>
          )}
        </section>
      )}

      {/* History */}
      <section aria-labelledby="history-heading" className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border-subtle)] p-4">
          <div>
            <h2 id="history-heading" className="font-semibold text-[var(--color-text-primary)]">Scanned receipts</h2>
            <p className="text-xs text-[var(--color-text-secondary)]">Every scan is kept with its file for review and audit.</p>
          </div>
          <span className="rounded-full bg-[var(--color-bg-subtle)] px-2.5 py-1 text-xs font-medium text-[var(--color-text-secondary)]">{initialReceipts.length} receipts</span>
        </div>

        {initialReceipts.length === 0 ? (
          <EmptyState title="No receipts yet" description="Scan your first receipt above. It will appear here with its file and status." className="m-4" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)]/60 text-[var(--color-text-secondary)]">
                <tr>
                  <th className="p-3 font-medium">Receipt</th>
                  <th className="p-3 font-medium">Vendor</th>
                  <th className="p-3 font-medium">Date</th>
                  <th className="p-3 text-right font-medium">Total</th>
                  <th className="p-3 font-medium">Status</th>
                  <th className="p-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-subtle)]">
                {initialReceipts.map((r) => {
                  const p = r.proposed || {};
                  const t = p.total ?? p.amount;
                  return (
                    <tr key={r.id} className="hover:bg-[var(--color-bg-subtle)]/30">
                      <td className="p-3">
                        <div className="flex min-w-0 items-center gap-2">
                          {r.mimeType.startsWith("image/") ? <ImageIcon aria-hidden className="size-4 shrink-0 text-[var(--color-text-secondary)]" /> : <FileText aria-hidden className="size-4 shrink-0 text-[var(--color-text-secondary)]" />}
                          <span className="max-w-[160px] truncate font-medium text-[var(--color-text-primary)]" title={r.originalName}>{r.originalName}</span>
                          {r.source === "telegram" && <span className="rounded bg-[var(--color-bg-subtle)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--color-text-secondary)]">Telegram</span>}
                        </div>
                      </td>
                      <td className="p-3 font-medium text-[var(--color-text-primary)]">{p.vendor || "—"}</td>
                      <td className="p-3 text-[var(--color-text-secondary)]">{p.date || "—"}</td>
                      <td className="p-3 text-right font-semibold text-[var(--color-text-primary)] whitespace-nowrap">{t != null ? `${Number(t).toFixed(2)} ${p.currency || "TND"}` : "—"}</td>
                      <td className="p-3">
                        {r.appliedToExpenseId ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-status-success-bg)] px-2 py-0.5 text-xs font-medium text-[var(--color-status-success)]">
                            <CheckCircle2 aria-hidden className="size-3.5" /> Expense created
                          </span>
                        ) : r.warnings.length ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-status-warning-bg)] px-2 py-0.5 text-xs font-medium text-[var(--color-status-warning)]" title={r.warnings.map((w) => w.message).join("\n")}>
                            <AlertTriangle aria-hidden className="size-3.5" /> Check {r.warnings.length}
                          </span>
                        ) : (
                          <span className="rounded-full bg-[var(--color-bg-subtle)] px-2 py-0.5 text-xs font-medium text-[var(--color-text-secondary)]">Needs review</span>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            className="min-h-[36px] px-3 text-xs"
                            onClick={() =>
                              openReview({
                                extractionId: r.id,
                                receiptDocumentId: r.hasFile ? r.receiptDocumentId : null,
                                mimeType: r.mimeType,
                                proposed: p,
                                warnings: r.warnings,
                                duplicateFile: false,
                                possibleDuplicateExpenseId: r.possibleDuplicateExpenseId ?? null,
                                appliedToExpenseId: r.appliedToExpenseId,
                              })
                            }
                          >
                            <ScanLine aria-hidden className="size-3.5 shrink-0" /> {r.appliedToExpenseId ? "View" : "Review"}
                          </Button>
                          {canScan && !r.appliedToExpenseId && (
                            confirmDelete === r.id ? (
                              <>
                                <Button variant="danger" className="min-h-[36px] px-3 text-xs" onClick={() => handleDelete(r.id)} disabled={pending}>Confirm</Button>
                                <Button variant="ghost" className="min-h-[36px] px-3 text-xs" onClick={() => setConfirmDelete(null)}>Cancel</Button>
                              </>
                            ) : (
                              <Button variant="ghost" className="min-h-[36px] px-2 text-xs text-[var(--color-status-error)]" aria-label={`Delete ${r.originalName}`} title="Delete this scan and its file" onClick={() => setConfirmDelete(r.id)}>
                                <Trash2 aria-hidden className="size-4 shrink-0" />
                              </Button>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
