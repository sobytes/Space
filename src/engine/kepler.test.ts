/**
 * The ephemeris gate.
 *
 * Compares `heliocentricState` against 64 real JPL Horizons state vectors (8 bodies, 8 epochs
 * from 1800 to 2050, Sun-centred, ecliptic of J2000, KM-S) in the three quantities JPL
 * publishes error bars for: heliocentric longitude, heliocentric latitude, and radial
 * distance. The tolerance is `SHORT_SPAN.quotedError`, which is JPL's own accuracy table, so
 * a pass means "inside what JPL promises for these elements" rather than "inside a number
 * that made the test pass".
 *
 * The fixtures carry `jdTdb` directly and it is used directly, which keeps the leap-second
 * table out of this gate.
 */

import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { PLANET_IDS, SHORT_SPAN, modelForYear, type PlanetId } from "./data/planets";
import { heliocentricPosition, heliocentricState } from "./kepler";
import { approximateJulianYear, jdTdb, type JdTdb } from "./time";
import { metresToKm, normalizeAngleSigned } from "./units";
import { length, sub, vec3, type Vec3 } from "./vec";

const ARCSEC_PER_RADIAN = 648_000 / Math.PI;
const KM_TO_M = 1000;

interface HorizonsSample {
  readonly body: PlanetId;
  readonly epoch: string;
  readonly jdTdb: JdTdb;
  readonly position: Vec3;
  readonly velocity: Vec3;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function requireNumber(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${where}: expected a finite number, got ${JSON.stringify(value)}`);
  }
  return value;
}

function requireString(value: unknown, where: string): string {
  if (typeof value !== "string") {
    throw new Error(`${where}: expected a string, got ${JSON.stringify(value)}`);
  }
  return value;
}

function requireScaledTriple(value: unknown, scale: number, where: string): Vec3 {
  if (!isUnknownArray(value) || value.length !== 3) {
    throw new Error(`${where}: expected a 3-element array, got ${JSON.stringify(value)}`);
  }
  return vec3(
    requireNumber(value[0], `${where}[0]`) * scale,
    requireNumber(value[1], `${where}[1]`) * scale,
    requireNumber(value[2], `${where}[2]`) * scale,
  );
}

function loadFixture(body: PlanetId): readonly HorizonsSample[] {
  const path = new URL(`../../fixtures/horizons/${body}.json`, import.meta.url);
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(parsed)) throw new Error(`${body}.json: expected an object at the root`);
  if (parsed.body !== body) {
    throw new Error(`${body}.json: declares body ${JSON.stringify(parsed.body)}`);
  }
  if (!isUnknownArray(parsed.samples) || parsed.samples.length === 0) {
    throw new Error(`${body}.json: expected a non-empty samples array`);
  }
  return parsed.samples.map((raw, index) => {
    const where = `${body}.json samples[${index}]`;
    if (!isRecord(raw)) throw new Error(`${where}: expected an object`);
    return {
      body,
      epoch: requireString(raw.epoch, `${where}.epoch`),
      jdTdb: jdTdb(requireNumber(raw.jdTdb, `${where}.jdTdb`)),
      position: requireScaledTriple(raw.positionKm, KM_TO_M, `${where}.positionKm`),
      velocity: requireScaledTriple(raw.velocityKmS, KM_TO_M, `${where}.velocityKmS`),
    };
  });
}

const eclipticLongitude = (v: Vec3): number => Math.atan2(v.y, v.x);
const eclipticLatitude = (v: Vec3): number => Math.asin(v.z / length(v));

interface SampleError {
  readonly sample: HorizonsSample;
  readonly longitudeArcsec: number;
  readonly latitudeArcsec: number;
  readonly distanceKm: number;
  readonly velocityErrorMPerS: number;
}

function measure(sample: HorizonsSample): SampleError {
  const computed = heliocentricState(sample.body, sample.jdTdb, SHORT_SPAN);
  return {
    sample,
    longitudeArcsec:
      Math.abs(
        normalizeAngleSigned(
          eclipticLongitude(computed.position) - eclipticLongitude(sample.position),
        ),
      ) * ARCSEC_PER_RADIAN,
    latitudeArcsec:
      Math.abs(eclipticLatitude(computed.position) - eclipticLatitude(sample.position)) *
      ARCSEC_PER_RADIAN,
    distanceKm: Math.abs(
      metresToKm(length(computed.position)) - metresToKm(length(sample.position)),
    ),
    velocityErrorMPerS: length(sub(computed.velocity, sample.velocity)),
  };
}

const measureFixture = (body: PlanetId): readonly SampleError[] =>
  loadFixture(body).map(measure);

/** Spelled out per body so the compiler, not a cast, proves every `PlanetId` is covered. */
const MEASUREMENTS: Readonly<Record<PlanetId, readonly SampleError[]>> = {
  mercury: measureFixture("mercury"),
  venus: measureFixture("venus"),
  embary: measureFixture("embary"),
  mars: measureFixture("mars"),
  jupiter: measureFixture("jupiter"),
  saturn: measureFixture("saturn"),
  uranus: measureFixture("uranus"),
  neptune: measureFixture("neptune"),
};

const percentOfAllowance = (actual: number, allowed: number): string =>
  `${((100 * actual) / allowed).toFixed(1)}%`;

describe("Standish Keplerian ephemeris versus JPL Horizons", () => {
  beforeAll(() => {
    const perSample: Record<string, unknown>[] = [];
    const worstCase: Record<string, unknown>[] = [];

    for (const body of PLANET_IDS) {
      const allowed = SHORT_SPAN.quotedError[body];
      const errors = MEASUREMENTS[body];
      let worst = 0;
      let worstEpoch = "";
      let worstQuantity = "";

      for (const error of errors) {
        const shares: readonly (readonly [string, number])[] = [
          ["longitude", error.longitudeArcsec / allowed.longitude],
          ["latitude", error.latitudeArcsec / allowed.latitude],
          ["distance", error.distanceKm / allowed.distanceKm],
        ];
        for (const [quantity, share] of shares) {
          if (share > worst) {
            worst = share;
            worstEpoch = error.sample.epoch;
            worstQuantity = quantity;
          }
        }
        perSample.push({
          body,
          epoch: error.sample.epoch,
          'lon ("")': error.longitudeArcsec.toFixed(2),
          "lon used": percentOfAllowance(error.longitudeArcsec, allowed.longitude),
          'lat ("")': error.latitudeArcsec.toFixed(2),
          "lat used": percentOfAllowance(error.latitudeArcsec, allowed.latitude),
          "dist (km)": error.distanceKm.toFixed(0),
          "dist used": percentOfAllowance(error.distanceKm, allowed.distanceKm),
          "vel (m/s)": error.velocityErrorMPerS.toFixed(3),
        });
      }

      worstCase.push({
        body,
        'allowed lon ("")': allowed.longitude,
        'allowed lat ("")': allowed.latitude,
        "allowed dist (km)": allowed.distanceKm,
        "worst share of allowance": `${(100 * worst).toFixed(1)}%`,
        "worst quantity": worstQuantity,
        "worst epoch": worstEpoch,
      });
    }

    console.table(perSample);
    console.table(worstCase);
  });

  it.each(PLANET_IDS)("%s stays inside JPL's quoted error at every epoch", (body) => {
    const allowed = SHORT_SPAN.quotedError[body];
    const errors = MEASUREMENTS[body];
    expect(errors).toHaveLength(8);

    for (const error of errors) {
      const at = `${body} @ ${error.sample.epoch}`;
      expect(error.longitudeArcsec, `${at} longitude`).toBeLessThanOrEqual(allowed.longitude);
      expect(error.latitudeArcsec, `${at} latitude`).toBeLessThanOrEqual(allowed.latitude);
      expect(error.distanceKm, `${at} distance`).toBeLessThanOrEqual(allowed.distanceKm);
    }
  });

  it("selects the short-span model by default at every fixture epoch", () => {
    for (const body of PLANET_IDS) {
      for (const { sample } of MEASUREMENTS[body]) {
        expect(modelForYear(approximateJulianYear(sample.jdTdb)).id, sample.epoch).toBe(
          "short-span",
        );
      }
    }
  });
});

describe("analytic velocity", () => {
  /**
   * A central difference over 0.01 d has a truncation error near 1e-7 relative for Mercury,
   * the fastest body here, and far less for the rest. Agreement to 1e-6 therefore pins the
   * hand-derived rotation and element-drift derivatives without pinning round-off.
   *
   * The model is pinned rather than left to `modelForYear`, because the 2050-01-01 fixture
   * sits exactly on the short-span window's edge and the step after it lands in the long-span
   * table. Differentiating across that seam would compare two different functions.
   */
  const STEP_DAYS = 0.01;

  it.each(PLANET_IDS)("%s matches a central difference of the position function", (body) => {
    for (const { sample } of MEASUREMENTS[body]) {
      const before = heliocentricPosition(body, jdTdb(sample.jdTdb - STEP_DAYS), SHORT_SPAN);
      const after = heliocentricPosition(body, jdTdb(sample.jdTdb + STEP_DAYS), SHORT_SPAN);
      const seconds = 2 * STEP_DAYS * 86_400;
      const numerical = vec3(
        (after.x - before.x) / seconds,
        (after.y - before.y) / seconds,
        (after.z - before.z) / seconds,
      );
      const analytic = heliocentricState(body, sample.jdTdb, SHORT_SPAN).velocity;
      const relative = length(sub(analytic, numerical)) / length(numerical);
      expect(relative, `${body} @ ${sample.epoch} velocity derivative`).toBeLessThan(1e-6);
    }
  });
});
