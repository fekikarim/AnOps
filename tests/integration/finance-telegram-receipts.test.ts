import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

// Test values only; read lazily by the Telegram config.
process.env.TELEGRAM_BOT_TOKEN = "123456789:TEST_TOKEN_abcdefghijklmnopqrstuvwxyz012";
process.env.TELEGRAM_BOT_USERNAME = "AnOpsTestBot";
process.env.TELEGRAM_WEBHOOK_SECRET = "w".repeat(40);

import { createHarness, type TestHarness } from "../helpers/workspace";
import { seedMember, wsOf, type SeededMember } from "../helpers/ai";
import type { AiCompletionResult } from "@/server/ai/types";

const shared = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/server/db/client", () => ({ default: Promise.resolve({ db: () => shared.db }) }));
vi.mock("@/server/tenant/context", () => ({ getActiveTenant: async () => null }));

const tg = await import("@/server/finance/telegram-receipts.service");
const { scanReceipt } = await import("@/server/finance/receipt-ocr.service");
const { processTelegramUpdate } = await import("@/server/marketing/telegram.service");
const { fin } = await import("@/server/ai/tools/finance.tools");

let h: TestHarness;
let owner: SeededMember;
let employee: SeededMember;
let otherOwner: SeededMember;

const JPEG = (seed: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, seed, seed + 1, 0xff, 0xd9]);
const receipt = { vendor: "Shell Lac", date: "2026-10-20", currency: "TND", subtotal: 50, tax: 9.5, total: 59.5, category: "Travel & Transport", description: "Fuel", confidence: 0.9 };
const stubScan = (answer: Record<string, unknown> = receipt): typeof scanReceipt => (ctx, input) =>
  scanReceipt(ctx, input, { complete: async (): Promise<AiCompletionResult> => ({ text: JSON.stringify(answer), provider: "stub", model: "stub" }) });

function harnessDeps(answer?: Record<string, unknown>) {
  const sent: Array<{ chatId: string; text: string }> = [];
  let seed = Math.floor(Math.random() * 200);
  return {
    sent,
    deps: {
      send: async (chatId: string, text: string) => void sent.push({ chatId, text }),
      download: async () => JPEG(seed++),
      scan: stubScan(answer),
    },
  };
}

const linkFor = async (member: SeededMember) => {
  const { url } = await tg.createStaffTelegramLink(wsOf(h, member));
  return new URL(url).searchParams.get("start")!;
};
const photo = (chatId: number, caption?: string) => ({ chatId, username: "staff", caption, photo: [{ file_id: "small", file_unique_id: "u1", file_size: 100 }, { file_id: "big", file_unique_id: "u2", file_size: 9000 }] });

beforeAll(async () => {
  h = await createHarness();
  shared.db = h.db;
  await h.db.collection("companies").insertMany([
    { _id: h.ctx().companyId, name: "Company A", currency: "TND" },
    { _id: h.otherTenant().companyId, name: "Company B", currency: "TND" },
  ]);
  owner = await seedMember(h.db, h.ctx().companyId, "owner");
  employee = await seedMember(h.db, h.ctx().companyId, "employee");
  otherOwner = await seedMember(h.db, h.otherTenant().companyId, "owner");
});
afterAll(async () => h.cleanup());

describe("staff Telegram link", () => {
  it("a single-use link connects the chat to that member and company; a second use is refused", async () => {
    const token = await linkFor(owner);
    expect(token).toMatch(/^fin_[A-Za-z0-9_-]{43}$/);
    const { sent, deps } = harnessDeps();
    expect(await tg.handleStaffMessage(h.db, { chatId: 1001, username: "boss", text: `/start ${token}` }, "r", deps)).toBe("finance_connected");
    expect(sent[0].text).toContain("Connected to Company A");
    expect(await tg.getStaffTelegramStatus(wsOf(h, owner))).toMatchObject({ linked: true, username: "boss" });
    expect(await tg.handleStaffMessage(h.db, { chatId: 1002, username: "thief", text: `/start ${token}` }, "r", deps)).toBe("finance_link_invalid");
  });

  it("a role that cannot create expenses cannot get a link", async () => {
    await expect(tg.createStaffTelegramLink(wsOf(h, employee))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("receipt photos", () => {
  it("the largest photo is read and a linked staff member gets a draft expense with a link back", async () => {
    const downloads: string[] = [];
    const { sent, deps } = harnessDeps();
    const outcome = await tg.handleStaffMessage(h.db, photo(1001, "client visit"), "r", { ...deps, download: async (id) => (downloads.push(id), JPEG(90)) });
    expect(outcome).toBe("finance_receipt");
    expect(downloads).toEqual(["big"]);
    const reply = sent.at(-1)!.text;
    expect(reply).toContain("Draft expense saved");
    expect(reply).toContain("Shell Lac · 2026-10-20 · 59.50 TND");
    const expenseId = /expenses\/([0-9a-f]{24})\/edit/.exec(reply)![1];
    const expense = await fin(wsOf(h, owner)).getExpense(expenseId);
    expect(expense).toMatchObject({ status: "draft", total: 59.5, vendor: "Shell Lac" });
    expect(expense.notes).toContain("client visit");
    const scans = await fin(wsOf(h, owner)).listReceiptExtractions();
    expect(scans.find((s) => s.appliedToExpenseId === expenseId)?.source).toBe("telegram");
  });

  it("the same photo twice is recognised and creates no second expense", async () => {
    const { sent, deps } = harnessDeps();
    const same = { ...deps, download: async () => JPEG(91) };
    await tg.handleStaffMessage(h.db, photo(1001), "r", same);
    const count = async () => (await fin(wsOf(h, owner)).listExpenses()).length;
    const before = await count();
    await tg.handleStaffMessage(h.db, photo(1001), "r", same);
    expect(await count()).toBe(before);
    expect(sent.at(-1)!.text).toContain("already sent this receipt");
  });

  it("an unreadable receipt waits for review instead of creating a half-empty expense", async () => {
    const { sent, deps } = harnessDeps({ vendor: "Blurry", confidence: 0.2 });
    expect(await tg.handleStaffMessage(h.db, photo(1001), "r", deps)).toBe("finance_receipt");
    expect(sent.at(-1)!.text).toContain("not enough for an expense");
  });

  it("refuses files that are not images or PDFs, and chats that are not linked", async () => {
    const { sent, deps } = harnessDeps();
    expect(await tg.handleStaffMessage(h.db, { chatId: 1001, username: null, document: { file_id: "x", file_unique_id: "x", mime_type: "application/zip", file_size: 10 } }, "r", deps)).toBe("finance_rejected_file");
    expect(await tg.handleStaffMessage(h.db, photo(4040), "r", deps)).toBe("finance_help");
    expect(sent.at(-1)!.text).toContain("not connected");
  });

  it("removing the member from the company disconnects the chat on the next photo", async () => {
    const member = await seedMember(h.db, h.ctx().companyId, "admin");
    const { deps } = harnessDeps();
    await tg.handleStaffMessage(h.db, { chatId: 2002, username: "leaver", text: `/start ${await linkFor(member)}` }, "r", deps);
    await h.db.collection("company_members").updateOne({ companyId: member.companyId, userId: member.userId }, { $set: { status: "removed" } });
    expect(await tg.handleStaffMessage(h.db, photo(2002), "r", deps)).toBe("finance_unlinked");
    expect(await tg.isFinanceChat(h.db, 2002, undefined)).toBe(false);
  });

  it("one chat can serve two companies; /company switches where receipts go", async () => {
    const { sent, deps } = harnessDeps();
    await tg.handleStaffMessage(h.db, { chatId: 3003, username: "multi", text: `/start ${await linkFor(otherOwner)}` }, "r", deps);
    // The same person is also an owner of Company A.
    await h.db.collection("company_members").insertOne({ _id: new ObjectId(), companyId: h.ctx().companyId, userId: otherOwner.userId, role: "owner", status: "active", createdAt: new Date() });
    const ownerInA: SeededMember = { userId: otherOwner.userId, companyId: h.ctx().companyId, role: "owner" };
    await tg.handleStaffMessage(h.db, { chatId: 3003, username: "multi", text: `/start ${await linkFor(ownerInA)}` }, "r", deps);
    await tg.handleStaffMessage(h.db, { chatId: 3003, username: "multi", text: "/company" }, "r", deps);
    expect(sent.at(-1)!.text).toMatch(/1\. Company B\n2\. Company A {2}\(current\)/);
    expect(await tg.handleStaffMessage(h.db, { chatId: 3003, username: "multi", text: "/company 1" }, "r", deps)).toBe("finance_switched");
    await tg.handleStaffMessage(h.db, photo(3003), "r", { ...deps, download: async () => JPEG(150) });
    const inB = await fin(wsOf(h, otherOwner)).listExpenses();
    expect(inB.some((e) => e.vendor === "Shell Lac")).toBe(true);
  });
});

describe("webhook routing", () => {
  it("Finance links go to Finance, customer /start links and /stop stay with Marketing", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url).split("/").pop()!);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
    });
    try {
      const token = await linkFor(await seedMember(h.db, h.ctx().companyId, "admin"));
      const update = (id: number, text: string) => ({ update_id: id, message: { text, chat: { id: 5005, type: "private" }, from: { id: 5005, username: "x" } } });
      expect(await processTelegramUpdate(h.db, update(900001, `/start ${token}`), "r")).toBe("finance_connected");
      expect(await processTelegramUpdate(h.db, update(900002, "/start"), "r")).toBe("finance_help");
      expect(await processTelegramUpdate(h.db, update(900003, "/stop"), "r")).toBe("stopped");
      expect(await processTelegramUpdate(h.db, { update_id: 900004, message: { text: "/start", chat: { id: 6006, type: "private" }, from: { id: 6006 } } }, "r")).toBe("welcome");
      expect(calls.every((c) => c === "sendMessage")).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("another company's member cannot be reached: tokens and links are per company", async () => {
    const links = await h.db.collection(tg.FINANCE_TELEGRAM.links).find({ chatId: "1001" }).toArray();
    expect(links.map((l) => String(l.companyId))).toEqual([String(h.ctx().companyId)]);
    expect(new ObjectId().equals(links[0].userId)).toBe(false);
  });
});
