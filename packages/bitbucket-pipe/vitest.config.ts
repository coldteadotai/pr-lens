import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The script tests spawn real shells and a real node per case, which sits
    // near the 5s default and tips over it when the workspace runs suites in
    // parallel. Slow is fine here; flaky is not.
    testTimeout: 30_000,
  },
});
