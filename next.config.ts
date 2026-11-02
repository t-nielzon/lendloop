import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // keeps next dev from regenerating agent instruction files in the repo
  agentRules: false,
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
