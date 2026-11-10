"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteProductAction, setProductActiveAction } from "@/features/inventory/actions/inventory.action";
import { Button } from "@/shared/components/ui/button";
import { FormMessage } from "@/shared/components/ui/form-message";

/** Archive/restore and permanent delete. Deletion asks for a second confirmation and is refused server-side when the product is referenced. */
export function ProductActions({ productId, isActive }: { productId: string; isActive: boolean }) {
  const router = useRouter();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await setProductActiveAction(productId, !isActive);
      if (!result.ok) return setMessage(result.error.message);
      router.refresh();
    });
  };

  const remove = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await deleteProductAction(productId);
      if (!result.ok) return setMessage(result.error.message);
      router.push("/inventory/products");
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button onClick={toggle} disabled={pending}>
          {isActive ? "Archive product" : "Restore product"}
        </Button>
        {!confirmingDelete ? (
          <Button variant="danger" onClick={() => setConfirmingDelete(true)} disabled={pending}>
            Delete
          </Button>
        ) : (
          <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-status-error)] p-2">
            <span className="text-sm text-[var(--color-text-primary)]">Delete permanently? Only unused products can be deleted.</span>
            <Button variant="danger" onClick={remove} disabled={pending}>
              Confirm delete
            </Button>
            <Button onClick={() => setConfirmingDelete(false)} disabled={pending}>
              Keep
            </Button>
          </div>
        )}
      </div>
      {message && <FormMessage kind="error">{message}</FormMessage>}
    </div>
  );
}
