import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BODY_CONTRACTS, BODY_IDS } from "@solar/engine/bodies/registry";

/**
 * Does the contract agree with what is actually on disk?
 *
 * `appearance.hasTerrain` tells the clients which bodies to request a tile pyramid for. It
 * used to be nothing at all: the web client asked for every body and got a 404 for all but
 * the Moon, so one page load produced 31 failed requests. The requests were cheap and the
 * harm was elsewhere, in a console so full of expected failures that a real one would never
 * be noticed.
 *
 * Checked in both directions on purpose. A contract claiming data that is not shipped gives
 * a body a permanent silent 404, and data shipped that no contract claims is work that was
 * done and is never shown. Neither fails any other test.
 */
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TERRAIN = join(ROOT, "website/public/terrain");

function shippedBodies(): string[] {
  if (!existsSync(TERRAIN)) return [];
  return readdirSync(TERRAIN, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(TERRAIN, name, "manifest.json")));
}

describe("terrain coverage", () => {
  it("ships a manifest for every body whose contract claims terrain", () => {
    const claimed = BODY_IDS.filter((id) => BODY_CONTRACTS[id].appearance.hasTerrain);
    expect(claimed.length).toBeGreaterThan(0);
    for (const id of claimed) {
      expect(
        existsSync(join(TERRAIN, id, "manifest.json")),
        `${id} declares terrain, so the client will request `
          + `/terrain/${id}/manifest.json, and nothing is there`,
      ).toBe(true);
    }
  });

  it("claims every body whose terrain is actually shipped", () => {
    for (const body of shippedBodies()) {
      const contract = BODY_CONTRACTS[body as keyof typeof BODY_CONTRACTS];
      expect(contract, `public/terrain/${body} is not a body in the registry`).toBeDefined();
      expect(
        contract.appearance.hasTerrain,
        `${body} has a tile pyramid on disk that no contract claims, so no client asks for it`,
      ).toBe(true);
    }
  });

  it("asks for nothing it has not declared", () => {
    const undeclared = BODY_IDS.filter(
      (id) => !BODY_CONTRACTS[id].appearance.hasTerrain && existsSync(join(TERRAIN, id)),
    );
    expect(undeclared).toEqual([]);
  });
});
