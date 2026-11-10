/**
 * Real Gemini image smoke test (one generation, optionally one edit). Reads GEMINI_API_KEYS from the environment or .env.
 * Never prints a key. Usage: npx vite-node -c vitest.config.mts scripts/gemini-image-smoke.ts -- [out.png]
 */
import { writeFileSync } from "fs";

try {
  process.loadEnvFile(".env");
} catch {
  /* the variables may already be in the environment */
}

async function main() {
  const { GeminiImageProvider } = await import("../src/server/ai/image/gemini-image.provider");
  const provider = new GeminiImageProvider();
  console.log("provider status:", provider.status());
  const started = Date.now();
  try {
    const image = await provider.generate({ prompt: "A clean, flat vector logo mark for a Tunisian window manufacturer: a simple geometric window frame in deep green and lime. Centered, plain white background, no text, no letters." });
    console.log(`generated ${image.mimeType} ${Math.round(image.bytes.length / 1024)} KB with ${image.model} in ${Date.now() - started} ms`);
    const out = process.argv.slice(2).find((a) => a.endsWith(".png"));
    if (out) writeFileSync(out, image.bytes);
  } catch (error) {
    const e = error as { kind?: string; message?: string; detail?: string };
    console.log("failed:", e.kind ?? "unknown", "-", e.message, e.detail ? `| upstream: ${e.detail}` : "");
    process.exitCode = 1;
  }
}
void main();
