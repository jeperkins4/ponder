import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    exclude: ["**/node_modules/**", "**/.worktrees/**"],
    // DB-backed test files share one test database, and several suites
    // (e.g. projects route.test.ts beforeEach deleteMany) assume exclusive
    // table access. Parallel file execution races those assumptions and
    // fails ~40 tests with P2025 cleanup errors, so run files sequentially.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
