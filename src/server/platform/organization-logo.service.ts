import "server-only";
import { createHash, randomUUID } from "crypto";
import { GridFSBucket, ObjectId, type Db } from "mongodb";
import { z } from "zod";
import { recordAudit } from "@/server/audit/audit.service";
import { isAiKillSwitchOn } from "@/server/ai/platform";
import {
  getGeminiImageProvider,
  ImageProviderError,
  type GeminiImageProvider,
} from "@/server/ai/image/gemini-image.provider";
import { assertAiEntitled, type OrgAccess } from "@/server/platform/access";
import { readImageMeta } from "@/server/platform/image-meta";
import { consumeSharedRateLimit } from "@/server/security/shared-rate-limit";
import { AppError } from "@/shared/lib/errors";

/**
 * AI logo studio. Generation and editing return a *candidate* to the owner's browser and store nothing; the organization's
 * logo changes only when the owner confirms (setOrganizationLogo). The previous logo is replaced only after the new one
 * is stored and the organization record points at it, so any failure leaves the old logo untouched.
 */
export const LOGO_BUCKET = "organization_logos";
export const LOGO_LOCKS = "organization_logo_locks";
export const MAX_LOGO_BYTES = 3 * 1024 * 1024;
const MAX_SOURCE_BYTES = 6 * 1024 * 1024;
const MIN_SIDE = 128;
const MAX_SIDE = 4096;
const LOCK_TTL_MS = 3 * 60_000;

const STYLES = ["minimal", "geometric", "modern", "playful", "elegant", "bold", "hand-drawn"] as const;
const text = (max: number) => z.string().trim().max(max).transform((value) => value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " "));

const sourceImage = z.object({
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  dataBase64: z.string().min(100).max(Math.ceil((MAX_SOURCE_BYTES * 4) / 3) + 16),
});

export const logoRequestSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("new"),
    description: text(800).pipe(z.string().min(10, "Describe the logo you want in a few words (at least 10 characters).")),
    colors: text(80).optional(),
    style: z.enum(STYLES).optional(),
    industry: text(80).optional(),
  }),
  z.object({
    mode: z.literal("edit"),
    instruction: text(400).pipe(z.string().min(3, "Tell Gemini what to change.")),
    image: sourceImage,
  }),
]);
export type LogoRequest = z.infer<typeof logoRequestSchema>;

export type LogoCandidate = { mimeType: "image/png" | "image/jpeg" | "image/webp"; dataBase64: string; model: string };

/** The brief sent to Gemini. The organization's name is deliberately never asked for: lettering is set separately in the studio. */
export function buildLogoPrompt(request: LogoRequest): string {
  if (request.mode === "edit") {
    return [
      "Edit this logo image as instructed. Keep it a clean, professional, flat logo on a plain uniform background, centered, square.",
      "Do not add text, letters, mockups, shadows, borders or watermarks. Do not change anything that the instruction does not mention.",
      `Instruction: ${request.instruction}`,
    ].join("\n");
  }
  const lines = [
    "Design a clean, professional logo mark (a symbol or icon) for a business.",
    "Flat vector-style artwork, simple shapes, strong silhouette, readable at small sizes, centered with generous margin, on a plain uniform light background.",
    "Do not include any text, letters, numbers, mockups, shadows, borders or watermarks.",
    `Concept: ${request.description}`,
  ];
  if (request.industry) lines.push(`Industry: ${request.industry}`);
  if (request.style) lines.push(`Visual style: ${request.style}`);
  if (request.colors) lines.push(`Preferred colors: ${request.colors}`);
  return lines.join("\n");
}

function assertOwner(access: OrgAccess): void {
  if (access.companyRole !== "owner") throw new AppError("FORBIDDEN", "Only the organization owner can create or change the logo.");
}

/** Every provider failure becomes a message the owner can act on; upstream details stay in the server log. */
export function toLogoError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (!(error instanceof ImageProviderError)) return new AppError("INTERNAL", "Something went wrong while creating the logo. Your description is kept: try again.");
  if (error.detail) console.error(`[logo] provider ${error.kind}: ${error.detail.slice(0, 300)}`);
  switch (error.kind) {
    case "not_configured":
      return new AppError("PROVIDER_NOT_CONFIGURED", "AI logo generation is not set up on this server yet. Ask your administrator to configure the Gemini API key (GEMINI_API_KEYS).");
    case "billing_required":
      return new AppError("PROVIDER_NOT_CONFIGURED", "The connected Google project has no image-generation quota on its current plan. An administrator needs to enable billing for the Gemini API, then you can try again.");
    case "invalid_credentials":
      return new AppError("PROVIDER_NOT_CONFIGURED", "The Gemini API key on this server was rejected. An administrator needs to update GEMINI_API_KEYS.");
    case "rate_limited":
      return new AppError("RATE_LIMITED", `The image service is busy right now. Wait ${(error.retryAfterSeconds ?? 60) < 90 ? `${Math.max(5, error.retryAfterSeconds ?? 60)} seconds` : `${Math.ceil((error.retryAfterSeconds ?? 60) / 60)} minutes`} and try again.`);
    case "blocked":
      return new AppError("VALIDATION_ERROR", "Gemini could not create this image. Rephrase the description (avoid brand names, real people or sensitive content) and try again.");
    case "invalid_request":
      return new AppError("VALIDATION_ERROR", "Gemini could not process that request. Adjust the description or the change you asked for and try again.");
    case "timeout":
      return new AppError("INTERNAL", "Generating the logo took too long. Your description is kept: try again.");
    case "unavailable":
      return new AppError("INTERNAL", "The image service is temporarily unavailable. Your description is kept: try again in a moment.");
    default:
      return new AppError("INTERNAL", "Gemini did not return a usable image. Try again.");
  }
}

/** One generation at a time per organization: a double click or a second tab cannot run (and pay for) two. */
async function acquireLock(db: Db, companyId: ObjectId, requestId: string): Promise<void> {
  const locks = db.collection<{ _id: ObjectId; requestId: string; expiresAt: Date }>(LOGO_LOCKS);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LOCK_TTL_MS);
  const taken = await locks.updateOne({ _id: companyId, expiresAt: { $lte: now } }, { $set: { requestId, expiresAt } });
  if (taken.matchedCount === 1) return;
  try {
    await locks.insertOne({ _id: companyId, requestId, expiresAt });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw new AppError("CONFLICT", "A logo is already being generated for this organization. Wait for it to finish.");
    throw error;
  }
}

async function releaseLock(db: Db, companyId: ObjectId, requestId: string): Promise<void> {
  await db.collection(LOGO_LOCKS).deleteOne({ _id: companyId, requestId }).catch(() => undefined);
}

export type LogoStudioStatus =
  | { available: true; currentLogoUrl: string | null }
  | { available: false; reason: "not_owner" | "plan" | "paused" | "not_configured"; message: string; currentLogoUrl: string | null };

export async function getLogoStudioStatus(access: OrgAccess, provider: GeminiImageProvider = getGeminiImageProvider()): Promise<LogoStudioStatus> {
  const company = await access.ctx.db.collection("companies").findOne({ _id: access.ctx.companyId }, { projection: { logoUrl: 1 } });
  const currentLogoUrl = typeof company?.logoUrl === "string" ? company.logoUrl : null;
  if (access.companyRole !== "owner") return { available: false, reason: "not_owner", message: "Only the organization owner can change the logo.", currentLogoUrl };
  if (!access.entitlements.aiFeatures) return { available: false, reason: "plan", message: "The AI logo studio is part of the plans with AI features (MaxOps, or Custom with the AI add-on, and during the trial).", currentLogoUrl };
  if (isAiKillSwitchOn()) return { available: false, reason: "paused", message: "AI features are paused for the whole platform right now. Try again later.", currentLogoUrl };
  if (!provider.configured) return { available: false, reason: "not_configured", message: "AI logo generation is not set up on this server yet. Ask your administrator to configure GEMINI_API_KEYS.", currentLogoUrl };
  return { available: true, currentLogoUrl };
}

export async function generateLogoCandidate(
  access: OrgAccess,
  rawInput: unknown,
  deps: { provider?: GeminiImageProvider } = {}
): Promise<LogoCandidate> {
  assertOwner(access);
  const { db, companyId, userId, requestId } = access.ctx;
  await assertAiEntitled(db, companyId);
  if (isAiKillSwitchOn()) throw new AppError("FORBIDDEN", "AI features are paused for the whole platform right now. Try again later.");

  const parsed = logoRequestSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Check the logo description.");
  const request = parsed.data;

  const provider = deps.provider ?? getGeminiImageProvider();
  if (!provider.configured) throw toLogoError(new ImageProviderError("not_configured", "not configured"));

  let image: { mimeType: LogoCandidate["mimeType"]; dataBase64: string } | undefined;
  if (request.mode === "edit") {
    const bytes = Buffer.from(request.image.dataBase64, "base64");
    const meta = readImageMeta(bytes);
    if (!meta || bytes.length > MAX_SOURCE_BYTES) throw new AppError("VALIDATION_ERROR", "The image to edit is not a valid PNG, JPEG or WebP file under 6 MB.");
    image = { mimeType: meta.mimeType, dataBase64: request.image.dataBase64 };
  }

  // Cost controls, checked before anything is sent to Google: per person in a short window, per organization per hour and day.
  const limitMessage = "You have reached the logo generation limit. Please wait a while before generating more.";
  await consumeSharedRateLimit(db, `logo:gen:user:${userId.toHexString()}`, 6, 10 * 60_000, limitMessage);
  await consumeSharedRateLimit(db, `logo:gen:org-hour:${companyId.toHexString()}`, 12, 60 * 60_000, limitMessage);
  await consumeSharedRateLimit(db, `logo:gen:org-day:${companyId.toHexString()}`, 40, 24 * 60 * 60_000, "Your organization reached today's logo generation limit. Try again tomorrow.");

  const lockId = randomUUID();
  await acquireLock(db, companyId, lockId);
  try {
    const result = await provider.generate({ prompt: buildLogoPrompt(request), image });
    await recordAudit(db, {
      companyId,
      actorUserId: userId,
      action: "organization.logo_generated",
      entityType: "organization",
      entityId: companyId.toHexString(),
      requestId,
      // Sizes and the model only: the description itself is not copied into the audit trail.
      metadata: { mode: request.mode, model: result.model, resultBytes: result.bytes.length },
    });
    return { mimeType: result.mimeType, dataBase64: result.bytes.toString("base64"), model: result.model };
  } catch (error) {
    throw toLogoError(error);
  } finally {
    await releaseLock(db, companyId, lockId);
  }
}

/** Accepts "data:image/png;base64,..." or bare base64. */
function decodeImage(input: unknown): Buffer {
  if (typeof input !== "string" || input.length < 100) throw new AppError("VALIDATION_ERROR", "Choose an image first.");
  const base64 = input.replace(/^data:[^;,]+;base64,/, "");
  if (base64.length > Math.ceil((MAX_LOGO_BYTES * 4) / 3) + 16) throw new AppError("VALIDATION_ERROR", "The logo is too large (maximum 3 MB). Use a smaller export.");
  return Buffer.from(base64, "base64");
}

export type OrganizationLogoResult = { logoUrl: string };

export async function setOrganizationLogo(access: OrgAccess, imageInput: unknown): Promise<OrganizationLogoResult> {
  assertOwner(access);
  const { db, companyId, userId, requestId } = access.ctx;
  await consumeSharedRateLimit(db, `logo:save:${companyId.toHexString()}`, 20, 60 * 60_000, "Too many logo changes. Please wait a while before saving another.");

  const bytes = decodeImage(imageInput);
  if (bytes.length > MAX_LOGO_BYTES) throw new AppError("VALIDATION_ERROR", "The logo is too large (maximum 3 MB). Use a smaller export.");
  const meta = readImageMeta(bytes);
  if (!meta) throw new AppError("VALIDATION_ERROR", "The logo must be a PNG, JPEG or WebP image.");
  if (meta.width < MIN_SIDE || meta.height < MIN_SIDE) throw new AppError("VALIDATION_ERROR", `The logo is too small (at least ${MIN_SIDE} × ${MIN_SIDE} pixels).`);
  if (meta.width > MAX_SIDE || meta.height > MAX_SIDE) throw new AppError("VALIDATION_ERROR", `The logo is too large (at most ${MAX_SIDE} × ${MAX_SIDE} pixels).`);
  const ratio = meta.width / meta.height;
  if (ratio > 3 || ratio < 1 / 3) throw new AppError("VALIDATION_ERROR", "The logo is too wide or too tall. Use a shape close to a square.");

  const companies = db.collection("companies");
  const before = await companies.findOne({ _id: companyId }, { projection: { logoFileId: 1 } });
  const previousId = before?.logoFileId instanceof ObjectId ? before.logoFileId : null;

  const bucket = new GridFSBucket(db, { bucketName: LOGO_BUCKET });
  const fileId = new ObjectId();
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  try {
    await new Promise<void>((resolve, reject) => {
      const stream = bucket.openUploadStreamWithId(fileId, `logo-${fileId.toHexString()}`, { metadata: { companyId, mimeType: meta.mimeType, width: meta.width, height: meta.height, sha256, uploadedBy: userId } });
      stream.once("error", reject);
      stream.once("finish", () => resolve());
      stream.end(bytes);
    });
    const logoUrl = `/api/v1/organizations/${companyId.toHexString()}/logo?v=${fileId.toHexString()}`;
    const updated = await companies.updateOne({ _id: companyId }, { $set: { logoFileId: fileId, logoUrl, logoUpdatedAt: new Date() } });
    if (updated.matchedCount !== 1) throw new AppError("NOT_FOUND", "Organization not found.");
    // Only now is the old file expendable; a failed cleanup just leaves an orphan, never a broken logo.
    if (previousId) await bucket.delete(previousId).catch((error: unknown) => console.warn(`[logo] could not remove the previous logo file: ${error instanceof Error ? error.name : "unknown"}`));
    await recordAudit(db, { companyId, actorUserId: userId, action: "organization.logo_updated", entityType: "organization", entityId: companyId.toHexString(), requestId, metadata: { bytes: bytes.length, mimeType: meta.mimeType, width: meta.width, height: meta.height } });
    return { logoUrl };
  } catch (error) {
    await bucket.delete(fileId).catch(() => undefined); // the new file never becomes the logo; the old logo is untouched
    if (error instanceof AppError) throw error;
    console.error(`[logo] saving failed: ${error instanceof Error ? error.name : "unknown"}`);
    throw new AppError("INTERNAL", "Your logo could not be saved and the previous logo is unchanged. Your new image is still here: try again.");
  }
}

export type LogoFile = { stream: NodeJS.ReadableStream; mimeType: string; size: number; sha256: string };

/** The current logo of one organization. Membership is verified by the caller (the route); the file is also checked against the company here. */
export async function openOrganizationLogo(db: Db, companyId: ObjectId): Promise<LogoFile | null> {
  const company = await db.collection("companies").findOne({ _id: companyId }, { projection: { logoFileId: 1 } });
  const fileId = company?.logoFileId;
  if (!(fileId instanceof ObjectId)) return null;
  const bucket = new GridFSBucket(db, { bucketName: LOGO_BUCKET });
  const [file] = await bucket.find({ _id: fileId }).toArray();
  const owner = file?.metadata?.companyId;
  if (!file || !(owner instanceof ObjectId) || !owner.equals(companyId)) return null;
  return { stream: bucket.openDownloadStream(fileId), mimeType: String(file.metadata?.mimeType ?? "image/png"), size: file.length, sha256: String(file.metadata?.sha256 ?? "") };
}
