/**
 * The engine side of the cross-platform conformance suite.
 *
 * `contracts/conformance/*.json` holds one set of cases that every client runs. The engine is
 * the reference, so these cases were generated from it, and this checks it still reproduces
 * them. That is not circular: the cases are committed, so a change to the engine that alters
 * an answer turns this red and has to be acknowledged by regenerating, which is exactly the
 * moment every port needs telling.
 *
 * `mobile/ios/SolarKit/Tests/SolarKitTests/ConformanceTests.swift` runs the identical file.
 * Two implementations, one set of expected answers, no agreed snapshot format between them.
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { heliocentricState, solveEccentricAnomaly } from "@solar/engine/kepler";
import { osculatingElements } from "@solar/engine/elements";
import { heliocentricPositionOf } from "@solar/engine/bodies/position";
import { obliquityToOrbitDeg, orientationOf, rotationPeriodDays } from "@solar/engine/rotation";
import { SHORT_SPAN, type PlanetId } from "@solar/engine/data/planets";
import type { BodyId } from "@solar/engine/bodies/registry";
import {
  jdTdb, jdTt, jdUtc, julianCenturiesSinceJ2000, taiMinusUtcSeconds, tdbFromTt, ttFromUtc,
} from "@solar/engine/time";
import {
  AU_IN_METRES, DAYS_PER_JULIAN_CENTURY, DAYS_PER_JULIAN_YEAR, GM_SUN, SECONDS_PER_DAY,
  SPEED_OF_LIGHT_M_S, au, deg, km, normalizeAngleSigned, toMetresFromAu, toMetresFromKm,
  toRadians,
} from "@solar/engine/units";
import {
  MERCURY, perihelionAdvancePerOrbit, postNewtonianAcceleration,
} from "@solar/engine/relativity";
import { accelerations, solarSystemAt, totalEnergy } from "@solar/engine/nbody";
import { leadingOrderPericentreRate, secularPericentreRate } from "@solar/engine/secular";
import { impactEnergy } from "@solar/engine/scenarios/asteroid";
import { ascentBudget, earthRotationBonus, maximumPayload, siteById } from "@solar/engine/launch/ascent";
import { ATLAS_V_401 } from "@solar/engine/launch/vehicles";

const SUITE = fileURLToPath(new URL("../../contracts/conformance/", import.meta.url));

interface Case {
  readonly id: string;
  readonly input?: Record<string, unknown>;
  readonly expected: unknown;
}
interface Domain {
  readonly domain: string;
  readonly description: string;
  /** Relative tolerance, for quantities of ordinary magnitude. */
  readonly tolerance: number;
  /** Absolute floor, for quantities near zero where a relative test means nothing. */
  readonly absoluteTolerance: number;
  readonly cases: readonly Case[];
}

interface Tolerance { readonly relative: number; readonly absolute: number }

const load = (name: string): Domain =>
  JSON.parse(readFileSync(join(SUITE, `${name}.json`), "utf8")) as Domain;

const index = JSON.parse(readFileSync(join(SUITE, "index.json"), "utf8")) as {
  domains: string[];
  totalCases: number;
};

/** Runs one case and returns what the engine produced for it. */
function compute(domain: string, testCase: Case): unknown {
  const input = (testCase.input ?? {}) as Record<string, number & string & number[]>;

  switch (domain) {
    case "units":
      switch (testCase.id) {
        case "au-in-metres": return AU_IN_METRES;
        case "gm-sun": return GM_SUN;
        case "seconds-per-day": return SECONDS_PER_DAY;
        case "days-per-julian-century": return DAYS_PER_JULIAN_CENTURY;
        case "days-per-julian-year": return DAYS_PER_JULIAN_YEAR;
        case "speed-of-light": return SPEED_OF_LIGHT_M_S;
        case "km-to-metres": return toMetresFromKm(km(input.km));
        case "au-to-metres": return toMetresFromAu(au(input.au));
        case "degrees-to-radians": return toRadians(deg(input.deg));
        default: return normalizeAngleSigned(input.radians);
      }

    case "time":
      if (testCase.id.startsWith("tai-minus-utc")) return taiMinusUtcSeconds(jdUtc(input.jdUtc));
      if (testCase.id.startsWith("tt-from-utc")) return ttFromUtc(jdUtc(input.jdUtc));
      if (testCase.id.startsWith("tdb-from-tt")) return tdbFromTt(jdTt(input.jdTt));
      return julianCenturiesSinceJ2000(jdTdb(input.jdTdb));

    case "kepler":
      if (testCase.id.startsWith("eccentric-anomaly")) {
        return solveEccentricAnomaly(input.meanAnomaly, input.eccentricity);
      }
      return heliocentricState(input.planet as PlanetId, jdTdb(input.jdTdb), SHORT_SPAN);

    case "position":
      return heliocentricPositionOf(input.body as BodyId, jdTdb(input.jdTdb));

    case "rotation": {
      const body = input.body as BodyId;
      if (testCase.id.startsWith("period")) return rotationPeriodDays(body);
      const o = orientationOf(body, jdTdb(input.jdTdb));
      return {
        pole: o.poleEcliptic,
        spin: o.spin,
        tilt: o.tilt,
        obliquityToOrbitDeg: obliquityToOrbitDeg(body, jdTdb(input.jdTdb)),
      };
    }

    case "elements": {
      const state = heliocentricState(input.planet as PlanetId, jdTdb(input.jdTdb), SHORT_SPAN);
      return osculatingElements(input.gm, state.position, state.velocity);
    }

    case "relativity":
      if (testCase.id === "mercury-semi-major-axis") return MERCURY.semiMajorAxisMetres;
      if (testCase.id === "mercury-eccentricity") return MERCURY.eccentricity;
      if (testCase.id === "mercury-orbital-period-days") return MERCURY.orbitalPeriodDays;
      if (testCase.id === "mercury-advance-per-orbit") {
        return perihelionAdvancePerOrbit(input.gm, input.semiMajorAxisM, input.eccentricity);
      }
      return postNewtonianAcceleration(
        input.gm,
        input.position as unknown as { x: number; y: number; z: number },
        input.velocity as unknown as { x: number; y: number; z: number },
      );

    case "nbody":
      if (testCase.id === "two-body-acceleration") {
        const out = new Float64Array(6);
        accelerations(
          new Float64Array(input.gm as unknown as number[]),
          new Float64Array(input.state as unknown as number[]),
          out,
        );
        return Array.from(out);
      } else {
        const system = solarSystemAt(jdTdb(input.jdTdb));
        return {
          ids: [...system.ids],
          state: Array.from(system.state),
          totalEnergy: totalEnergy(system),
        };
      }

    case "secular": {
      const config = {
        semiMajorAxisM: input.semiMajorAxisM,
        eccentricity: input.eccentricity,
        gm: input.gm,
        perturberGm: input.perturberGm,
        perturberSemiMajorAxisM: input.perturberSemiMajorAxisM,
      };
      return testCase.id.startsWith("quadrature")
        ? secularPericentreRate(config, input.samples)
        : leadingOrderPericentreRate(config);
    }

    case "asteroid": {
      const e = impactEnergy(input.diameterM, input.densityKgM3, input.speedMS);
      return {
        massKg: e.massKg,
        energyJoules: e.energyJoules,
        energyMegatonsTnt: e.energyMegatonsTnt,
      };
    }

    case "ascent": {
      if (testCase.id.startsWith("rotation-bonus")) {
        return earthRotationBonus(siteById(input.site), input.inclinationDeg);
      }
      const target = {
        altitudeKm: input.altitudeKm,
        inclinationDeg: input.inclinationDeg,
        site: siteById(input.site),
      };
      if (testCase.id.startsWith("budget")) {
        const budget = ascentBudget(target);
        return {
          circularSpeedMS: budget.circularSpeedMS,
          potentialMS: budget.potentialMS,
          earthRotationMS: budget.earthRotationMS,
          requiredMS: budget.requiredMS,
        };
      }
      return maximumPayload(ATLAS_V_401, target).payloadKg;
    }

    default:
      throw new Error(`no runner for domain "${domain}"`);
  }
}

/**
 * Compares a produced value against an expected one.
 *
 * `|a - b| <= relative * |expected| + absolute`. The absolute term is not slack: it is what
 * makes the test meaningful for a quantity near zero, where a relative error of one part in
 * 1e11 can be a last-bit difference amplified by an ill-conditioned function. The domains
 * that set a non-trivial absolute tolerance say why in the generator.
 */
function check(
  actual: unknown, expected: unknown, tol: Tolerance, where: string,
): void {
  if (typeof expected === "number") {
    expect(typeof actual, `${where} should be a number`).toBe("number");
    const allowed = tol.relative * Math.abs(expected) + tol.absolute;
    const error = Math.abs((actual as number) - expected);
    expect(
      error,
      `${where}: expected ${expected}, got ${actual} (allowed ${allowed})`,
    ).toBeLessThanOrEqual(allowed);
    return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), `${where} should be an array`).toBe(true);
    const got = actual as unknown[];
    expect(got.length, `${where} length`).toBe(expected.length);
    expected.forEach((value, i) => check(got[i], value, tol, `${where}[${i}]`));
    return;
  }
  if (expected !== null && typeof expected === "object") {
    for (const [key, value] of Object.entries(expected)) {
      check((actual as Record<string, unknown>)[key], value, tol, `${where}.${key}`);
    }
    return;
  }
  expect(actual, where).toEqual(expected);
}

describe("the conformance suite is intact", () => {
  it("has every domain the index declares, and the case count matches", () => {
    const files = readdirSync(SUITE).filter((f) => f.endsWith(".json") && f !== "index.json");
    expect(files.map((f) => f.replace(".json", "")).sort()).toEqual([...index.domains].sort());

    const counted = index.domains.reduce((sum, name) => sum + load(name).cases.length, 0);
    expect(counted, "index.totalCases is stale; regenerate the suite").toBe(index.totalCases);
    // A suite that shrank to nothing would pass every assertion it owns.
    expect(index.totalCases).toBeGreaterThan(400);
  });

  it("gives every domain a description, a tolerance and unique case ids", () => {
    for (const name of index.domains) {
      const domain = load(name);
      expect(domain.description.length, `${name} description`).toBeGreaterThan(20);
      expect(domain.tolerance, `${name} tolerance`).toBeGreaterThanOrEqual(0);
      expect(domain.absoluteTolerance, `${name} absoluteTolerance`).toBeGreaterThanOrEqual(0);
      expect(domain.cases.length, `${name} has no cases`).toBeGreaterThan(0);
      const ids = domain.cases.map((c) => c.id);
      expect(new Set(ids).size, `${name} has duplicate case ids`).toBe(ids.length);
    }
  });
});

describe.each(JSON.parse(readFileSync(join(SUITE, "index.json"), "utf8")).domains as string[])(
  "conformance: %s",
  (name) => {
    const domain = load(name);
    it(`reproduces all ${domain.cases.length} cases`, () => {
      for (const testCase of domain.cases) {
        check(
          compute(name, testCase),
          testCase.expected,
          { relative: domain.tolerance, absolute: domain.absoluteTolerance },
          `${name}/${testCase.id}`,
        );
      }
    });
  },
);
