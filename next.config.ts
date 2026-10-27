import type { NextConfig } from "next";

const ONE_YEAR_IMMUTABLE = "public, max-age=31536000, immutable";

const nextConfig: NextConfig = {
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
