/**
 * Every texture a body contract names must be a file the deployment can serve.
 *
 * `assets.test.ts` already proves a contract only names textures the manifest knows how to
 * fetch. That was not enough, and the gap took the live site down: the manifest was complete,
 * the textures were downloaded on my machine, and the deployed build had none of them, because
 * the originals are deliberately not in git. The first body drawn requested a file that was
 * not there and the page died.
 *
 * So this checks the thing that actually matters, which is bytes on disk under `public`, where
 * the committed derivatives live. It is the only gate here that can fail on a clean clone, and
 * failing there is the point: it means the build output is missing, not that the test is wrong.
 */

import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BODY_CONTRACTS, BODY_IDS } from "@solar/engine/bodies/registry";

const TEXTURE_DIR = fileURLToPath(new URL("../public/textures/", import.meta.url));

function namedTextures(id: (typeof BODY_IDS)[number]): readonly string[] {
  const { appearance } = BODY_CONTRACTS[id];
  return [
    appearance.albedoTextureId,
    appearance.nightTextureId,
    appearance.cloudTextureId,
    appearance.normalTextureId,
    appearance.ringSystem?.textureId,
  ].filter((value): value is string => typeof value === "string");
}

const named = [...new Set(BODY_IDS.flatMap(namedTextures))].sort();

describe("served textures against the body contracts", () => {
  it("has contracts that name textures at all, so an empty list cannot pass", () => {
    expect(named.length).toBeGreaterThan(10);
  });

  it.each(named)("%s has a base image under public/textures", (textureId) => {
    const path = `${TEXTURE_DIR}${textureId}.webp`;
    expect(existsSync(path), `${path} missing. Run: npm run textures`).toBe(true);
    expect(statSync(path).size, `${path} is empty`).toBeGreaterThan(1024);
  });

  /**
   * The base images are what every visitor downloads before the first frame, all of them, so
   * their total is the cost of opening the page. 2.5 MB today. The ceiling is deliberately not
   * much above that: it is there to make a careless 8192 original committed by hand fail here
   * rather than quietly triple what a phone on mobile data has to fetch.
   */
  it("keeps the whole scene's base imagery under 4 MB", () => {
    const bytes = named.reduce(
      (sum, textureId) => sum + statSync(`${TEXTURE_DIR}${textureId}.webp`).size,
      0,
    );
    expect(bytes, `base textures total ${(bytes / 1024 ** 2).toFixed(1)} MB`).toBeLessThan(
      4 * 1024 ** 2,
    );
  });
});
