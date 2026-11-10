import "server-only";
import { createHash, randomBytes } from "crypto";
import { ObjectId, type Db } from "mongodb";
import { recordAudit } from "@/server/audit/audit.service";
import { getAppUrl } from "@/config/env";
import { getTelegramState, telegramDeepLink } from "@/server/marketing/providers/telegram/config";
import { downloadTelegramFile, sendTelegramMessage } from "@/server/marketing/providers/telegram/client";
import { permissionsForRole, workspaceRoleFor } from "@/server/security/permissions";
import { consumeSharedRateLimit } from "@/server/security/shared-rate-limit";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import type { CompanyRole } from "@/features/company/types";
import { AppError, isAppError } from "@/shared/lib/errors";
import { MAX_RECEIPT_BYTES } from "@/server/finance/receipt-storage";
import { applyReceiptToExpense, scanReceipt, type ReceiptScan } from "@/server/finance/receipt-ocr.service";

/**
 * Receipt capture over Telegram, for STAFF (company members), on the same central bot the Marketing
 * module uses for customers.
 *
 *   Finance settings ─▶ single-use deep link  t.me/<bot>?start=fin_<token>  (bound to user + company)
 *   staff presses Start ─▶ chat linked ─▶ every photo / PDF sent ─▶ OCR pipeline ─▶ draft expense ─▶ reply
 *
 * Identity always comes from the stored link, never from the message. At every receipt the member is
 * checked again (account active, still a member, current role's permissions, AI access through the gate),
 * so removing someone from the company or changing their role takes effect on their next photo.
 */

export const FINANCE_TELEGRAM = {
  links: "finance_telegram_links",
  tokens: "finance_telegram_link_tokens",
} as const;

export const STAFF_TOKEN_PREFIX = "fin_";
const TOKEN_PATTERN = /^fin_[A-Za-z0-9_-]{43}$/;
const TOKEN_TTL_MS = 15 * 60_000;
const RECEIPT_RATE = { limit: 30, windowMs: 60 * 60_000 };

type LinkDoc = {
  _id: ObjectId;
  companyId: ObjectId;
  userId: ObjectId;
  chatId: string;
  username: string | null;
  /** One linked company per chat is active at a time; /company switches it. */
  active: boolean;
  createdAt: Date;
  lastReceiptAt?: Date;
};

type TokenDoc = { _id: string; companyId: ObjectId; userId: ObjectId; createdAt: Date; expiresAt: Date; consumedAt: Date | null };

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const links = (db: Db) => db.collection<LinkDoc>(FINANCE_TELEGRAM.links);
const tokens = (db: Db) => db.collection<TokenDoc>(FINANCE_TELEGRAM.tokens);

// ─── Settings side (signed-in member) ─────────────────────────────────────────

export type StaffTelegramStatus = {
  botConfigured: boolean;
  linked: boolean;
  username: string | null;
  linkedAt: string | null;
};

function assertCanCapture(ctx: WorkspaceContext) {
  if (!ctx.permissions.has("finance.receipt.ocr") || !ctx.permissions.has("finance.expense.manage")) {
    throw new AppError("FORBIDDEN", "Your role cannot send receipts. Ask an owner or administrator.");
  }
}

export async function getStaffTelegramStatus(ctx: WorkspaceContext): Promise<StaffTelegramStatus> {
  const link = await links(ctx.db).findOne({ companyId: ctx.companyId, userId: ctx.userId });
  return {
    botConfigured: getTelegramState().configured,
    linked: !!link,
    username: link?.username ?? null,
    linkedAt: link?.createdAt.toISOString() ?? null,
  };
}

/** A fresh single-use deep link (15 minutes). Earlier unused links for this member are revoked. */
export async function createStaffTelegramLink(ctx: WorkspaceContext): Promise<{ url: string; expiresAt: string }> {
  assertCanCapture(ctx);
  const state = getTelegramState();
  if (!state.configured) throw new AppError("PROVIDER_NOT_CONFIGURED", "The Telegram bot is not configured on this server.");
  const token = `${STAFF_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_MS);
  await tokens(ctx.db).deleteMany({ companyId: ctx.companyId, userId: ctx.userId, consumedAt: null });
  await tokens(ctx.db).insertOne({ _id: hash(token), companyId: ctx.companyId, userId: ctx.userId, createdAt: now, expiresAt, consumedAt: null });
  await recordAudit(ctx.db, { companyId: ctx.companyId, actorUserId: ctx.userId, action: "finance.telegram.link_created", entityType: "user", entityId: ctx.userId.toHexString(), requestId: ctx.requestId });
  return { url: telegramDeepLink(state.config.botUsername, token), expiresAt: expiresAt.toISOString() };
}

export async function disconnectStaffTelegram(ctx: WorkspaceContext): Promise<void> {
  const removed = await links(ctx.db).findOneAndDelete({ companyId: ctx.companyId, userId: ctx.userId });
  await tokens(ctx.db).deleteMany({ companyId: ctx.companyId, userId: ctx.userId, consumedAt: null });
  if (removed) {
    await recordAudit(ctx.db, { companyId: ctx.companyId, actorUserId: ctx.userId, action: "finance.telegram.disconnected", entityType: "user", entityId: ctx.userId.toHexString(), requestId: ctx.requestId });
  }
}

// ─── Bot side (webhook / poller) ──────────────────────────────────────────────

/** The parts of a Telegram message this handler reads. */
export type StaffMessage = {
  chatId: number;
  username: string | null;
  text?: string;
  caption?: string;
  photo?: Array<{ file_id: string; file_unique_id: string; file_size?: number; width?: number; height?: number }>;
  document?: { file_id: string; file_unique_id: string; file_name?: string; mime_type?: string; file_size?: number };
};

export type StaffOutcome = "finance_connected" | "finance_link_invalid" | "finance_receipt" | "finance_receipt_failed" | "finance_help" | "finance_switched" | "finance_unlinked" | "finance_rejected_file";

type Deps = {
  send?: (chatId: string, text: string) => Promise<void>;
  download?: (fileId: string, maxBytes: number) => Promise<Uint8Array>;
  scan?: typeof scanReceipt;
};

const HELP =
  "Send a photo of a receipt (or the PDF of an invoice) and AnOps will read it and save a draft expense for you to check.\n\n" +
  "Tips: one receipt per photo, flat and well lit. Add a caption for context, like \"client lunch\".\n\n" +
  "/company  switch company\n/unlink  stop sending receipts from this chat";

function botSender(token: string) {
  return async (chatId: string, text: string) => {
    try {
      await sendTelegramMessage(token, chatId, text, AbortSignal.timeout(8_000));
    } catch {
      // A failed courtesy reply never fails the update.
    }
  };
}

/** True when this update is for Finance: a staff link token, or any message from a chat linked to staff. */
export async function isFinanceChat(db: Db, chatId: number, text: string | undefined): Promise<boolean> {
  const start = text ? /^\/start(?:@\w+)?\s+(\S+)/i.exec(text.trim()) : null;
  if (start) return start[1].startsWith(STAFF_TOKEN_PREFIX);
  return !!(await links(db).findOne({ chatId: String(chatId) }, { projection: { _id: 1 } }));
}

export async function handleStaffMessage(db: Db, msg: StaffMessage, requestId: string, deps: Deps = {}): Promise<StaffOutcome> {
  const state = getTelegramState();
  const botToken = state.configured ? state.config.botToken : "";
  const send = deps.send ?? botSender(botToken);
  const chatId = String(msg.chatId);
  const text = msg.text?.trim() ?? "";

  const start = /^\/start(?:@\w+)?(?:\s+(\S+))?\s*$/i.exec(text);
  if (start?.[1]?.startsWith(STAFF_TOKEN_PREFIX)) return connect(db, start[1], chatId, msg.username, requestId, send);

  const link = await links(db).findOne({ chatId, active: true });
  if (!link) {
    await send(chatId, "This chat is not connected to a company. Open Finance › Receipts › Connect Telegram in AnOps to get a link.");
    return "finance_help";
  }

  const companyCmd = /^\/company(?:@\w+)?(?:\s+(\d+))?\s*$/i.exec(text);
  if (companyCmd) return switchCompany(db, chatId, companyCmd[1] ? Number(companyCmd[1]) : null, send);
  if (/^\/unlink(?:@\w+)?\s*$/i.test(text)) {
    await links(db).deleteMany({ chatId });
    await recordAudit(db, { companyId: link.companyId, actorUserId: link.userId, action: "finance.telegram.disconnected", entityType: "user", entityId: link.userId.toHexString(), requestId, metadata: { from: "telegram" } });
    await send(chatId, "This chat no longer sends receipts to AnOps. Connect again from Finance › Receipts whenever you like.");
    return "finance_unlinked";
  }

  const file = pickFile(msg);
  if (!file) {
    await send(chatId, HELP);
    return "finance_help";
  }
  if ("rejected" in file) {
    await send(chatId, file.rejected);
    return "finance_rejected_file";
  }
  return processReceipt(db, link, file, msg.caption, requestId, { send, download: deps.download ?? ((id, max) => downloadTelegramFile(botToken, id, max)), scan: deps.scan ?? scanReceipt });
}

async function connect(db: Db, token: string, chatId: string, username: string | null, requestId: string, send: (c: string, t: string) => Promise<void>): Promise<StaffOutcome> {
  const invalid = async () => {
    await send(chatId, "This link is invalid, has expired or was already used. Create a new one in AnOps: Finance › Receipts › Connect Telegram.");
    return "finance_link_invalid" as const;
  };
  if (!TOKEN_PATTERN.test(token)) return invalid();
  const now = new Date();
  const consumed = await tokens(db).findOneAndUpdate({ _id: hash(token), consumedAt: null, expiresAt: { $gt: now } }, { $set: { consumedAt: now } }, { returnDocument: "after" });
  if (!consumed) return invalid();
  const ctx = await memberWorkspace(db, consumed.companyId, consumed.userId, requestId);
  if (!ctx) return invalid();

  await links(db).updateMany({ chatId }, { $set: { active: false } });
  await links(db).updateOne(
    { companyId: consumed.companyId, userId: consumed.userId },
    { $set: { chatId, username: username?.slice(0, 64) ?? null, active: true }, $setOnInsert: { _id: new ObjectId(), createdAt: now } },
    { upsert: true }
  );
  await recordAudit(db, { companyId: consumed.companyId, actorUserId: consumed.userId, action: "finance.telegram.connected", entityType: "user", entityId: consumed.userId.toHexString(), requestId });
  const company = await db.collection("companies").findOne({ _id: consumed.companyId }, { projection: { name: 1 } });
  await send(chatId, `Connected to ${company?.name ?? "your company"} on AnOps Finance.\n\n${HELP}`);
  return "finance_connected";
}

async function switchCompany(db: Db, chatId: string, choice: number | null, send: (c: string, t: string) => Promise<void>): Promise<StaffOutcome> {
  const all = await links(db).find({ chatId }).sort({ createdAt: 1 }).toArray();
  const names = await db.collection("companies").find({ _id: { $in: all.map((l) => l.companyId) } }, { projection: { name: 1 } }).toArray();
  const nameOf = (id: ObjectId) => (names.find((n) => n._id.equals(id))?.name as string) ?? "Company";
  if (choice === null || choice < 1 || choice > all.length) {
    const list = all.map((l, i) => `${i + 1}. ${nameOf(l.companyId)}${l.active ? "  (current)" : ""}`).join("\n");
    await send(chatId, `Receipts from this chat go to:\n${list}\n\nSend /company <number> to switch.${all.length < 2 ? "\nTo add another company, open its Finance › Receipts page and connect Telegram there." : ""}`);
    return "finance_help";
  }
  const target = all[choice - 1];
  await links(db).updateMany({ chatId }, { $set: { active: false } });
  await links(db).updateOne({ _id: target._id }, { $set: { active: true } });
  await send(chatId, `Receipts now go to ${nameOf(target.companyId)}.`);
  return "finance_switched";
}

type PickedFile = { fileId: string; name: string; size: number } | { rejected: string };

function pickFile(msg: StaffMessage): PickedFile | null {
  if (msg.photo?.length) {
    // Telegram sends several sizes of the same photo; the largest reads best.
    const best = [...msg.photo].sort((a, b) => (b.file_size ?? (b.width ?? 0) * (b.height ?? 0)) - (a.file_size ?? (a.width ?? 0) * (a.height ?? 0)))[0];
    return { fileId: best.file_id, name: "telegram-photo.jpg", size: best.file_size ?? 0 };
  }
  if (msg.document) {
    const mime = msg.document.mime_type ?? "";
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(mime) && mime !== "application/pdf") {
      return { rejected: "Only photos (JPEG, PNG, WEBP, HEIC) and PDF files can be read as receipts." };
    }
    if ((msg.document.file_size ?? 0) > MAX_RECEIPT_BYTES) return { rejected: "That file is larger than 10 MB. Send a smaller photo or PDF." };
    return { fileId: msg.document.file_id, name: msg.document.file_name ?? "telegram-receipt", size: msg.document.file_size ?? 0 };
  }
  return null;
}

async function processReceipt(
  db: Db,
  link: LinkDoc,
  file: { fileId: string; name: string },
  caption: string | undefined,
  requestId: string,
  deps: Required<Deps>
): Promise<StaffOutcome> {
  const { send } = deps;
  const ctx = await memberWorkspace(db, link.companyId, link.userId, requestId);
  if (!ctx) {
    await links(db).deleteOne({ _id: link._id });
    await send(link.chatId, "Your AnOps account no longer has access to this company, so this chat was disconnected.");
    return "finance_unlinked";
  }
  try {
    assertCanCapture(ctx);
    await consumeSharedRateLimit(db, `telegram-receipt:${link.chatId}`, RECEIPT_RATE.limit, RECEIPT_RATE.windowMs, "That is a lot of receipts in one hour. Wait a little and send the rest.");
    await send(link.chatId, "Reading your receipt…");
    const bytes = await deps.download(file.fileId, MAX_RECEIPT_BYTES);
    const scan = await deps.scan(ctx, { bytes, originalName: file.name, note: caption?.slice(0, 300), source: "telegram" });
    const reply = await finishReceipt(ctx, scan, caption);
    await links(db).updateOne({ _id: link._id }, { $set: { lastReceiptAt: new Date() } });
    await send(link.chatId, reply);
    return "finance_receipt";
  } catch (error) {
    const message = isAppError(error)
      ? error.message
      : (error as { code?: string })?.code === "PAYLOAD_TOO_LARGE"
        ? "That file is larger than 10 MB. Send a smaller photo or PDF."
        : "The receipt could not be read right now. Try again in a minute, or enter it in AnOps.";
    if (!isAppError(error)) console.error("[finance.telegram] receipt failed", error instanceof Error ? error.name : "unknown");
    await send(link.chatId, message);
    return "finance_receipt_failed";
  }
}

/**
 * Turns a scan into a draft expense when the essentials were read (date and amount), so a receipt
 * sent from a phone needs no typing. It stays a DRAFT: the person checks and submits it in AnOps.
 * When something essential is missing, the scan waits on the Receipts page instead.
 */
async function finishReceipt(ctx: WorkspaceContext, scan: ReceiptScan, caption: string | undefined): Promise<string> {
  const p = scan.proposed;
  const base = getAppUrl();
  const money = (n: number | null) => (n === null ? "?" : `${n.toFixed(2)} ${p.currency ?? "TND"}`);
  const head = [p.vendor ?? "Unknown vendor", p.date ?? "no date", money(p.total)].join(" · ");
  const warnings = scan.warnings.filter((w) => w.code !== "currency_guessed").map((w) => `• ${w.message}`);

  if (scan.duplicateFile) return `You already sent this receipt.\n${head}\n\nReview it here: ${base}/finance/receipts`;

  const usable = p.date && p.amount !== null && p.amount > 0 && !scan.warnings.some((w) => w.code === "not_a_receipt");
  if (!usable) {
    return `I read part of it, but not enough for an expense:\n${head}${warnings.length ? `\n${warnings.join("\n")}` : ""}\n\nFinish it here: ${base}/finance/receipts`;
  }

  const { expenseId } = await applyReceiptToExpense(ctx, scan.extractionId, {
    expenseDate: p.date as string,
    categoryId: p.categoryId ?? undefined,
    vendor: p.vendor ?? undefined,
    description: (p.description || caption || `Purchase at ${p.vendor ?? "vendor"}`).slice(0, 200),
    amount: p.amount as number,
    tax: p.tax ?? 0,
    currency: p.currency ?? "TND",
    notes: [caption, p.notes].filter(Boolean).join(" · ").slice(0, 1000) || undefined,
  });

  return [
    "Draft expense saved ✓",
    head,
    p.categoryName ? `Category: ${p.categoryName}` : "Category: not set",
    p.confidence !== null ? `Confidence: ${Math.round(p.confidence * 100)}%` : null,
    warnings.length ? `\nPlease check:\n${warnings.join("\n")}` : null,
    `\nCheck and submit: ${base}/finance/expenses/${expenseId}/edit`,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

/**
 * Builds the member's workspace from the stored link, re-checking everything a session would: the
 * account is active and verified, the membership is active, and permissions come from the current role.
 */
export async function memberWorkspace(db: Db, companyId: ObjectId, userId: ObjectId, requestId: string): Promise<WorkspaceContext | null> {
  const [user, member, company] = await Promise.all([
    db.collection("users").findOne({ _id: userId }, { projection: { status: 1, emailVerified: 1 } }),
    db.collection("company_members").findOne({ companyId, userId, status: "active" }, { projection: { role: 1 } }),
    db.collection("companies").findOne({ _id: companyId }, { projection: { currency: 1 } }),
  ]);
  if (!user || user.status === "banned" || user.status === "unverified" || !user.emailVerified) return null;
  if (!member || !company) return null;
  const role = workspaceRoleFor(member.role as CompanyRole);
  return { db, requestId, userId, companyId, role, currencyCode: (company.currency as string) || "TND", permissions: permissionsForRole(role) };
}
