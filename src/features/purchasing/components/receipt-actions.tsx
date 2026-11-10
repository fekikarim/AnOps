"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelReceiptAction, postReceiptAction } from "@/features/purchasing/actions/purchasing.action";
import { Button } from "@/shared/components/ui/button";
import { FormMessage } from "@/shared/components/ui/form-message";

/** Posting moves stock. It needs an explicit confirmation step and is refused by the server if the order has changed. */
export function ReceiptActions({ receiptId, canPost, canCancel }: { receiptId: string; canPost: boolean; canCancel: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<"post" | "cancel" | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  if (!canPost && !canCancel) return null;

  const run = (action: "post" | "cancel") => {
    setMessage(null);
    startTransition(async () => {
      const result = action === "post" ? await postReceiptAction(receiptId) : await cancelReceiptAction(receiptId);
      setConfirming(null);
      if (!result.ok) {
        setMessage({ kind: "error", text: `${result.error.message} (ref ${result.error.requestId.slice(0, 8)})` });
        return;
      }
      setMessage({ kind: "success", text: action === "post" ? "Receipt posted. Stock has been updated." : "Receipt cancelled." });
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {canPost && confirming !== "post" && <Button variant="primary" onClick={() => setConfirming("post")} disabled={pending}>Post receipt</Button>}
        {canCancel && confirming !== "cancel" && <Button variant="danger" onClick={() => setConfirming("cancel")} disabled={pending}>Cancel draft</Button>}
      </div>
      {confirming && (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-border-control)] p-3">
          <span className="text-sm">
            {confirming === "post"
              ? "Post this receipt? Stock will increase in the receiving warehouse. Posted receipts cannot be edited."
              : "Cancel this draft? No stock changes."}
          </span>
          <Button variant={confirming === "post" ? "primary" : "danger"} onClick={() => run(confirming)} disabled={pending}>
            {pending ? "Working…" : "Confirm"}
          </Button>
          <Button onClick={() => setConfirming(null)} disabled={pending}>Back</Button>
        </div>
      )}
      {message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}
    </div>
  );
}
