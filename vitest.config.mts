import { defineConfig } from "vitest/config";

/**
 * The verbose reporter is not cosmetic here: the default reporter swallows stdout from
 * passing tests, and `verify:ephemeris` has to print its per-body error table on a pass as
 * well as a failure, so a human can read the margin rather than just the word "passed".
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    reporters: ["verbose"],
  },
});
