import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "convex",
          environment: "edge-runtime",
          server: { deps: { inline: ["convex-test"] } },
          include: ["convex/**/*.test.ts", "src/**/*.test.ts"],
        },
      },
      {
        // workflow code nodes need node's crypto, which the edge runtime lacks
        test: { name: "n8n", environment: "node", include: ["n8n/__tests__/**/*.test.ts"] },
      },
    ],
  },
});
