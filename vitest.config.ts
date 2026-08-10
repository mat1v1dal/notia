import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Cada archivo de test levanta su propia PGlite en memoria, así que
    // los tests no comparten estado y pueden correr en paralelo.
    include: ["packages/*/src/**/*.test.ts"],
    testTimeout: 20_000,
  },
});
