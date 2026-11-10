"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { approvePurchaseOrderAction, cancelPurchaseOrderAction } from "@/features/purchasing/actions/purchasing.action";
import { Button } from "@/shared/components/ui/button";
import { FormMessage } from "@/shared/components/ui/form-message";

/**
 * Approval and cancellation. The buttons only show what the server reports as allowed,
 * and the server re-checks the state and permission on every call.
 */
export function OrderActions({
  orderId,
  version,
  canApprove,
  canCancel,
}: {
  orderId: string;
  version: number;
  canApprove: boolean;
  canCancel: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [confirming, setConfirming] = useState<"approve" | "cancel" | null>(null);
  const [pending, startTransition] = useTransition();

  if (!canApprove && !canCancel) return null;

  const run = (action: "approve" | "cancel") => {
    setMessage(null);
    startTransition(async () => {
      const result =
        action === "approve"
          ? await approvePurchaseOrderAction(orderId, version)
          : await cancelPurchaseOrderAction(orderId, version);
      setConfirming(null);
      if (!result.ok) {
        setMessage({ kind: "error", text: `${result.error.message} (ref ${result.error.requestId.slice(0, 8)})` });
        return;
      }
      setMessage({ kind: "success", text: action === "approve" ? "Order approved. Stock is unchanged until goods are received." : "Order cancelled." });
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {canApprove && confirming !== "approve" && (
          <Button variant="primary" onClick={() => setConfirming("approve")} disabled={pending}>Approve order</Button>
        )}
        {canCancel && confirming !== "cancel" && (
          <Button variant="danger" onClick={() => setConfirming("cancel")} disabled={pending}>Cancel order</Button>
        )}
      </div>
      {confirming && (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-border-control)] p-3">
          <span className="text-sm">
            {confirming === "approve"
              ? "Approve this order for the supplier? Approval does not add stock."
              : "Cancel this order? This cannot be undone."}
          </span>
          <Button variant={confirming === "cancel" ? "danger" : "primary"} onClick={() => run(confirming)} disabled={pending}>
            {pending ? "Working…" : "Confirm"}
          </Button>
          <Button onClick={() => setConfirming(null)} disabled={pending}>Back</Button>
        </div>
      )}
      {message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}
    </div>
  );
}
