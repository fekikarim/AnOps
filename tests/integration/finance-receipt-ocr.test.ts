import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHarness, type TestHarness } from "../helpers/workspace";
import type { AiCompletionOptions, AiCompletionResult } from "@/server/ai/types";

const shared = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/server/db/client", () => ({ default: Promise.resolve({ db: () => shared.db }) }));
vi.mock("@/server/tenant/context", () => ({ getActiveTenant: async () => null }));

const { scanReceipt, applyReceiptToExpense } = await import("@/server/finance/receipt-ocr.service");
const { readReceiptFile } = await import("@/server/finance/receipt-storage");
const { fin } = await import("@/server/ai/tools/finance.tools");

let h: TestHarness;
beforeAll(async () => {
  h = await createHarness();
  shared.db = h.db;
});
afterAll(async () => h.cleanup());

const JPEG = (seed: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, seed, seed + 1, seed + 2, 0xff, 0xd9]);
const PDF = new Uint8Array([..."%PDF-1.4 receipt"].map((c) => c.charCodeAt(0)));

/** A stand-in model: records what it was shown and answers with a fixed receipt. */
function stubModel(answer: Record<string, unknown> | string) {
  const calls: AiCompletionOptions[] = [];
  const complete = async (o: Omit<AiCompletionOptions, "signal">): Promise<AiCompletionResult> => {
    calls.push(o as AiCompletionOptions);
    return { text: typeof answer === "string" ? answer : JSON.stringify(answer), provider: "Gemini", model: "stub" };
  };
  return { calls, complete };
}

const receipt = { vendor: "Monoprix", date: "2026-10-12", currency: "TND", subtotal: 71.01, tax: 13.49, total: 84.5, category: "Office & Supplies", description: "Paper and toner", confidence: 0.92 };

describe("receipt OCR pipeline", () => {
  it("stores the file, shows the model the image itself, and returns a reviewed proposal", async () => {
    const m = stubModel(receipt);
    const scan = await scanReceipt(h.ctx(), { bytes: JPEG(1), originalName: "ticket.jpg", source: "upload" }, { complete: m.complete });
    const attachment = m.calls[0].messages.find((x) => x.role === "user")?.attachments?.[0];
    expect(attachment?.mimeType).toBe("image/jpeg");
    expect(Buffer.from(attachment!.dataBase64, "base64")).toEqual(Buffer.from(JPEG(1)));
    expect(scan.proposed).toMatchObject({ vendor: "Monoprix", total: 84.5, categoryName: "Office & Supplies", confidence: 0.92 });
    expect(scan.warnings).toEqual([]);
    const stored = await readReceiptFile(h.db, h.ctx().companyId, scan.receiptDocumentId!);
    expect(stored?.document.mimeType).toBe("image/jpeg");
  });

  it("the same file twice costs no second AI call and is reported as a duplicate", async () => {
    const m = stubModel(receipt);
    const first = await scanReceipt(h.ctx(), { bytes: JPEG(7), originalName: "a.jpg", source: "upload" }, { complete: m.complete });
    const again = await scanReceipt(h.ctx(), { bytes: JPEG(7), originalName: "renamed.jpg", source: "telegram" }, { complete: m.complete });
    expect(m.calls).toHaveLength(1);
    expect(again).toMatchObject({ duplicateFile: true, extractionId: first.extractionId, receiptDocumentId: first.receiptDocumentId });
  });

  it("PDFs are passed as PDFs; files that are not images or PDFs are refused before any AI call", async () => {
    const m = stubModel(receipt);
    await scanReceipt(h.ctx(), { bytes: PDF, originalName: "invoice.pdf", source: "upload" }, { complete: m.complete });
    expect(m.calls[0].messages[1].attachments?.[0].mimeType).toBe("application/pdf");
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]);
    await expect(scanReceipt(h.ctx(), { bytes: exe, originalName: "receipt.jpg", source: "upload" }, { complete: m.complete })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(m.calls).toHaveLength(1);
  });

  it("repairs one bad reply, then gives up with a clear error", async () => {
    let n = 0;
    const flaky = async (): Promise<AiCompletionResult> => ({ text: n++ === 0 ? "sorry, cannot" : JSON.stringify(receipt), provider: "Gemini", model: "stub" });
    expect((await scanReceipt(h.ctx(), { text: "MONOPRIX TOTAL 84.500", source: "upload" }, { complete: flaky })).proposed.vendor).toBe("Monoprix");
    const broken = stubModel("not json at all");
    await expect(scanReceipt(h.ctx(), { text: "x", source: "upload" }, { complete: broken.complete })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(broken.calls).toHaveLength(2);
  });

  it("a viewer cannot scan, and another company cannot read the stored file", async () => {
    const m = stubModel(receipt);
    await expect(scanReceipt(h.ctx("viewer"), { bytes: JPEG(20), originalName: "v.jpg", source: "upload" }, { complete: m.complete })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const scan = await scanReceipt(h.ctx(), { bytes: JPEG(30), originalName: "mine.jpg", source: "upload" }, { complete: m.complete });
    expect(await readReceiptFile(h.db, h.otherTenant().companyId, scan.receiptDocumentId!)).toBeNull();
  });

  it("applying creates one draft expense linked to the receipt, flags a later look-alike, and cannot be applied twice", async () => {
    const m = stubModel({ ...receipt, vendor: "Carrefour", total: 42, subtotal: 35.29, tax: 6.71 });
    const scan = await scanReceipt(h.ctx(), { bytes: JPEG(40), originalName: "c.jpg", source: "upload" }, { complete: m.complete });
    const values = { expenseDate: "2026-10-12", vendor: "Carrefour", description: "Groceries for office", amount: 35.29, tax: 6.71, currency: "TND" };
    const results = await Promise.allSettled([applyReceiptToExpense(h.ctx(), scan.extractionId, values), applyReceiptToExpense(h.ctx(), scan.extractionId, values)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const { expenseId } = (results.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ expenseId: string }>).value;
    const expense = await fin(h.ctx()).getExpense(expenseId);
    expect(expense).toMatchObject({ status: "draft", total: 42, receiptDocumentId: scan.receiptDocumentId });

    const lookAlike = await scanReceipt(h.ctx(), { bytes: JPEG(41), originalName: "c2.jpg", source: "upload" }, { complete: stubModel({ ...receipt, vendor: "carrefour", date: "2026-10-12", total: 42, subtotal: 35.29, tax: 6.71 }).complete });
    expect(lookAlike.possibleDuplicateExpenseId).toBe(expenseId);
    expect(lookAlike.warnings.map((w) => w.code)).toContain("possible_duplicate");
  });

  it("a receipt attached to an expense cannot be deleted until the expense is gone", async () => {
    const m = stubModel({ ...receipt, vendor: "Total Energies" });
    const scan = await scanReceipt(h.ctx(), { bytes: JPEG(50), originalName: "fuel.jpg", source: "upload" }, { complete: m.complete });
    const { expenseId } = await applyReceiptToExpense(h.ctx(), scan.extractionId, { expenseDate: "2026-10-12", description: "Fuel", amount: 50, currency: "TND" });
    const svc = fin(h.ctx());
    await expect(svc.deleteReceiptExtraction(scan.extractionId)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await svc.deleteExpense(expenseId);
    await svc.deleteReceiptExtraction(scan.extractionId);
    expect(await readReceiptFile(h.db, h.ctx().companyId, scan.receiptDocumentId!)).toBeNull();
  });
});
