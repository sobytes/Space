import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * The engine's purity is a load-bearing architectural constraint, not a preference.
 *
 * Since the monorepo split most of it is enforced structurally rather than by this file:
 * `engine/` is its own package, it declares no dependency on the website, and its tsconfig
 * leaves `dom` out of `lib` so a DOM reference will not compile. These rules stay as a second
 * layer, because the structural ones only catch what the type checker sees. The same
 * code has to run in the browser, in a Web Worker, and in a Node route handler so that the AI
 * tools and the CI gates exercise the real engine rather than a described version of it. A
 * single stray `import * as THREE` would silently end that, and a comment will not stop it.
 *
 * The float64 to float32 conversion is the second one. It must happen in exactly one place,
 * camera-relative, so `src/view/core/internal/` is unreachable from outside the render core.
 */
const CONVERSION_FENCE = {
  group: ["**/view/core/internal/*", "@/view/core/internal/*"],
  message:
    "internal/ holds the only float64 to float32 write in the repo. Place a body through the Viewport instead.",
};

const engineStaysPure = {
  files: ["engine/src/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: [
          { name: "three", message: "The engine must not import three. Keep rendering in src/view." },
          { name: "react", message: "The engine must not import react. It has to run in a worker and in Node." },
          { name: "next", message: "The engine must not import next." },
          { name: "zustand", message: "The engine must not import zustand. State belongs to the view." },
        ],
        patterns: [
          { group: ["three/*", "@react-three/*", "react-dom*", "next/*", "zustand/*"], message: "The engine must stay free of rendering and React. Keep this in src/view." },
          { group: ["@/view/*", "../view/*", "../../view/*"], message: "The dependency points one way: view imports engine, never the reverse." },
          CONVERSION_FENCE,
        ],
      },
    ],
  },
};

/**
 * Scoped to exclude src/engine so it cannot override the engine's own rule config. ESLint flat
 * config resolves a rule by last match, not by union, so two blocks both setting
 * no-restricted-imports over overlapping files silently disables the earlier one. The engine
 * block below carries this same fence inline for that reason.
 */
const conversionHappensOnce = {
  files: ["website/src/**/*.{ts,tsx}"],
  ignores: ["website/src/view/core/**"],
  rules: {
    "no-restricted-imports": ["error", { patterns: [CONVERSION_FENCE] }],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    "**/.next/**",
    "**/out/**",
    "**/build/**",
    "**/next-env.d.ts",
    // Native client folders. Swift, Kotlin and their build output are not ESLint's business.
    "mobile/**",
    "tv/**",
    // Vendored agent skill packs. Not our source, and they carry their own conventions.
    ".claude/**",
    // Audit artifacts, including throwaway benchmarks kept for the decision trail.
    ".audit/**",
  ]),
  engineStaysPure,
  conversionHappensOnce,
]);

export default eslintConfig;
