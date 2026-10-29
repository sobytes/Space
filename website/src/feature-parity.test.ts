/**
 * The feature parity gate.
 *
 * The physics contracts make every client compute the same numbers. This checks that they do
 * the same things. A feature shipped on the web and never recorded is invisible from inside
 * the web codebase, which is exactly how a client ends up numerically perfect and missing half
 * the product.
 *
 * `contracts/features.json` is the source of truth rather than a table in a readme, because a
 * hand-maintained table drifts the moment someone is in a hurry. This enforces its structure
 * and, most usefully, that every path a feature claims to be implemented in actually exists.
 * A refactor that moves a file turns this red, so the manifest cannot become fiction.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

interface Entry {
  readonly status: string;
  readonly gap?: string;
  readonly paths?: readonly string[];
}

interface Feature {
  readonly id: string;
  readonly title: string;
  readonly why: string;
  readonly [platform: string]: unknown;
}

interface Manifest {
  readonly platforms: readonly string[];
  readonly statuses: Readonly<Record<string, string>>;
  readonly features: readonly Feature[];
}

const MANIFEST = JSON.parse(
  readFileSync(join(ROOT, "contracts/features.json"), "utf8"),
) as Manifest;

const entryFor = (feature: Feature, platform: string): Entry => feature[platform] as Entry;

describe("the feature manifest is well formed", () => {
  it("has features and platforms, so an emptied file cannot pass everything", () => {
    expect(MANIFEST.features.length).toBeGreaterThan(10);
    expect(MANIFEST.platforms).toContain("web");
    expect(MANIFEST.platforms).toContain("ios");
  });

  it("gives every feature a unique id, a title and a reason to exist", () => {
    const ids = MANIFEST.features.map((f) => f.id);
    expect(new Set(ids).size, "duplicate feature id").toBe(ids.length);
    for (const feature of MANIFEST.features) {
      expect(feature.title.length, `${feature.id} title`).toBeGreaterThan(10);
      // "Why" is the field that stops this becoming a changelog. A feature nobody can
      // justify in one line is a feature nobody should be porting to four platforms.
      expect(feature.why.length, `${feature.id} why`).toBeGreaterThan(20);
    }
  });

  it("covers every platform for every feature, with no blanks", () => {
    for (const feature of MANIFEST.features) {
      for (const platform of MANIFEST.platforms) {
        const entry = entryFor(feature, platform);
        expect(entry, `${feature.id} has no entry for ${platform}`).toBeDefined();
        expect(
          Object.keys(MANIFEST.statuses),
          `${feature.id} on ${platform} has status "${entry.status}"`,
        ).toContain(entry.status);
      }
    }
  });
});

describe("what a platform claims is real", () => {
  it("names files for everything shipped or partial, and those files exist", () => {
    for (const feature of MANIFEST.features) {
      for (const platform of MANIFEST.platforms) {
        const entry = entryFor(feature, platform);
        if (entry.status !== "shipped" && entry.status !== "partial") continue;

        expect(
          entry.paths?.length ?? 0,
          `${feature.id} on ${platform} is ${entry.status} but names no files`,
        ).toBeGreaterThan(0);

        for (const path of entry.paths ?? []) {
          expect(
            existsSync(join(ROOT, path)),
            `${feature.id} on ${platform} names ${path}, which does not exist. ` +
              "If a refactor moved it, update contracts/features.json in the same change.",
          ).toBe(true);
        }
      }
    }
  });

  it("explains every partial and every deliberate omission", () => {
    for (const feature of MANIFEST.features) {
      for (const platform of MANIFEST.platforms) {
        const entry = entryFor(feature, platform);
        if (entry.status !== "partial" && entry.status !== "n/a") continue;
        expect(
          entry.gap?.length ?? 0,
          `${feature.id} on ${platform} is "${entry.status}" and must say what is missing or why`,
        ).toBeGreaterThan(25);
      }
    }
  });

  /**
   * The web is the reference client, so a feature nothing has shipped anywhere is a
   * specification rather than a record, and that is worth noticing rather than forbidding.
   */
  it("records at least one platform shipping each feature", () => {
    for (const feature of MANIFEST.features) {
      const anywhere = MANIFEST.platforms.filter(
        (p) => entryFor(feature, p).status === "shipped",
      );
      expect(
        anywhere.length,
        `${feature.id} is shipped nowhere. Remove it, or mark where it actually lives.`,
      ).toBeGreaterThan(0);
    }
  });
});

describe("the parity table", () => {
  beforeAll(() => {
    const mark = (status: string) =>
      ({ shipped: "yes", partial: "part", planned: "-", "n/a": "n/a" })[status] ?? "?";

    console.table(
      MANIFEST.features.map((feature) => {
        const row: Record<string, string> = { feature: feature.id };
        for (const platform of MANIFEST.platforms) {
          row[platform] = mark(entryFor(feature, platform).status);
        }
        return row;
      }),
    );

    const summary = MANIFEST.platforms.map((platform) => {
      const counts = { shipped: 0, partial: 0, planned: 0, "n/a": 0 } as Record<string, number>;
      for (const feature of MANIFEST.features) counts[entryFor(feature, platform).status] += 1;
      return {
        platform,
        shipped: counts.shipped,
        partial: counts.partial,
        planned: counts.planned,
        "n/a": counts["n/a"],
        "of total": `${counts.shipped}/${MANIFEST.features.length}`,
      };
    });
    console.table(summary);
  });

  it("reports where each platform stands", () => {
    // Printed above. The assertion is only here so the table runs on a passing suite too:
    // a gap nobody is shown is a gap nobody closes.
    expect(MANIFEST.features.length).toBeGreaterThan(0);
  });
});
