import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["server/lib/__tests__/**/*.test.ts", "server/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html", "lcov"],
      reportsDirectory: "coverage",
      include: [
        "server/lib/numbers.ts",
        "server/lib/currency.ts",
        "server/lib/pricing.ts",
        "server/lib/coupon.ts",
        "server/lib/pagination.ts",
        "server/lib/validation.ts",
        "server/lib/text.ts",
        "server/lib/orderStatus.ts",
        "server/lib/permissions.ts",
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
