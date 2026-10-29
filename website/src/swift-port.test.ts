/**
 * The cross-language drift gate.
 *
 * `mobile/ios/SolarKit` is a hand-port of the engine, because Swift cannot import TypeScript.
 * A hand-port drifts, and a drifted physics engine does not throw: it puts a planet somewhere
 * plausible and wrong. The contracts in `contracts/` say what a port must meet; this is what
 * checks that it still does.
 *
 * How it works. `swift test` measures the Swift port against the JPL Horizons fixtures and
 * writes every residual to `residuals.json`, which is committed. This recomputes the same
 * quantities with the TypeScript engine and asserts they agree. The two share no code, only
 * the generated element tables and the fixtures, so agreement to float64 round-off means the
 * algorithms match.
 *
 * Deliberately not comparing the two implementations' *outputs* against each other in the
 * abstract: both are measured against the same external truth, JPL, and the residual is the
 * quantity that matters. Two implementations of the same mistake would agree perfectly on a
 * position and both be wrong against Horizons.
 *
 * When this fails, the fix is usually to carry an engine change into the Swift and re-run
 * `swift test`, not to loosen the tolerance.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLANET_IDS, SHORT_SPAN, type PlanetId } from "@solar/engine/data/planets";
import { heliocentricState } from "@solar/engine/kepler";
import { jdTdb } from "@solar/engine/time";
import { metresToKm, normalizeAngleSigned } from "@solar/engine/units";
import { length, type Vec3 } from "@solar/engine/vec";

const ARCSEC_PER_RADIAN = 648_000 / Math.PI;

interface Row {
  readonly epoch: string;
  readonly jdTdb: number;
  readonly longitudeArcsec: number;
  readonly latitudeArcsec: number;
  readonly distanceKm: number;
}

const RECORDED = JSON.parse(
  readFileSync(new URL("../../mobile/ios/SolarKit/residuals.json", import.meta.url), "utf8"),
) as { model: string; bodies: Record<string, Row[]> };

/** Reads the fixture the Swift port measured itself against, so both use the same truth. */
function fixturePositions(body: PlanetId): Map<number, Vec3> {
  const parsed = JSON.parse(
    readFileSync(new URL(`../../engine/fixtures/horizons/${body}.json`, import.meta.url), "utf8"),
  ) as { samples: { jdTdb: number; positionKm: [number, number, number] }[] };
  return new Map(
    parsed.samples.map((s) => [
      s.jdTdb,
      { x: s.positionKm[0] * 1000, y: s.positionKm[1] * 1000, z: s.positionKm[2] * 1000 },
    ]),
  );
}

const longitudeOf = (v: Vec3): number => Math.atan2(v.y, v.x);
const latitudeOf = (v: Vec3): number => Math.asin(v.z / length(v));

describe("the Swift port has not drifted from the engine", () => {
  it("recorded the same model", () => {
    expect(RECORDED.model).toBe(SHORT_SPAN.id);
  });

  it("covers every planet, so a truncated file cannot pass vacuously", () => {
    expect(Object.keys(RECORDED.bodies).sort()).toEqual([...PLANET_IDS].sort());
    for (const body of PLANET_IDS) {
      expect(RECORDED.bodies[body], body).toHaveLength(8);
    }
  });

  it.each(PLANET_IDS)("%s residuals match what SolarKit measured", (body) => {
    const truth = fixturePositions(body);

    for (const row of RECORDED.bodies[body]) {
      const actual = truth.get(row.jdTdb);
      expect(actual, `${body} fixture missing jdTdb ${row.jdTdb}`).toBeDefined();

      const computed = heliocentricState(body, jdTdb(row.jdTdb), SHORT_SPAN).position;
      const longitude =
        Math.abs(normalizeAngleSigned(longitudeOf(computed) - longitudeOf(actual!))) *
        ARCSEC_PER_RADIAN;
      const latitude = Math.abs(latitudeOf(computed) - latitudeOf(actual!)) * ARCSEC_PER_RADIAN;
      const distance = Math.abs(metresToKm(length(computed)) - metresToKm(length(actual!)));

      /**
       * 1e-9 relative. The two languages run the same algorithm over the same float64 inputs,
       * so they should agree to the last few bits; the slack is for the order of operations
       * differing inside a rotation, not for a real disagreement. A genuine port error moves
       * these by orders of magnitude, not by parts per billion.
       */
      const close = (a: number, b: number, what: string) => {
        const scale = Math.max(Math.abs(a), Math.abs(b), 1e-12);
        expect(
          Math.abs(a - b) / scale,
          `${body} @ ${row.epoch} ${what}: TypeScript ${a}, SolarKit ${b}`,
        ).toBeLessThan(1e-9);
      };

      close(longitude, row.longitudeArcsec, "longitude");
      close(latitude, row.latitudeArcsec, "latitude");
      close(distance, row.distanceKm, "distance");
    }
  });
});
