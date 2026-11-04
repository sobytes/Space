import type { NextConfig } from "next";

const ONE_YEAR_IMMUTABLE = "public, max-age=31536000, immutable";

const nextConfig: NextConfig = {
  /**
   * The engine ships as TypeScript source rather than a build artifact, so Next has to compile
   * it like first-party code. No build step means no stale dist to forget to rebuild, and the
   * gates, the route handler and the browser all run the identical files.
   */
  transpilePackages: ["@solar/engine"],
  typescript: {
    /**
     * The build checks application code; `npm run typecheck` checks everything.
     *
     * `tsconfig.json` sweeps in the eleven test files under src, and type-checking those
     * needs `vitest` resolvable. That makes a production install depend on the test runner,
     * and on Vercel it is not there: the deploy failed on a missing type package, and this
     * would have been the very next error after fixing it.
     */
    tsconfigPath: "tsconfig.build.json",
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        // public/ defaults to max-age=0, which would re-validate every texture on every load.
        source: "/textures/:path*",
        headers: [{ key: "Cache-Control", value: ONE_YEAR_IMMUTABLE }],
      },
      {
        source: "/ephemeris/:path*",
        headers: [{ key: "Cache-Control", value: ONE_YEAR_IMMUTABLE }],
      },
    ];
  },
};

export default nextConfig;
