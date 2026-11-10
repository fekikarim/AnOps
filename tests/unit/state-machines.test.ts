import { describe, expect, it } from "vitest";
import { assertPurchaseOrderTransition, canTransitionPurchaseOrder, statusAfterReceipt } from "@/server/purchasing/order-state";
import { assertWorkOrderTransition } from "@/server/manufacturing/work-order-state";
import { AppError } from "@/shared/lib/errors";

describe("purchase order transitions", () => {
  it("allows the documented lifecycle", () => {
    expect(canTransitionPurchaseOrder("draft", "approved")).toBe(true);
    expect(canTransitionPurchaseOrder("approved", "partially_received")).toBe(true);
    expect(canTransitionPurchaseOrder("partially_received", "partially_received")).toBe(true);
    expect(canTransitionPurchaseOrder("partially_received", "received")).toBe(true);
    expect(canTransitionPurchaseOrder("approved", "cancelled")).toBe(true);
  });

  it("rejects jumps that skip the workflow", () => {
    expect(canTransitionPurchaseOrder("draft", "received")).toBe(false);
    expect(canTransitionPurchaseOrder("draft", "partially_received")).toBe(false);
    expect(canTransitionPurchaseOrder("received", "cancelled")).toBe(false);
    expect(canTransitionPurchaseOrder("cancelled", "approved")).toBe(false);
    expect(canTransitionPurchaseOrder("partially_received", "cancelled")).toBe(false);
  });

  it("throws INVALID_TRANSITION with a stable code", () => {
    try {
      assertPurchaseOrderTransition("draft", "received");
      throw new Error("expected a transition error");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("INVALID_TRANSITION");
      expect((error as AppError).status).toBe(409);
    }
  });

  it("derives the status after a receipt from line quantities", () => {
    expect(statusAfterReceipt([{ orderedMicro: 10, receivedMicro: 4 }])).toBe("partially_received");
    expect(statusAfterReceipt([{ orderedMicro: 10, receivedMicro: 10 }, { orderedMicro: 2, receivedMicro: 2 }])).toBe("received");
  });
});

describe("work order transitions", () => {
  it("only starts from draft and completes from in_progress", () => {
    expect(() => assertWorkOrderTransition("draft", "in_progress")).not.toThrow();
    expect(() => assertWorkOrderTransition("in_progress", "completed")).not.toThrow();
    expect(() => assertWorkOrderTransition("draft", "completed")).toThrow(AppError);
    expect(() => assertWorkOrderTransition("completed", "in_progress")).toThrow(AppError);
    expect(() => assertWorkOrderTransition("cancelled", "in_progress")).toThrow(AppError);
  });
});
