import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// separate config: the root one only includes convex and src tests and runs in the edge runtime,
// while the workflow code nodes need node's crypto.
export default defineConfig({
  test: {
    environment: "node",
    root: fileURLToPath(new URL(".", import.meta.url)),
    include: ["__tests__/**/*.test.ts"],
  },
});
