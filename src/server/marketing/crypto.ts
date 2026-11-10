import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * AES-256-GCM envelope for provider tokens. Format: `v1.<iv>.<tag>.<ciphertext>`, each part base64url.
 * A fresh 12-byte IV is generated for every encryption. Decryption verifies the authentication tag, so
 * any change to the stored value is rejected. Errors never reveal key material or plaintext.
 */
const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class TokenCryptoError extends Error {
  constructor() {
    super("Stored credential could not be read");
    this.name = "TokenCryptoError";
  }
}

export function encryptToken(plaintext: string, key: Buffer): string {
  if (key.length !== 32) throw new TokenCryptoError();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptToken(envelope: string, key: Buffer): string {
  const parts = envelope.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION || key.length !== 32) throw new TokenCryptoError();
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const ciphertext = Buffer.from(parts[3], "base64url");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new TokenCryptoError();
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new TokenCryptoError();
  }
}
