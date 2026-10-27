import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * `reporters` is not cosmetic. Measured on vitest 5.0.5: with no config, a passing test's
 * `console.log` and `console.table` are dropped from the output entirely, and a CLI
 * `--reporter=default` does not override this key. `verify:ephemeris` has to print its
 * per-body error table on a pass as well as a failure, so a reader can see the margin.
 */
export default defineConfig({
  /**
   * The `@/` alias from tsconfig has to be repeated here. tsc resolves it, Turbopack resolves
   * it, and vitest did not, so a test importing `@/engine/...` failed to load and vitest
   * reported "no tests" rather than an error, which looks exactly like a passing empty suite.
   */
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    reporters: ["verbose"],
  },
});
