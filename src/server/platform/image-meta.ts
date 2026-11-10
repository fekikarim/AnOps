import { sniffImage } from "@/server/ai/image/gemini-image.provider";

export type ImageMeta = { mimeType: "image/png" | "image/jpeg" | "image/webp"; width: number; height: number };

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);

/**
 * Decides the type from the file's own bytes (never from a name or a claimed MIME type) and reads its pixel size from the
 * header, without decoding the image. Returns null for anything that is not a well-formed PNG, JPEG or WebP.
 */
export function readImageMeta(bytes: Uint8Array): ImageMeta | null {
  const mimeType = sniffImage(bytes);
  if (!mimeType) return null;
  let size: { width: number; height: number } | null = null;
  if (mimeType === "image/png") {
    // 8-byte signature, then the IHDR chunk: length(4) "IHDR"(4) width(4) height(4)
    if (bytes.length >= 24 && String.fromCharCode(...bytes.subarray(12, 16)) === "IHDR") size = { width: u32be(bytes, 16), height: u32be(bytes, 20) };
  } else if (mimeType === "image/jpeg") {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const length = u16be(bytes, i + 2);
      // Start-of-frame markers carry the size (C4, C8 and CC are not frames).
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        size = { height: u16be(bytes, i + 5), width: u16be(bytes, i + 7) };
        break;
      }
      i += 2 + length;
    }
  } else {
    const chunk = String.fromCharCode(...bytes.subarray(12, 16));
    if (chunk === "VP8X" && bytes.length >= 30) size = { width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 };
    else if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
      const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
      size = { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    } else if (chunk === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      size = { width: (bytes[26] | (bytes[27] << 8)) & 0x3fff, height: (bytes[28] | (bytes[29] << 8)) & 0x3fff };
    }
  }
  return size && size.width > 0 && size.height > 0 ? { mimeType, ...size } : null;
}
