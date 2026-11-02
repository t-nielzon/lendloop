/// <reference types="vite/client" />

// shared module map for convex-test; test files are excluded so they are not loaded as functions
export const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts", "!./**/*.d.ts", "./_generated/*.js"]);
