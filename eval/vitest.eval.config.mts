import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Runs the HR AI evaluation. It is kept out of `npm test` because it calls real AI providers. */
export default defineConfig({
  root: fileURLToPath(new URL("..", import.meta.url)),
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../src", import.meta.url)),
      "server-only": fileURLToPath(new URL("../tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["eval/run_hr_ai_eval.ts"],
    testTimeout: 15 * 60_000,
  },
});
