/**
 * Every texture a body contract names must be downloadable.
 *
 * This check spans the engine and the website, so it lives on the website side. The engine
 * declares which textures a body has, the website's manifest says where to fetch them from,
 * and a contract naming an id the manifest does not carry renders as an untextured planet with
 * no error anywhere. Running it here rather than in the engine keeps the dependency pointing
 * one way: every client depends on the engine, and the engine depends on none of them.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BODY_CONTRACTS, BODY_IDS } from "@solar/engine/bodies/registry";

const MANIFEST_IDS: ReadonlySet<string> = new Set(
  (
    JSON.parse(
      readFileSync(new URL("../scripts/assets.manifest.json", import.meta.url), "utf8"),
    ) as { assets: { id: string }[] }
  ).assets.map((asset) => asset.id),
);

describe("asset manifest against the body contracts", () => {
  it.each(BODY_IDS.map((id) => [id, BODY_CONTRACTS[id]] as const))(
    "%s names only textures the manifest can fetch",
    (_id, contract) => {
      const named = [
        contract.appearance.albedoTextureId,
        contract.appearance.nightTextureId,
        contract.appearance.cloudTextureId,
        contract.appearance.normalTextureId,
        contract.appearance.ringSystem?.textureId,
      ].filter((value): value is string => typeof value === "string");

      for (const textureId of named) {
        expect(
          MANIFEST_IDS.has(textureId),
          `${contract.id} names texture "${textureId}", absent from scripts/assets.manifest.json`,
        ).toBe(true);
      }
    },
  );

  it("has a manifest with entries, so an empty read cannot pass everything", () => {
    expect(MANIFEST_IDS.size).toBeGreaterThan(10);
  });
});
