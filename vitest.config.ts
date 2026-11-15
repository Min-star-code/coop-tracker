import { defineConfig } from "vitest/config";

// API tests only (the browser tests are Playwright, in e2e/).
export default defineConfig({ test: { root: ".", include: ["server/test/**/*.test.ts"] } });
