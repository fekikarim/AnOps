import "server-only";
import type { PurchaseOrderStatus } from "@/server/db/documents";
import { AppError } from "@/shared/lib/errors";

/**
 * Legal purchase-order transitions. Every status change in the service layer goes
 * through assertPurchaseOrderTransition, and the database update repeats the source
 * status in its filter so a stale request cannot apply a transition twice.
 *
 * - draft -> approved: approval does not change stock; only posted receipts do.
 * - approved -> cancelled: allowed only while nothing has been received (checked by the service).
 * - partially_received -> received happens automatically when the last line is fully received.
 * - Each posted receipt moves the order to partially_received or received, so approved -> approved never occurs.
 * - Short-closing a partially received order is not implemented.
 */
const TRANSITIONS: Record<PurchaseOrderStatus, readonly PurchaseOrderStatus[]> = {
  draft: ["approved", "cancelled"],
  approved: ["partially_received", "received", "cancelled"],
  // A later partial receipt keeps the order partially received; the last one completes it.
  partially_received: ["partially_received", "received"],
  received: [],
  cancelled: [],
};

export function canTransitionPurchaseOrder(from: PurchaseOrderStatus, to: PurchaseOrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertPurchaseOrderTransition(from: PurchaseOrderStatus, to: PurchaseOrderStatus): void {
  if (!canTransitionPurchaseOrder(from, to)) {
    throw new AppError("INVALID_TRANSITION", `A purchase order cannot move from ${from} to ${to}`);
  }
}

/** Status after posting a receipt, given the line quantities after the receipt. */
export function statusAfterReceipt(lines: { orderedMicro: number; receivedMicro: number }[]): PurchaseOrderStatus {
  const complete = lines.every((line) => line.receivedMicro >= line.orderedMicro);
  return complete ? "received" : "partially_received";
}
