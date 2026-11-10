"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  cancelWorkOrderAction,
  completeWorkOrderAction,
  startWorkOrderAction,
} from "@/features/manufacturing/actions/manufacturing.action";
import { Button } from "@/shared/components/ui/button";
import { FormMessage } from "@/shared/components/ui/form-message";

type Action = "start" | "complete" | "cancel";

const CONFIRM_TEXT: Record<Action, string> = {
  start: "Start production? Materials are not consumed until you complete the order.",
  complete: "Complete this order? Components will be consumed and finished goods added to stock. If any component is short, nothing changes.",
  cancel: "Cancel this work order? No stock is affected.",
};

/** Shows only transitions the server reports as allowed. Completion needs an explicit confirmation step. */
export function WorkOrderActions({
  orderId,
  version,
  canStart,
  canComplete,
  canCancel,
}: {
  orderId: string;
  version: number;
  canStart: boolean;
  canComplete: boolean;
  canCancel: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<Action | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  if (!canStart && !canComplete && !canCancel) return null;

  const run = (action: Action) => {
    setMessage(null);
    startTransition(async () => {
      const result =
        action === "start"
          ? await startWorkOrderAction(orderId, version)
          : action === "complete"
            ? await completeWorkOrderAction(orderId, version)
            : await cancelWorkOrderAction(orderId, version);
      setConfirming(null);
      if (!result.ok) {
        setMessage({ kind: "error", text: `${result.error.message} (ref ${result.error.requestId.slice(0, 8)})` });
        router.refresh();
        return;
      }
      setMessage({
        kind: "success",
        text: action === "start" ? "Production started." : action === "complete" ? "Order completed. Stock has been updated." : "Work order cancelled.",
      });
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {canStart && confirming !== "start" && <Button variant="primary" onClick={() => setConfirming("start")} disabled={pending}>Start production</Button>}
        {canComplete && confirming !== "complete" && <Button variant="primary" onClick={() => setConfirming("complete")} disabled={pending}>Complete order</Button>}
        {canCancel && confirming !== "cancel" && <Button variant="danger" onClick={() => setConfirming("cancel")} disabled={pending}>Cancel order</Button>}
      </div>
      {confirming && (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-border-control)] p-3">
          <span className="text-sm">{CONFIRM_TEXT[confirming]}</span>
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
