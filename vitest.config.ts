import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/**/*.test.{ts,tsx}", "packages/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    passWithNoTests: true,
    globalSetup: ["./vitest.global-setup.ts"],
    // Database tests share one schema, so test files take turns.
    fileParallelism: false,
  },
});
