import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["src/**/*.test.ts", "src/**/*.integration.test.ts"],
        setupFiles: ["src/test/setup.ts"],
        // Tests must be deterministic — no implicit globals / no fake timers.
        environment: "node",
        // Per-test isolation; integration tests run sequentially because they share a DB.
        pool: "forks",
        poolOptions: { forks: { singleFork: true } },
        testTimeout: 15000,
    },
});
