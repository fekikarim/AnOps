"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink, Link2Off, Loader2, Send, Smartphone } from "lucide-react";
import { createTelegramReceiptLinkAction, disconnectTelegramReceiptsAction } from "@/features/finance/actions/telegram.actions";
import { Button, buttonClass } from "@/shared/components/ui/button";
import { FormMessage } from "@/shared/components/ui/form-message";
import { useToast } from "@/shared/components/ui/toast";

type Status = { botConfigured: boolean; linked: boolean; username: string | null; linkedAt: string | null };

/** Connects the member's own Telegram chat, so a photo sent to the bot becomes a draft expense. */
export function TelegramReceiptsCard({ status, canCapture }: { status: Status; canCapture: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  if (!canCapture) return null;

  function createLink() {
    setError(null);
    startTransition(async () => {
      const res = await createTelegramReceiptLinkAction();
      if (res.error || !res.data) return setError(res.error ?? "The link could not be created.");
      setLink(res.data);
    });
  }

  function disconnect() {
    setConfirming(false);
    startTransition(async () => {
      const res = await disconnectTelegramReceiptsAction();
      if (res.error) return toast.error("Not disconnected", res.error);
      toast.success("Telegram disconnected", "Photos sent to the bot will no longer reach this company.");
      router.refresh();
    });
  }

  const expires = link ? new Date(link.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <section aria-labelledby="tg-heading" className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 sm:p-6" data-tour="receipt-telegram">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-action-primary)]/10 text-[var(--color-action-primary)]">
            <Smartphone aria-hidden className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 id="tg-heading" className="text-base font-semibold text-[var(--color-text-primary)]">Receipts from Telegram</h2>
            <p className="text-sm text-[var(--color-text-secondary)]">
              {status.linked
                ? "Send a photo of any receipt to the AnOps bot and it becomes a draft expense here."
                : "Connect your Telegram once, then just send receipt photos to the AnOps bot: no app, no typing."}
            </p>
          </div>
        </div>

        {!status.botConfigured ? null : status.linked ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-status-success-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--color-status-success)]">
              <CheckCircle2 aria-hidden className="size-3.5 shrink-0" /> Connected{status.username ? ` as @${status.username}` : ""}
            </span>
            {confirming ? (
              <>
                <Button variant="danger" onClick={disconnect} disabled={pending}>Disconnect</Button>
                <Button variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>Keep</Button>
              </>
            ) : (
              <Button variant="ghost" onClick={() => setConfirming(true)} disabled={pending} title="Stop receiving receipts from this Telegram chat">
                <Link2Off aria-hidden className="size-4 shrink-0" /> Disconnect
              </Button>
            )}
          </div>
        ) : (
          <Button variant="primary" onClick={createLink} disabled={pending}>
            {pending ? <Loader2 aria-hidden className="size-4 shrink-0 animate-spin motion-reduce:animate-none" /> : <Send aria-hidden className="size-4 shrink-0" />}
            Connect Telegram
          </Button>
        )}
      </div>

      {!status.botConfigured && (
        <p className="mt-3 rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] px-3 py-2.5 text-sm text-[var(--color-text-secondary)]">
          The Telegram bot is not set up on this server yet (TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME and TELEGRAM_WEBHOOK_SECRET).
        </p>
      )}

      {link && !status.linked && (
        <div className="mt-4 space-y-3 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] p-4">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-[var(--color-text-primary)]">
            <li>Open the link on the phone where you use Telegram.</li>
            <li>Press <strong>Start</strong> in the bot.</li>
            <li>Send a receipt photo. That&apos;s it.</li>
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            <a href={link.url} target="_blank" rel="noreferrer" className={buttonClass("primary")}>
              <ExternalLink aria-hidden className="size-4 shrink-0" /> Open in Telegram
            </a>
            <Button
              onClick={() => {
                navigator.clipboard?.writeText(link.url).then(
                  () => toast.success("Link copied", "Paste it on your phone."),
                  () => toast.error("Could not copy", "Select the link and copy it.")
                );
              }}
            >
              Copy link
            </Button>
            <Button variant="ghost" onClick={() => router.refresh()} title="Refresh after pressing Start in Telegram">
              I pressed Start
            </Button>
          </div>
          <p className="break-all text-xs text-[var(--color-text-secondary)]">
            {link.url} · single use, expires at {expires}.
          </p>
        </div>
      )}

      {error && <div className="mt-3"><FormMessage kind="error">{error}</FormMessage></div>}
    </section>
  );
}
