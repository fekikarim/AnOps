"use client";

import { confirmAction } from "@/shared/components/ui/confirm-dialog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { createTelegramLinkAction, disconnectTelegramAction } from "@/features/marketing/actions/contacts.action";
import { Button } from "@/shared/components/ui/button";
import { StatusBadge, type BadgeTone } from "@/shared/components/data-display/status-badge";
import { useToast } from "@/shared/components/ui/toast";
import { formatDateTime } from "@/shared/lib/format";
import type { TelegramConnectionDto, TelegramLinkDto } from "@/server/marketing/telegram.service";

const STATUS: Record<TelegramConnectionDto["status"], { label: string; tone: BadgeTone }> = {
  not_connected: { label: "Not connected", tone: "neutral" },
  active: { label: "Connected", tone: "success" },
  blocked: { label: "Unreachable", tone: "warning" },
  disconnected: { label: "Disconnected", tone: "neutral" },
};

const POLL_MS = 4_000;

/**
 * Telegram link for one contact. The customer proves they control a chat by pressing Start on a personal,
 * single-use link; nothing typed in this screen can set a chat. While a link is waiting, the page re-reads
 * the connection every few seconds, so the status flips to Connected as soon as the customer presses Start.
 */
export function TelegramConnection({
  contactId,
  connection,
  botReady,
  canManage,
  consentGranted,
}: {
  contactId: string;
  connection: TelegramConnectionDto;
  botReady: boolean;
  canManage: boolean;
  consentGranted: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<TelegramLinkDto | null>(null);
  const connected = connection.status === "active";
  const waiting = Boolean(link) && !connected;

  // Once the customer has pressed Start the link is spent, so it is dropped during render (not in an effect).
  if (connected && link) setLink(null);

  useEffect(() => {
    if (!waiting || !link) return;
    const timer = window.setInterval(() => {
      if (Date.now() >= new Date(link.expiresAt).getTime()) {
        setLink(null);
        return;
      }
      router.refresh();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [waiting, link, router]);

  const generate = () =>
    startTransition(async () => {
      const result = await createTelegramLinkAction(contactId);
      if (!result.ok) return toast.fromError(result.error);
      setLink(result.data);
    });

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      toast.success("Link copied.");
    } catch {
      toast.error("Could not copy", "Select the link and copy it by hand.");
    }
  };

  const disconnect = async () => {
    if (!(await confirmAction({ title: "Disconnect from Telegram?", message: "Campaigns will skip this contact until they connect again.", tone: "warning", confirmLabel: "Disconnect" }))) return;
    startTransition(async () => {
      const result = await disconnectTelegramAction(contactId);
      if (!result.ok) return toast.fromError(result.error);
      toast.success("Telegram disconnected.");
      setLink(null);
      router.refresh();
    });
  };

  const status = STATUS[connection.status];
  const label = connected ? "Regenerate link" : connection.status === "not_connected" ? "Connect Telegram" : "Reconnect Telegram";

  return (
    <section aria-labelledby="contact-telegram" className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="contact-telegram" className="text-base font-semibold">Telegram</h2>
        <StatusBadge label={status.label} tone={status.tone} />
      </div>
      <p className="mt-1 max-w-[65ch] text-sm text-[var(--color-text-secondary)]">
        The customer connects their own chat by pressing Start on a personal link. Connecting lets you reach them on Telegram; it does not
        mean they agreed to marketing, so record that consent separately below.
      </p>

      {connection.status !== "not_connected" && (
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-[var(--color-text-secondary)]">Account</dt>
          <dd>{connection.username ? `@${connection.username}` : "No public username"} <span className="tabular-nums text-[var(--color-text-secondary)]">· chat {connection.chatHint}</span></dd>
          <dt className="text-[var(--color-text-secondary)]">{connection.status === "disconnected" ? "Disconnected" : "Connected"}</dt>
          <dd>{formatDateTime(connection.status === "disconnected" && connection.disconnectedAt ? connection.disconnectedAt : connection.connectedAt ?? "")}</dd>
          {connection.status === "blocked" && (
            <>
              <dt className="text-[var(--color-text-secondary)]">Problem</dt>
              <dd>The customer blocked the bot or the chat can no longer be reached. Ask them to press Start again on a new link.</dd>
            </>
          )}
        </dl>
      )}

      {connected && !consentGranted && (
        <p role="status" className="mt-4 rounded-[var(--radius-control)] bg-[var(--color-status-warning-bg)] p-3 text-sm text-[var(--color-status-warning)]">
          Connected, but no Telegram marketing consent is recorded. Campaigns skip this contact until you record it in the consent section.
        </p>
      )}

      {!botReady && (
        <p role="status" className="mt-4 rounded-[var(--radius-control)] bg-[var(--color-status-warning-bg)] p-3 text-sm text-[var(--color-status-warning)]">
          The Telegram bot is not set up on this server, so links cannot be created. See <Link className="underline" href="/marketing/integrations">Integrations</Link>.
        </p>
      )}

      {canManage && botReady && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant={connected ? "secondary" : "primary"} disabled={pending} onClick={generate}>{pending && !link ? "Creating link…" : label}</Button>
          {(connected || connection.status === "blocked") && (
            <Button variant="danger" disabled={pending} onClick={disconnect}>Disconnect</Button>
          )}
        </div>
      )}

      {link && !connected && (
        <div className="mt-4 space-y-3 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] p-4">
          <p className="text-sm font-semibold">Send this link to the customer</p>
          <label htmlFor="telegram-link" className="sr-only">Telegram connection link</label>
          <input
            id="telegram-link"
            readOnly
            value={link.url}
            onFocus={(event) => event.currentTarget.select()}
            className="min-h-[44px] w-full rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 font-mono text-xs"
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={copy}>Copy link</Button>
            <a href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-border-control)] px-4 text-sm font-medium hover:bg-[var(--color-bg-surface)]">
              Open in Telegram
            </a>
          </div>
          <p className="text-xs text-[var(--color-text-secondary)]" aria-live="polite">
            Works once and expires at {formatDateTime(link.expiresAt)}. Waiting for the customer to press Start; this page updates by itself.
          </p>
        </div>
      )}

      {connection.history.length > 0 && (
        <>
          <h3 className="mt-6 text-sm font-semibold">Connection history</h3>
          <ol className="mt-2 divide-y divide-[var(--color-border-subtle)] text-sm">
            {connection.history.slice(0, 8).map((item, index) => (
              <li key={`${item.type}-${item.at}-${index}`} className="flex flex-col gap-1 py-2 sm:flex-row sm:justify-between">
                <span>{item.label}</span>
                <span className="tabular-nums text-[var(--color-text-secondary)]">{formatDateTime(item.at)}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
