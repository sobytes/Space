/**
 * Predicate P10's answerable half: does the renderer pick a tile level fine enough that a
 * crater is bigger than a screen pixel?
 *
 * Whether craters look right is a screenshot question. Whether the tile selection is capable
 * of resolving them is arithmetic, and arithmetic can be failed.
 */

import { describe, expect, it } from "vitest";
import {
  levelFor,
  metresPerPixel,
  tileExtent,
  tileUrl,
  tilesInView,
  visibleCapAngle,
  type TerrainManifest,
} from "./tiles";

const MOON_RADIUS = 1_737_400;
const FOV = (45 * Math.PI) / 180;
const SCREEN_HEIGHT = 1080;

/** Mirrors what scripts/build-terrain.mjs writes, so the gate tests the real shape. */
const MANIFEST: TerrainManifest = {
  body: "moon",
  tileSize: 512,
  globalNormalMap: "normal-global.jpg",
  globalWidth: 8192,
  referenceRadiusM: MOON_RADIUS,
  elevationRangeM: [-9150, 10780],
  source: "LRO LOLA GDR",
  levels: [0, 1, 2, 3].map((level) => {
    const tilesX = 2 ** (level + 1);
    const levelWidth = tilesX * 512;
    return {
      level,
      tilesX,
      tilesY: 2 ** level,
      levelWidth,
      levelHeight: levelWidth / 2,
      metresPerTexel: (2 * Math.PI * MOON_RADIUS) / levelWidth,
    };
  }),
};

describe("how fine a texel the screen can actually use", () => {
  it("a pixel covers less ground the closer you get", () => {
    const high = metresPerPixel(1_000_000, FOV, SCREEN_HEIGHT);
    const low = metresPerPixel(10_000, FOV, SCREEN_HEIGHT);
    expect(low).toBeLessThan(high);
    // One kilometre up, a pixel is a handful of metres across.
    expect(metresPerPixel(1_000, FOV, SCREEN_HEIGHT)).toBeLessThan(2);
  });

  /**
   * The altitude at which the global map stops being enough is computed, not remembered.
   * Research put it at "roughly 1,500 km", but the crossover depends on field of view and
   * viewport height, and at 45 degrees over 1080 pixels it is 1,737 km. The assertion is on
   * the computed value and the dependence is stated, because a figure that moves with the
   * viewport should not be written down as a constant.
   */
  it("computes where the global map stops being enough, rather than assuming it", () => {
    const globalTexel = (2 * Math.PI * MOON_RADIUS) / MANIFEST.globalWidth;
    expect(globalTexel).toBeGreaterThan(1_300);
    expect(globalTexel).toBeLessThan(1_400);

    // metresPerPixel is linear in altitude, so the crossover inverts directly.
    const crossover = globalTexel / metresPerPixel(1, FOV, SCREEN_HEIGHT);
    expect(crossover / 1000, "crossover altitude in km").toBeGreaterThan(1_500);
    expect(crossover / 1000, "crossover altitude in km").toBeLessThan(2_000);

    expect(metresPerPixel(crossover * 1.5, FOV, SCREEN_HEIGHT)).toBeGreaterThan(globalTexel);
    expect(metresPerPixel(crossover * 0.5, FOV, SCREEN_HEIGHT)).toBeLessThan(globalTexel);
  });
});

describe("level selection", () => {
  it("picks a coarse level from far away and a fine one from close", () => {
    const far = levelFor(MANIFEST, 5_000_000, FOV, SCREEN_HEIGHT);
    const near = levelFor(MANIFEST, 20_000, FOV, SCREEN_HEIGHT);
    expect(near.level).toBeGreaterThan(far.level);
  });

  it("never picks a level finer than the screen can show", () => {
    for (const altitude of [1e4, 5e4, 1e5, 5e5, 1e6, 5e6]) {
      const target = metresPerPixel(altitude, FOV, SCREEN_HEIGHT);
      const chosen = levelFor(MANIFEST, altitude, FOV, SCREEN_HEIGHT);
      const coarser = MANIFEST.levels[chosen.level - 1];
      if (coarser) {
        expect(
          coarser.metresPerTexel,
          `at ${altitude} m a coarser level would have been too blurry`,
        ).toBeGreaterThan(target);
      }
    }
  });

  it("saturates at the deepest level rather than failing when the camera gets very close", () => {
    const chosen = levelFor(MANIFEST, 500, FOV, SCREEN_HEIGHT);
    expect(chosen.level).toBe(MANIFEST.levels[MANIFEST.levels.length - 1].level);
  });
});

describe("what is visible", () => {
  it("sees a small cap from low altitude and most of a hemisphere from far out", () => {
    const low = visibleCapAngle(MOON_RADIUS, 10_000);
    const high = visibleCapAngle(MOON_RADIUS, 50_000_000);
    expect(low).toBeLessThan(0.15);
    expect(high).toBeGreaterThan(1.5);
    expect(high).toBeLessThan(Math.PI / 2);
  });

  it("selects fewer tiles close up than from far away at the same level", () => {
    const level = MANIFEST.levels[3];
    const centre = { latitude: 0, longitude: Math.PI };
    const close = tilesInView(level, centre, visibleCapAngle(MOON_RADIUS, 20_000));
    const far = tilesInView(level, centre, visibleCapAngle(MOON_RADIUS, 5_000_000));
    expect(close.length).toBeLessThanOrEqual(far.length);
  });

  it("never exceeds its tile budget, even looking at a whole hemisphere", () => {
    const level = MANIFEST.levels[3];
    const tiles = tilesInView(level, { latitude: 0, longitude: 0 }, Math.PI / 2, 24);
    expect(tiles.length).toBeLessThanOrEqual(24);
  });

  it("returns no duplicates, so nothing is drawn twice", () => {
    const tiles = tilesInView(MANIFEST.levels[2], { latitude: 0.3, longitude: 1.2 }, 0.6);
    const keys = new Set(tiles.map((t) => `${t.x}-${t.y}`));
    expect(keys.size).toBe(tiles.length);
  });

  it("wraps longitude rather than running off the edge of the map", () => {
    const level = MANIFEST.levels[2];
    // Sitting on the seam at longitude zero must pull tiles from both sides.
    const tiles = tilesInView(level, { latitude: 0, longitude: 0 }, 0.5);
    const columns = new Set(tiles.map((t) => t.x));
    expect(columns.has(0)).toBe(true);
    expect(columns.has(level.tilesX - 1)).toBe(true);
  });

  it("copes with the poles, where every longitude is in view", () => {
    const tiles = tilesInView(MANIFEST.levels[2], { latitude: Math.PI / 2, longitude: 0 }, 0.4);
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) {
      expect(tile.y).toBeGreaterThanOrEqual(0);
      expect(tile.y).toBeLessThan(MANIFEST.levels[2].tilesY);
    }
  });
});

describe("tile geometry and addressing", () => {
  it("covers the whole sphere exactly once at every level", () => {
    for (const level of MANIFEST.levels) {
      let solidAngle = 0;
      for (let y = 0; y < level.tilesY; y++) {
        for (let x = 0; x < level.tilesX; x++) {
          const extent = tileExtent(level, { level: level.level, x, y });
          // Area of a sphere segment: phiLength * (cos(thetaStart) - cos(thetaEnd)).
          solidAngle +=
            extent.phiLength *
            (Math.cos(extent.thetaStart) - Math.cos(extent.thetaStart + extent.thetaLength));
        }
      }
      expect(solidAngle, `level ${level.level} must cover 4pi steradians`).toBeCloseTo(
        4 * Math.PI,
        9,
      );
    }
  });

  it("builds a url matching what the pipeline writes", () => {
    expect(tileUrl("moon", { level: 2, x: 5, y: 1 })).toBe("/terrain/moon/2/5-1.jpg");
  });
});
