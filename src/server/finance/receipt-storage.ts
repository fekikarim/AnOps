import "server-only";
import { createHash } from "crypto";
import { GridFSBucket, ObjectId, type Db } from "mongodb";
import { AppError } from "@/shared/lib/errors";

/**
 * Receipt files (photos and PDFs) in a GridFS bucket. Every file belongs to one company: the
 * company id is stored on the metadata document and checked on every read and delete, so a file
 * id from another company is simply "not found".
 *
 * The file type is decided from the file's first bytes, never from its name or the browser's
 * claimed type, so a renamed executable cannot be stored as a "receipt.jpg".
 */
export const RECEIPT_BUCKET = "finance_receipts";
export const RECEIPT_DOCUMENTS = "finance_receipt_documents";
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

export type ReceiptSource = "upload" | "telegram" | "ai_chat";

export type ReceiptDocument = {
  id: string;
  mimeType: string;
  originalName: string;
  size: number;
  sha256: string;
  source: ReceiptSource;
  uploadedBy: string;
  uploadedAt: string;
};

/** Detects a supported receipt type from magic bytes. Returns null for anything else. */
export function sniffReceiptType(bytes: Uint8Array): string | null {
  const b = bytes;
  const ascii = (start: number, end: number) => String.fromCharCode(...b.subarray(start, end));
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (b.length >= 5 && ascii(0, 5) === "%PDF-") return "application/pdf";
  if (b.length >= 12 && ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (["heic", "heix", "hevc", "heim", "heis"].includes(brand)) return "image/heic";
    if (["mif1", "msf1"].includes(brand)) return "image/heif";
  }
  return null;
}

function safeName(name: string): string {
  const cleaned = name.replace(/[\\/\u0000-\u001f]/g, "_").trim();
  return (cleaned || "receipt").slice(0, 120);
}

function toDto(d: Record<string, unknown> & { _id: ObjectId }): ReceiptDocument {
  return {
    id: d._id.toHexString(),
    mimeType: String(d.mimeType),
    originalName: String(d.originalName),
    size: Number(d.size) || 0,
    sha256: String(d.sha256 ?? ""),
    source: (d.source as ReceiptSource) ?? "upload",
    uploadedBy: String(d.uploadedBy ?? ""),
    uploadedAt: d.uploadedAt instanceof Date ? d.uploadedAt.toISOString() : new Date().toISOString(),
  };
}

/**
 * Stores a receipt file. The same bytes uploaded twice in one company are stored once: the
 * existing document is returned with `duplicate: true`, so the caller can warn instead of
 * creating a second expense for the same receipt.
 */
export async function putReceiptFile(
  db: Db,
  input: { companyId: ObjectId; userId: string; bytes: Uint8Array; originalName: string; source: ReceiptSource }
): Promise<{ document: ReceiptDocument; duplicate: boolean }> {
  if (input.bytes.length === 0) throw new AppError("VALIDATION_ERROR", "The file is empty.");
  if (input.bytes.length > MAX_RECEIPT_BYTES) throw new AppError("VALIDATION_ERROR", "Receipts can be at most 10 MB.");
  const mimeType = sniffReceiptType(input.bytes);
  if (!mimeType) throw new AppError("VALIDATION_ERROR", "Only JPEG, PNG, WEBP, HEIC images and PDF files can be scanned.");

  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const docs = db.collection(RECEIPT_DOCUMENTS);
  const existing = await docs.findOne({ companyId: input.companyId, sha256 });
  if (existing) return { document: toDto(existing), duplicate: true };

  const bucket = new GridFSBucket(db, { bucketName: RECEIPT_BUCKET });
  const fileId = new ObjectId();
  const originalName = safeName(input.originalName);
  await new Promise<void>((resolve, reject) => {
    const stream = bucket.openUploadStreamWithId(fileId, originalName, { metadata: { companyId: input.companyId, mimeType } });
    stream.once("finish", () => resolve());
    stream.once("error", reject);
    stream.end(Buffer.from(input.bytes));
  });

  const now = new Date();
  const doc = {
    companyId: input.companyId,
    fileId,
    storageKey: `gridfs:${RECEIPT_BUCKET}/${fileId.toHexString()}`,
    mimeType,
    originalName,
    size: input.bytes.length,
    sha256,
    source: input.source,
    uploadedBy: input.userId,
    uploadedAt: now,
  };
  try {
    const res = await docs.insertOne(doc);
    return { document: toDto({ ...doc, _id: res.insertedId }), duplicate: false };
  } catch (error) {
    // Two identical uploads racing: the unique (companyId, sha256) index keeps one; drop our copy.
    await bucket.delete(fileId).catch(() => undefined);
    const winner = await docs.findOne({ companyId: input.companyId, sha256 });
    if (winner) return { document: toDto(winner), duplicate: true };
    throw error;
  }
}

export async function getReceiptDocument(db: Db, companyId: ObjectId, documentId: string): Promise<ReceiptDocument | null> {
  if (!ObjectId.isValid(documentId)) return null;
  const d = await db.collection(RECEIPT_DOCUMENTS).findOne({ _id: new ObjectId(documentId), companyId });
  return d ? toDto(d) : null;
}

/** Reads the whole file (receipts are at most 10 MB). Null when it is not this company's file. */
export async function readReceiptFile(db: Db, companyId: ObjectId, documentId: string): Promise<{ document: ReceiptDocument; bytes: Buffer } | null> {
  if (!ObjectId.isValid(documentId)) return null;
  const d = await db.collection(RECEIPT_DOCUMENTS).findOne({ _id: new ObjectId(documentId), companyId });
  if (!d || !(d.fileId instanceof ObjectId)) return null;
  const bucket = new GridFSBucket(db, { bucketName: RECEIPT_BUCKET });
  const chunks: Buffer[] = [];
  for await (const chunk of bucket.openDownloadStream(d.fileId)) chunks.push(chunk as Buffer);
  return { document: toDto(d), bytes: Buffer.concat(chunks) };
}

export async function deleteReceiptFile(db: Db, companyId: ObjectId, documentId: string): Promise<boolean> {
  if (!ObjectId.isValid(documentId)) return false;
  const d = await db.collection(RECEIPT_DOCUMENTS).findOneAndDelete({ _id: new ObjectId(documentId), companyId });
  if (!d) return false;
  if (d.fileId instanceof ObjectId) {
    await new GridFSBucket(db, { bucketName: RECEIPT_BUCKET }).delete(d.fileId).catch(() => undefined);
  }
  return true;
}
