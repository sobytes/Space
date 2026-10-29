import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const ROOT = fileURLToPath(new URL(".", import.meta.url));

/**
 * One test run across the whole monorepo.
 *
 * The engine's gates and the website's gates are kept in one command deliberately. The engine
 * is shared, so a change to it has to be proved against every consumer in the same run rather
 * than in a separate job somebody can forget.
 *
 * `reporters` is not cosmetic. Measured on vitest 5.0.5: with no config, a passing test's
 * `console.log` and `console.table` are dropped from the output entirely, and a CLI
 * `--reporter=default` does not override this key. `verify:ephemeris` has to print its
 * per-body error table on a pass as well as a failure, so a reader can see the margin.
 */
export default defineConfig({
  /**
   * Both aliases are spelled out here. tsc resolves them through each package's `paths`,
   * Turbopack through `transpilePackages`, and vitest through neither, so without this an
   * importing test file fails to load and vitest reports "no tests" rather than an error,
   * which looks exactly like a passing empty suite.
   */
  resolve: {
    /**
     * An array of regexes, not an object. A string alias key in vite matches by prefix, so
     * `"@solar/engine"` would also swallow `@solar/engine/nbody` and resolve it to
     * `index.ts/nbody`. Anchored patterns make the barrel and the deep imports distinct, and
     * the deep one has to be tried first.
     */
    alias: [
      { find: /^@solar\/engine$/, replacement: `${ROOT}engine/src/index.ts` },
      { find: /^@solar\/engine\/(.*)$/, replacement: `${ROOT}engine/src/$1.ts` },
      { find: /^@\/(.*)$/, replacement: `${ROOT}website/src/$1` },
    ],
  },
  test: {
    include: ["engine/src/**/*.test.ts", "website/src/**/*.test.ts"],
    reporters: ["verbose"],
  },
});
