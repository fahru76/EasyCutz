import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Eval harness (evals/): scored separately from unit tests, see evals/README.md.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["evals/**/*.eval.ts"],
    testTimeout: 60_000,
  },
});
