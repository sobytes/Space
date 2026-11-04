/**
 * The architectural invariants, enforced by reading the source.
 *
 * These were eslint rules first. That was too weak: `no-restricted-imports` matches the literal
 * import string, so `@/view/core/internal/place` was caught while `../core/internal/place` from
 * a sibling directory slipped straight through. A rule that depends on how someone spells a path
 * is not an enforcement of anything.
 *
 * Scanning the source catches every spelling. The eslint zones stay, because they fail fast in
 * an editor, but these tests are the actual guarantee.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Anchored to this file, not to the working directory.
 *
 * It used to scan `"src"` relative to wherever vitest was invoked, which silently became the
 * wrong directory the moment the repository became a monorepo. A scanner that finds no files
 * passes every test it owns, so the failure mode is an invariant that stops being checked
 * without anything going red. The count assertions below exist for the same reason.
 */
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const SCANNED = ["engine/src", "website/src"];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const FILES = SCANNED.flatMap((dir) => sourceFiles(join(ROOT, dir))).map((path) => ({
  path: relative(ROOT, path).replace(/\\/g, "/"),
  text: readFileSync(path, "utf8"),
}));

describe("the engine stays pure", () => {
  it("never imports three, react, next or anything from the view", () => {
    const forbidden = /from\s+["'](three|react|react-dom|next|zustand|@react-three\/[^"']+|three\/[^"']+|[^"']*\/view\/[^"']*|@\/view\/[^"']*)["']/;
    const offenders = FILES.filter((f) => f.path.startsWith("engine/src/") && forbidden.test(f.text));
    expect(
      offenders.map((f) => f.path),
      "the engine must run in a worker and in Node, so it cannot import rendering or React",
    ).toEqual([]);
  });

  it("has at least one engine file, so a path typo cannot make this vacuous", () => {
    expect(FILES.filter((f) => f.path.startsWith("engine/src/")).length).toBeGreaterThan(10);
  });

  it("found both trees, so a moved directory cannot quietly disable every rule here", () => {
    expect(FILES.filter((f) => f.path.startsWith("website/src/")).length).toBeGreaterThan(10);
  });
});

describe("the float64 to float32 boundary", () => {
  /**
   * Every file allowed to write a scale-critical float32 value, each with the reason it is
   * allowed. Adding a file here is a deliberate act that shows up in review, which is the
   * point: the list is the architecture, not a convenience.
   */
  const DECLARED_WRITERS: Readonly<Record<string, string>> = {
    "website/src/view/core/internal/place.ts":
      "the camera-relative conversion itself, which is the whole reason the boundary exists",
    "website/src/view/core/viewport.ts":
      "places the heliocentric root and writes the marker buffer, both camera-relative",
    "website/src/view/react/OrbitPaths.tsx":
      "orbit vertices in true heliocentric metres, carrying about 500 m of error at Neptune, " +
      "which is far under a pixel at any distance from which a whole orbit is visible",
    "website/src/view/react/Starfield.tsx":
      "unit direction vectors on a sphere, so magnitude never exceeds one",
    "website/src/view/react/BodyMarkers.tsx":
      "allocates the empty buffers the viewport writes into, and per-body colours",
  };

  it("only declared files import the conversion module, whatever spelling they use", () => {
    const importsInternal = /from\s+["'][^"']*\/internal\/place["']/;
    const offenders = FILES.filter(
      (f) =>
        importsInternal.test(f.text) &&
        !f.path.startsWith("website/src/view/core/") &&
        !(f.path in DECLARED_WRITERS),
    );
    expect(
      offenders.map((f) => f.path),
      "place.ts holds the only camera-relative conversion; reach it through the Viewport",
    ).toEqual([]);
  });

  it("only declared files write a transform or build a position buffer", () => {
    const writesTransform =
      /\.position\.set\(|\.position\.copy\(|\.scale\.setScalar\(|new Float32Array\(|setXYZ\(/;
    const offenders = FILES.filter(
      (f) =>
        (f.path.startsWith("website/src/view/") || f.path.startsWith("website/src/app/")) &&
        writesTransform.test(f.text) &&
        !(f.path in DECLARED_WRITERS),
    );
    expect(
      offenders.map((f) => f.path),
      "a new float32 writer must be declared in DECLARED_WRITERS with its justification",
    ).toEqual([]);
  });

  it("every declared writer still exists, still writes, and still carries a reason", () => {
    const writesTransform =
      /\.position\.set\(|\.position\.copy\(|\.scale\.setScalar\(|new Float32Array\(|setXYZ\(/;

    for (const [path, reason] of Object.entries(DECLARED_WRITERS)) {
      const file = FILES.find((f) => f.path === path);
      expect(file, `${path} is declared but missing`).toBeDefined();
      expect(reason.length, `${path} needs a real justification`).toBeGreaterThan(40);
      // A stale declaration is worse than none: it makes the list stop meaning
      // "these are the writers" and quietly pre-authorises a file that no longer qualifies.
      expect(
        writesTransform.test(file!.text),
        `${path} is declared as a writer but no longer writes one; remove it`,
      ).toBe(true);
    }
  });
});
