"use client";

import { confirmAction } from "@/shared/components/ui/confirm-dialog";
import { useToast } from "@/shared/components/ui/toast";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { disconnectSocialAccountAction, startSocialConnectionAction } from "@/features/marketing/actions/social.action";
import { Button } from "@/shared/components/ui/button";
import { StatusBadge } from "@/shared/components/data-display/status-badge";
import { formatDateTime } from "@/shared/lib/format";
import type { SocialAccountDto, SocialIntegrationDto } from "@/server/marketing/social/accounts.service";

const STATUS: Record<SocialAccountDto["connectionStatus"], { label: string; tone: "success" | "warning" | "neutral" }> = {
  connected: { label: "Connected", tone: "success" },
  reauthorization_required: { label: "Reconnect needed", tone: "warning" },
  disconnected: { label: "Disconnected", tone: "neutral" },
};

/**
 * Connected accounts and the connect flow. When the integration is not configured the connect button is
 * replaced by an explanation listing the variable names that are missing (never their values).
 */
export function SocialAccounts({
  accounts,
  integration,
  canManage,
  notice,
}: {
  accounts: SocialAccountDto[];
  integration: SocialIntegrationDto;
  canManage: boolean;
  notice: { kind: "error" | "success"; text: string } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const connect = () =>
    startTransition(async () => {
      const result = await startSocialConnectionAction();
      if (!result.ok) return toast.fromError(result.error);
      window.location.assign(result.data.authorizationUrl);
    });

  const disconnect = async (account: SocialAccountDto) => {
    if (!(await confirmAction({ title: `Disconnect "${account.displayName}"?`, message: "Scheduled posts for this page will be cancelled.", tone: "warning", confirmLabel: "Disconnect" }))) return;
    startTransition(async () => {
      const result = await disconnectSocialAccountAction(account.id, { expectedVersion: account.version });
      if (!result.ok) return toast.fromError(result.error);
      toast.success("Account disconnected. Its stored token has been removed.");
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">

      {!integration.configured ? (
        <div role="status" className="rounded-[var(--radius-card)] border border-[var(--color-status-warning)] bg-[var(--color-status-warning-bg)] p-4 text-sm">
          <p className="font-semibold text-[var(--color-status-warning)]">Facebook Pages are not connected on this server.</p>
          <p className="mt-1 text-[var(--color-text-secondary)]">
            {integration.reason} Missing: {integration.missing.join(", ")}. Setup steps are in docs/MARKETING.md.
          </p>
        </div>
      ) : canManage ? (
        <Button variant="primary" disabled={pending} onClick={connect}>{pending ? "Redirecting…" : "Connect a Facebook Page"}</Button>
      ) : null}

      {accounts.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border-control)] p-6 text-sm text-[var(--color-text-secondary)]">
          No connected accounts. Posts can only be scheduled for connected Pages.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--color-border-subtle)] rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
          {accounts.map((account) => (
            <li key={account.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="break-words font-semibold">{account.displayName}</p>
                <p className="text-sm text-[var(--color-text-secondary)]">{account.platformLabel} · connected {formatDateTime(account.connectedAt)}</p>
                {account.lastErrorCode && <p className="text-xs text-[var(--color-status-warning)]">Last error: {account.lastErrorCode}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge label={STATUS[account.connectionStatus].label} tone={STATUS[account.connectionStatus].tone} />
                {canManage && account.connectionStatus !== "disconnected" && (
                  <Button disabled={pending} onClick={() => disconnect(account)}>Disconnect</Button>
                )}
                {canManage && account.connectionStatus === "reauthorization_required" && integration.configured && (
                  <Button variant="primary" disabled={pending} onClick={connect}>Reconnect</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-[var(--color-text-secondary)]">
        Only Facebook Pages are supported. Instagram publishing needs separate Meta review and is not offered. Tokens are encrypted on the server and never shown.
      </p>
    </div>
  );
}
