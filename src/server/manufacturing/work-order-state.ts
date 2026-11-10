import "server-only";
import type { WorkOrderStatus } from "@/server/db/documents";
import { AppError } from "@/shared/lib/errors";

/**
 * Work-order lifecycle: draft -> in_progress -> completed, with cancellation before completion.
 * Materials are consumed at completion (not at start), so cancelling an in-progress order
 * never needs to return stock. Partial production and scrap are not supported yet.
 */
const TRANSITIONS: Record<WorkOrderStatus, readonly WorkOrderStatus[]> = {
  draft: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function assertWorkOrderTransition(from: WorkOrderStatus, to: WorkOrderStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new AppError("INVALID_TRANSITION", `A work order cannot move from ${from} to ${to}`);
  }
}
