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
import {
  propagate, sampleIntervalFor, trajectoryStateAt, twoBodyModel, type TrajectorySample,
} from "@solar/engine/propagate";
import { totalAngularMomentum, advance } from "@solar/engine/nbody";
import { SECONDS_PER_JULIAN_YEAR } from "@solar/engine/units";
import type { Vec3 } from "@solar/engine/vec";
import { markIntervalFor, orbitTimeMarks } from "@solar/engine/orbit-time";
import { localTimeLabel, solarClock } from "@solar/engine/solar-time";
import {
  engulfedAt, habitableZoneAt, runawayGreenhouseCrossing, solarStateAt,
} from "@solar/engine/deep-time";
import { timeBadge, timeBadgeShort, timeHeadline, timeSense } from "@solar/engine/time-sense";
import {
  ephemerisStandingAt, epochFromUnixTimestamp, unixSecondsFromEpoch,
} from "@solar/engine/when";
import { placeLabels, type LabelInput } from "@solar/engine/labels";
import { levelFor, metresPerPixel, tileExtent, visibleCapAngle } from "./view/core/tiles";

/**
 * The tile pyramid the `tiles` cases were generated against.
 *
 * Spelled out here rather than fetched, because the cases have to be reproducible with no
 * network and no asset pipeline, and because a manifest that drifted would silently change
 * what the cases mean rather than fail. It mirrors `scripts/generate-conformance.mjs`; the
 * numbers are the LRO LOLA pyramid's.
 */
const CONFORMANCE_TILE_MANIFEST = {
  body: "moon",
  tileSize: 512,
  levels: [0, 1, 2, 3].map((level) => ({
    level,
    tilesX: 2 * 2 ** level,
    tilesY: 1 * 2 ** level,
    levelWidth: 1024 * 2 ** level,
    levelHeight: 512 * 2 ** level,
    metresPerTexel: 10_660.552_883_490_052 / 2 ** level,
  })),
  globalNormalMap: "normal-global.jpg",
  globalWidth: 8192,
  referenceRadiusM: 1_737_400,
  elevationRangeM: [-9106, 10_747] as [number, number],
  source: "LRO LOLA",
};

const SUITE = fileURLToPath(new URL("../../contracts/conformance/", import.meta.url));

interface Case {
  readonly id: string;
  readonly input?: Record<string, unknown>;
  readonly expected: unknown;
  /** Optional per-case override, for a case whose domain tolerance is meaningless for it. */
  readonly absoluteTolerance?: number;
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

    /**
     * Integrated trajectories, re-run rather than compared against a stored path.
     *
     * The case carries only the initial condition and the duration, so passing means the
     * integrator arrived at the same endpoint, not that someone copied a number across. The
     * two-body cases close an exact orbit, so their expected endpoint is also the starting
     * one, and any error in the stepper shows up as a gap that nothing else can explain.
     */
    case "propagate": {
      const limits = {
        tolerance: input.tolerance,
        minStepSeconds: 1,
        maxStepSeconds: testCase.id.startsWith("mercury") ? 3_600 : 86_400 * 5,
        maxSteps: 2_000_000,
      };

      if (testCase.id.startsWith("two-body")) {
        const r = input.radiusAu * AU_IN_METRES;
        const result = propagate({
          model: twoBodyModel(),
          initial: { position: { x: r, y: 0, z: 0 }, velocity: { x: 0, y: Math.sqrt(GM_SUN / r), z: 0 } },
          durationSeconds: input.durationSeconds,
          limits,
        });
        const final = result.samples[result.samples.length - 1];
        return { position: final.position, velocity: final.velocity };
      }

      if (testCase.id.startsWith("mercury")) {
        const a = MERCURY.semiMajorAxisMetres;
        const e = MERCURY.eccentricity;
        const period = 2 * Math.PI * Math.sqrt(a ** 3 / GM_SUN);
        const result = propagate({
          model: { centralGm: GM_SUN, perturbers: [], relativistic: input.relativistic },
          initial: {
            position: { x: a * (1 - e), y: 0, z: 0 },
            velocity: { x: 0, y: Math.sqrt((GM_SUN * (1 + e)) / (a * (1 - e))), z: 0 },
          },
          durationSeconds: input.orbits * period,
          limits,
        });
        const final = result.samples[result.samples.length - 1];
        return {
          position: final.position,
          velocity: final.velocity,
          pericentreLongitude: osculatingElements(GM_SUN, final.position, final.velocity)
            .longitudeOfPericentreRad,
        };
      }

      throw new Error(`unhandled propagate case ${testCase.id}`);
    }

    /** The Sun's whole life, and what it does to the habitable zone. */
    case "deep-time": {
      if (testCase.id.startsWith("crossing")) {
        const crossing = runawayGreenhouseCrossing(input.body as BodyId);
        return {
          kind: crossing.kind,
          fromNowGyr: crossing.kind === "crosses" ? crossing.fromNowGyr : null,
        };
      }
      const state = solarStateAt(input.ageGyr);
      const zone = habitableZoneAt(input.ageGyr);
      return {
        phase: state.phase,
        luminosity: state.luminosity,
        radius: state.radius,
        mass: state.mass,
        effectiveTemperatureK: state.effectiveTemperatureK,
        confidence: state.confidence,
        innerAu: zone.innerAu,
        outerAu: zone.outerAu,
        engulfed: ["mercury", "venus", "embary", "mars"].filter((id) =>
          engulfedAt(id as BodyId, input.ageGyr),
        ),
      };
    }

    /** The time at each body's own Greenwich. */
    case "solar-time": {
      const clock = solarClock(input.body as BodyId, jdTdb(input.epoch));
      // Null for the Sun, which has no sub-solar point and therefore no clock.
      if (clock === null) return null;
      return {
        longitudeDeg: clock.subSolar.longitudeDeg,
        latitudeDeg: clock.subSolar.latitudeDeg,
        hours: clock.hours,
        formatted: clock.formatted,
        dayNumber: clock.dayNumber,
        hourInEarthSeconds: clock.hourInEarthSeconds,
        sunRisesInTheWest: clock.sunRisesInTheWest,
        localTime: localTimeLabel(input.body as BodyId, jdTdb(input.epoch)),
        localTimeNewYork: localTimeLabel(input.body as BodyId, jdTdb(input.epoch), {
          offsetMinutes: -300, label: "EST",
        }),
        localTimeIndia: localTimeLabel(input.body as BodyId, jdTdb(input.epoch), {
          offsetMinutes: 330, label: "+05:30",
        }),
      };
    }

    /** Going to a date, and what the tables can honestly say there. */
    case "when": {
      if (testCase.id.startsWith("stamp")) {
        const epoch = epochFromUnixTimestamp(input.value);
        return { epoch, unixSeconds: unixSecondsFromEpoch(epoch) };
      }
      const standing = ephemerisStandingAt(jdTdb(input.epoch));
      return {
        model: standing.model,
        inside: standing.inside,
        year: standing.year,
        note: standing.note,
      };
    }

    /** How long a day, a month and a year are here, and the sentence that explains them. */
    case "time-sense": {
      const t = timeSense(input.body as BodyId);
      return {
        siderealSpinDays: t.siderealSpinDays,
        solarDayDays: t.solarDayDays,
        yearDays: t.yearDays,
        solarDaysPerYear: t.solarDaysPerYear,
        spinsPerYear: t.spinsPerYear,
        tidallyLocked: t.tidallyLocked,
        monthDays: t.monthDays,
        synodicMonthDays: t.synodicMonthDays,
        headline: timeHeadline(input.body as BodyId),
        badge: timeBadge(input.body as BodyId),
        badgeShort: timeBadgeShort(input.body as BodyId),
      };
    }

    /** What a mark on an orbit is worth, and where the marks go. */
    case "orbit-time": {
      if (testCase.id.startsWith("interval")) {
        const interval = markIntervalFor(input.periodDays);
        return {
          seconds: interval.seconds,
          label: interval.label,
          marksPerOrbit: interval.marksPerOrbit,
        };
      }
      const { marks } = orbitTimeMarks(input.periodDays, jdTdb(input.now));
      return {
        count: marks.length,
        secondsFromNow: marks.map((m) => m.secondsFromNow),
        lastEpoch: marks[marks.length - 1].epoch,
      };
    }

    /** Where a body's name is drawn, and where an off-screen pointer aims. */
    case "labels":
      return placeLabels(input.inputs as LabelInput[], {
        viewportWidthPx: input.viewportWidthPx as number,
        viewportHeightPx: input.viewportHeightPx as number,
      }).map((placement) => ({
        id: placement.id,
        x: placement.x,
        y: placement.y,
        clamped: placement.clamped,
        bearingRadians: placement.bearingRadians,
      }));

    /** Recording interval for a propagated path, from the orbit rather than the span. */
    case "sample-cadence":
      return sampleIntervalFor(
        GM_SUN,
        { position: input.position as Vec3, velocity: input.velocity as Vec3 },
        input.durationSeconds as number,
      );

    /** Cubic Hermite placement of an object between integrator samples. */
    case "trajectory-interpolation": {
      const state = trajectoryStateAt(
        input.samples as TrajectorySample[],
        input.seconds as number,
      )!;
      return { position: state.position, velocity: state.velocity };
    }

    /**
     * Mutual gravity over years, with the conserved quantities alongside the state.
     *
     * The drifts are cases rather than loose assertions on purpose. A port whose integrator is
     * subtly worse then shows up as a different number instead of as a pass with more slack,
     * which is the failure mode a tolerance-based energy check always has.
     */
    case "nbody-evolution": {
      const system = solarSystemAt(jdTdb(input.jdTdb));
      const beforeEnergy = totalEnergy(system);
      const beforeAngular = totalAngularMomentum(system);
      advance(system, input.years * SECONDS_PER_JULIAN_YEAR, {
        tolerance: input.tolerance,
        minStepSeconds: 60,
        maxStepSeconds: SECONDS_PER_DAY,
      });
      const afterAngular = totalAngularMomentum(system);
      return {
        state: Array.from(system.state),
        energyDrift: Math.abs((totalEnergy(system) - beforeEnergy) / beforeEnergy),
        angularDrift:
          Math.hypot(
            afterAngular.x - beforeAngular.x,
            afterAngular.y - beforeAngular.y,
            afterAngular.z - beforeAngular.z,
          ) / Math.hypot(beforeAngular.x, beforeAngular.y, beforeAngular.z),
      };
    }

    /** Tile selection, which decides what a viewer actually sees on a surface. */
    case "tiles": {
      if (testCase.id.startsWith("metres-per-pixel")) {
        return metresPerPixel(input.altitudeM, input.verticalFovRadians, input.viewportHeightPx);
      }
      if (testCase.id.startsWith("level-for")) {
        return levelFor(
          CONFORMANCE_TILE_MANIFEST,
          input.altitudeM,
          input.verticalFovRadians,
          input.viewportHeightPx,
        ).level;
      }
      if (testCase.id.startsWith("visible-cap")) {
        return visibleCapAngle(input.radiusM, input.altitudeM);
      }
      const level = CONFORMANCE_TILE_MANIFEST.levels[input.level];
      const extent = tileExtent(level, { level: input.level, x: input.x, y: input.y });
      return {
        phiStart: extent.phiStart,
        phiLength: extent.phiLength,
        thetaStart: extent.thetaStart,
        thetaLength: extent.thetaLength,
      };
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
          // A case may widen its own absolute term where the domain's is meaningless for
          // it, which is how a near-zero component of a huge vector is handled.
          { relative: domain.tolerance, absolute: testCase.absoluteTolerance ?? domain.absoluteTolerance },
          `${name}/${testCase.id}`,
        );
      }
    });
  },
);
