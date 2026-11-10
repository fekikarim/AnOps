import { describe, expect, it } from "vitest";
import { readImageMeta } from "@/server/platform/image-meta";
import { parseGeminiKeys } from "@/server/ai/image/gemini-keys";
import { jpegBytes, pngBytes, webpBytes } from "../helpers/images";

describe("image header validation", () => {
  it("reads type and size from PNG, JPEG and WebP headers", () => {
    expect(readImageMeta(pngBytes(640, 480))).toEqual({ mimeType: "image/png", width: 640, height: 480 });
    expect(readImageMeta(jpegBytes(1024, 768))).toEqual({ mimeType: "image/jpeg", width: 1024, height: 768 });
    expect(readImageMeta(webpBytes(300, 200))).toEqual({ mimeType: "image/webp", width: 300, height: 200 });
  });

  it("decides by content, never by name: SVG, HTML, executables, PDFs and empty files are refused", () => {
    expect(readImageMeta(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(readImageMeta(Buffer.from("<html><body>logo.png</body></html>"))).toBeNull();
    expect(readImageMeta(Buffer.from("MZ\u0090\u0000\u0003\u0000\u0000\u0000".padEnd(64, "\0")))).toBeNull();
    expect(readImageMeta(Buffer.from("%PDF-1.7 ".padEnd(64, " ")))).toBeNull();
    expect(readImageMeta(Buffer.alloc(0))).toBeNull();
  });

  it("refuses truncated files and zero dimensions", () => {
    expect(readImageMeta(pngBytes().subarray(0, 14))).toBeNull();
    expect(readImageMeta(pngBytes(0, 0))).toBeNull();
  });
});

describe("GEMINI_API_KEYS parsing", () => {
  const k = (n: number) => `AQ.Ab8RN6${String(n).repeat(40)}`;
  it("splits on commas, trims, drops duplicates and blanks", () => {
    expect(parseGeminiKeys(` ${k(1)} , ${k(2)},,${k(1)} `)).toEqual({ keys: [k(1), k(2)], invalidCount: 0 });
  });
  it("rejects an entry that is really two keys joined by a missing comma, and junk", () => {
    const out = parseGeminiKeys(`${k(1)},${k(2)}${k(3)},short,has space inside`);
    expect(out.keys).toEqual([k(1)]);
    expect(out.invalidCount).toBe(3);
  });
  it("handles unset and quoted values", () => {
    expect(parseGeminiKeys(undefined)).toEqual({ keys: [], invalidCount: 0 });
    expect(parseGeminiKeys(`"${k(4)}"`).keys).toEqual([k(4)]);
  });
});
