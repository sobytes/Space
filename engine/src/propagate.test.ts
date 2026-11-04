/**
 * The propagator is gated against cases with exact answers.
 *
 * A numerical integrator always returns a trajectory. It returns one when it is right and it
 * returns one when it is wrong, and the two look identical on screen. So every check here is
 * against something analytically known: a closed orbit must close, a two-body orbit must hold
 * its energy and eccentricity, an unbound orbit must be recognised as unbound, and the
 * relativistic term must reproduce the perihelion advance the closed form already predicts.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS, eccentricityOf, propagate, sampleIntervalFor, specificAngularMomentum, specificEnergy, trajectoryStateAt, twoBodyModel, type Perturber, type TrajectorySample } from "./propagate";
import {
  MERCURY,
  perihelionAdvanceArcsecPerCentury,
} from "./relativity";
import { GM_SUN } from "./units";
import { length, sub, type Vec3 } from "./vec";

const AU = 149_597_870_700;

/** Period of a closed orbit about the central mass, seconds. */
function periodOf(semiMajorAxis: number, gm = GM_SUN): number {
  return 2 * Math.PI * Math.sqrt(semiMajorAxis ** 3 / gm);
}

/** State at perihelion, in the xy plane, moving anticlockwise. */
function atPerihelion(semiMajorAxis: number, eccentricity: number, gm = GM_SUN) {
  return {
    position: { x: semiMajorAxis * (1 - eccentricity), y: 0, z: 0 } satisfies Vec3,
    velocity: {
      x: 0,
      y: Math.sqrt((gm / semiMajorAxis) * ((1 + eccentricity) / (1 - eccentricity))),
      z: 0,
    } satisfies Vec3,
  };
}

describe("two-body cases with exact answers", () => {
  it.each([
    ["circular", 1.0 * AU, 0.0],
    ["Earth-like", 1.0 * AU, 0.0167],
    ["Mars-crossing", 1.5 * AU, 0.3],
    ["highly eccentric", 2.5 * AU, 0.75],
  ])("%s orbit returns to its start after exactly one period", (_label, a, e) => {
    const initial = atPerihelion(a, e);
    const period = periodOf(a);

    const result = propagate({
      model: twoBodyModel(),
      initial,
      durationSeconds: period,
      limits: { ...DEFAULT_LIMITS, tolerance: 1e-12 },
    });

    const final = result.samples[result.samples.length - 1];
    const positionError = length(sub(final.position, initial.position));
    const relativeError = positionError / length(initial.position);

    // A closed orbit that does not close is an integrator that is lying.
    expect(relativeError, `closure error after one period`).toBeLessThan(1e-9);
  });

  it("holds energy and eccentricity over 200 orbits, and reports the drift", () => {
    const a = 1.5 * AU;
    const e = 0.3;
    const initial = atPerihelion(a, e);
    const orbits = 200;

    const startEnergy = specificEnergy(GM_SUN, initial.position, initial.velocity);
    const startMomentum = length(specificAngularMomentum(initial.position, initial.velocity));
    const startEccentricity = eccentricityOf(GM_SUN, initial.position, initial.velocity);

    const result = propagate({
      model: twoBodyModel(),
      initial,
      durationSeconds: periodOf(a) * orbits,
      limits: { ...DEFAULT_LIMITS, tolerance: 1e-12 },
    });

    const final = result.samples[result.samples.length - 1];
    const energyDrift = Math.abs(
      (specificEnergy(GM_SUN, final.position, final.velocity) - startEnergy) / startEnergy,
    );
    const momentumDrift = Math.abs(
      (length(specificAngularMomentum(final.position, final.velocity)) - startMomentum) /
        startMomentum,
    );
    const eccentricityDrift = Math.abs(
      eccentricityOf(GM_SUN, final.position, final.velocity) - startEccentricity,
    );

    console.table([
      { quantity: "orbits", value: orbits },
      { quantity: "accepted steps", value: result.steps },
      { quantity: "rejected steps", value: result.rejectedSteps },
      { quantity: "relative energy drift", value: energyDrift.toExponential(3) },
      { quantity: "relative angular momentum drift", value: momentumDrift.toExponential(3) },
      { quantity: "absolute eccentricity drift", value: eccentricityDrift.toExponential(3) },
    ]);

    /**
     * These bounds come from the measurement, not from a wish. Dormand-Prince is not
     * symplectic, so some secular energy drift is inherent and asserting zero would be
     * asserting something the method cannot deliver.
     *
     * Measured over 200 orbits of a 1.5 au body, which is about 370 years: relative energy
     * drift 4.7e-10, angular momentum 2.3e-10, eccentricity 1.2e-11. In physical terms the
     * energy figure is a semi-major axis wandering by about 105 m over those 370 years,
     * which is far below the error already present in the planetary positions feeding the
     * force model. The bounds sit at about twice the measured values, so a real regression
     * in the integrator trips them while run-to-run variation does not.
     */
    expect(energyDrift, "energy drift over 200 orbits").toBeLessThan(1e-9);
    expect(momentumDrift, "angular momentum drift").toBeLessThan(5e-10);
    expect(eccentricityDrift, "eccentricity drift").toBeLessThan(1e-10);
  });
});

describe("fate classification", () => {
  it("recognises an unbound orbit as escaped", () => {
    const r = 1 * AU;
    const escapeSpeed = Math.sqrt((2 * GM_SUN) / r);

    const result = propagate({
      model: twoBodyModel(),
      initial: { position: { x: r, y: 0, z: 0 }, velocity: { x: 0, y: escapeSpeed * 1.4, z: 0 } },
      durationSeconds: 86_400 * 365.25 * 400,
    });

    expect(result.fate.kind).toBe("escaped");
    if (result.fate.kind === "escaped") {
      expect(result.fate.eccentricity).toBeGreaterThan(1);
    }
  });

  it("keeps a bound orbit bound", () => {
    const result = propagate({
      model: twoBodyModel(),
      initial: atPerihelion(2 * AU, 0.4),
      durationSeconds: periodOf(2 * AU) * 5,
    });
    expect(result.fate.kind).toBe("propagating");
  });

  it("detects an impact on a perturber with a real radius", () => {
    // A body dropped from rest at 1 au falls straight into a target placed at the origin's
    // side. The target carries Earth's gm and radius so the geometry is physical.
    const target: Perturber = {
      id: "earth",
      gm: 3.986_004_418e14,
      radiusM: 6_378_137,
      positionAt: () => ({ x: 0.5 * AU, y: 0, z: 0 }),
    };

    const result = propagate({
      model: { centralGm: 0, perturbers: [target], relativistic: false },
      initial: { position: { x: 0.5 * AU + 1e9, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } },
      durationSeconds: 86_400 * 400,
      closeApproachThresholdM: 1e10,
    });

    expect(result.fate.kind, JSON.stringify(result.fate)).toBe("impact");
    if (result.fate.kind === "impact") expect(result.fate.body).toBe("earth");
  });
});

describe("the relativistic term, cross-checked against the closed form", () => {
  /**
   * Links this integrator to a result already verified elsewhere. The perihelion advance it
   * produces must match the closed form in `relativity.ts`, which `demonstrations` already
   * gates against Einstein's published 42.98 arcseconds per century.
   */
  it("reproduces Mercury's perihelion advance to within a percent", () => {
    const { semiMajorAxisMetres: a, eccentricity: e } = MERCURY;
    const initial = atPerihelion(a, e, GM_SUN);
    const orbits = 300;
    const duration = periodOf(a) * orbits;

    const run = (relativistic: boolean) =>
      propagate({
        model: { centralGm: GM_SUN, perturbers: [], relativistic },
        initial,
        durationSeconds: duration,
        limits: { ...DEFAULT_LIMITS, tolerance: 1e-13 },
      }).samples.at(-1)!;

    // Differential again: the apsidal direction is read from the eccentricity vector, and the
    // Newtonian arm's own numerical drift is subtracted from the relativistic arm's.
    const apsidalAngle = (s: { position: Vec3; velocity: Vec3 }) => {
      const r = length(s.position);
      const v2 = s.velocity.x ** 2 + s.velocity.y ** 2 + s.velocity.z ** 2;
      const rv = s.position.x * s.velocity.x + s.position.y * s.velocity.y;
      const ex = ((v2 - GM_SUN / r) * s.position.x - rv * s.velocity.x) / GM_SUN;
      const ey = ((v2 - GM_SUN / r) * s.position.y - rv * s.velocity.y) / GM_SUN;
      return Math.atan2(ey, ex);
    };

    const newtonian = apsidalAngle(run(false));
    const relativistic = apsidalAngle(run(true));

    let advance = relativistic - newtonian;
    if (advance > Math.PI) advance -= 2 * Math.PI;
    if (advance < -Math.PI) advance += 2 * Math.PI;

    const centuries = duration / (86_400 * 36_525);
    const measured = (advance * (648_000 / Math.PI)) / centuries;
    const expected = perihelionAdvanceArcsecPerCentury(
      GM_SUN,
      a,
      e,
      MERCURY.orbitalPeriodDays,
    );

    console.log(
      `  perihelion advance: measured ${measured.toFixed(3)}"/century, ` +
        `closed form ${expected.toFixed(3)}"/century, ` +
        `error ${(((measured - expected) / expected) * 100).toFixed(2)}%`,
    );

    expect(Math.abs(measured - expected) / expected).toBeLessThan(0.01);
  });
});

describe("trajectoryStateAt", () => {
  const samples: TrajectorySample[] = [
    { t: 0, position: { x: 0, y: 0, z: 0 }, velocity: { x: 1, y: 0, z: 0 } },
    { t: 10, position: { x: 10, y: 0, z: 0 }, velocity: { x: 1, y: 0, z: 0 } },
    { t: 20, position: { x: 20, y: 0, z: 0 }, velocity: { x: 1, y: 0, z: 0 } },
  ];

  it("returns the sample exactly at a sample time", () => {
    for (const sample of samples) {
      const got = trajectoryStateAt(samples, sample.t)!;
      expect(got.position.x).toBeCloseTo(sample.position.x, 12);
      expect(got.velocity.x).toBeCloseTo(sample.velocity.x, 12);
    }
  });

  it("clamps rather than extrapolating outside the span", () => {
    expect(trajectoryStateAt(samples, -1e9)!.position.x).toBe(0);
    expect(trajectoryStateAt(samples, 1e9)!.position.x).toBe(20);
  });

  /**
   * Constant velocity must interpolate to a straight line.
   *
   * A Hermite blend with consistent endpoints reduces to the linear case exactly, so any
   * algebra error in the basis functions shows up here as a curve through a straight path.
   */
  it("reproduces uniform motion exactly", () => {
    for (const t of [1, 2.5, 7, 13.75, 19]) {
      const got = trajectoryStateAt(samples, t)!;
      expect(got.position.x).toBeCloseTo(t, 9);
      expect(got.velocity.x).toBeCloseTo(1, 9);
    }
  });

  /**
   * The interpolated velocity must be the derivative of the interpolated position.
   *
   * Interpolating the two independently is the obvious shortcut and produces a rider whose
   * reported speed disagrees with how fast it is visibly moving. Checked numerically, so the
   * basis functions and their derivatives cannot drift apart.
   */
  it("reports a velocity that is the derivative of the position it reports", () => {
    const curved: TrajectorySample[] = [
      { t: 0, position: { x: 0, y: 0, z: 0 }, velocity: { x: 1, y: 2, z: 0 } },
      { t: 10, position: { x: 30, y: -5, z: 4 }, velocity: { x: 4, y: -1, z: 1 } },
    ];
    const t = 6.3;
    const d = 1e-5;
    const at = trajectoryStateAt(curved, t)!;
    const ahead = trajectoryStateAt(curved, t + d)!;
    const behind = trajectoryStateAt(curved, t - d)!;
    for (const axis of ["x", "y", "z"] as const) {
      const numeric = (ahead.position[axis] - behind.position[axis]) / (2 * d);
      expect(at.velocity[axis]).toBeCloseTo(numeric, 6);
    }
  });

  it("returns nothing for an empty trajectory", () => {
    expect(trajectoryStateAt([], 0)).toBeNull();
  });
});

describe("sampleIntervalFor", () => {
  const AU = 149_597_870_700;
  const GM = 1.327_124_400_41e20;
  const circular = (auRadius: number) => {
    const r = auRadius * AU;
    return {
      position: { x: r, y: 0, z: 0 },
      velocity: { x: 0, y: Math.sqrt(GM / r), z: 0 },
    };
  };
  const periodOf = (auRadius: number) => 2 * Math.PI * Math.sqrt((auRadius * AU) ** 3 / GM);

  /**
   * The resolution per orbit must not depend on how long the run is.
   *
   * This is the whole point of the function and the exact thing the fixed-count version got
   * wrong: a one-au orbit was drawn with 300 points per turn over two years and 12 over fifty,
   * on the same physics. Twelve is a dodecagon, and fifty overlapping dodecagons is what got
   * reported from the phone as a path that did not look right.
   */
  it.each([2, 10, 50])("holds the points per orbit steady over %i years", (years) => {
    const seconds = years * 365.25 * 86_400;
    const interval = sampleIntervalFor(GM, circular(1), seconds);
    expect(periodOf(1) / interval).toBeCloseTo(180, 0);
  });

  it("gives the same resolution to a tight orbit as to a wide one", () => {
    const seconds = 10 * 365.25 * 86_400;
    for (const auRadius of [0.4, 1, 5.2]) {
      const interval = sampleIntervalFor(GM, circular(auRadius), seconds);
      expect(periodOf(auRadius) / interval).toBeCloseTo(180, 0);
    }
  });

  /**
   * The sample cap degrades the path rather than exhausting memory.
   *
   * A Mercury-like orbit at 0.39 au turns 4,100 times in a thousand years and would want
   * three quarters of a million points at the target resolution. Capped at 40,000 it gets 9.7
   * per orbit, which is coarse, and that is the correct trade: the cap is a memory bound, not
   * a quality target, and it has to bite somewhere.
   *
   * The span that matters is the one the interface offers, which is 200 years. There the same
   * orbit still gets 49 points per turn, so the cap never reaches the paths anyone draws.
   */
  it("caps the total and degrades proportionally rather than refusing", () => {
    const thousand = 1_000 * 365.25 * 86_400;
    const capped = sampleIntervalFor(GM, circular(0.39), thousand, { maxSamples: 40_000 });
    expect(thousand / capped).toBeLessThanOrEqual(40_001);
    expect(periodOf(0.39) / capped).toBeGreaterThan(9);

    const longest = 200 * 365.25 * 86_400;
    const interval = sampleIntervalFor(GM, circular(0.39), longest, { maxSamples: 40_000 });
    expect(periodOf(0.39) / interval).toBeGreaterThan(40);
  });

  /** An unbound orbit has no period to divide, and one swing needs no turns budget. */
  it("falls back to a fixed count for an escape trajectory", () => {
    const r = AU;
    const escape = {
      position: { x: r, y: 0, z: 0 },
      velocity: { x: 0, y: 2 * Math.sqrt(GM / r), z: 0 },
    };
    const seconds = 10 * 365.25 * 86_400;
    expect(sampleIntervalFor(GM, escape, seconds)).toBeCloseTo(seconds / 2_000, 0);
  });
});

describe("the final sample", () => {
  /**
   * A propagation must report where it actually ended up.
   *
   * The loop only recorded a sample when the clock crossed a sample boundary, so the last one
   * could be a whole interval short of the requested duration: eighteen days missing from a
   * fifty-year run. The final step is already clamped to land exactly on the duration, so the
   * exact endpoint was being computed and discarded.
   */
  it("lands exactly on the requested duration", () => {
    const r = 149_597_870_700;
    const gm = 1.327_124_400_41e20;
    const duration = 3.7 * 365.25 * 86_400;
    const result = propagate({
      model: twoBodyModel(),
      initial: {
        position: { x: r, y: 0, z: 0 },
        velocity: { x: 0, y: Math.sqrt(gm / r), z: 0 },
      },
      durationSeconds: duration,
      /**
       * Coarse, and deliberately not a divisor of the duration.
       *
       * This is what makes the test bite. An interval that divides evenly puts the last
       * boundary exactly on the endpoint, so the loop records it on the way past and the bug
       * is invisible. The old fixed-count sampling always divided evenly, which is why the
       * gap only appeared once the cadence was tied to the orbital period instead.
       */
      sampleIntervalSeconds: duration / 6.3,
      limits: { tolerance: 1e-11, minStepSeconds: 1, maxStepSeconds: 86_400 * 5, maxSteps: 200_000 },
    });
    const final = result.samples[result.samples.length - 1];
    expect(final.t).toBeCloseTo(duration, 3);
  });

  /**
   * No sample is appended after an impact.
   *
   * The run ends the moment the body is struck and the fate carries that time, so appending
   * the loop's final state would place a sample inside the thing it hit. Worth a test rather
   * than trusting the guard, because the bug it guards against is exactly the kind that looks
   * like a one-pixel rendering artefact.
   */
  it("does not append one past an impact", () => {
    /**
     * Just the fall, with nothing else in the problem.
     *
     * The central mass is set to a negligible value rather than the Sun's, because a realistic
     * setup buries the thing being tested: at one au the Sun moves an object further in a day
     * than Earth's gravity does, so the body sails past instead of hitting. What is under test
     * is the sample bookkeeping around an impact, not orbital mechanics.
     *
     * The perturber is held away from the origin where the central mass sits. A perturber at
     * the central body's own position divides by zero in the indirect term, and that arrives
     * as a silent NaN rather than as a failure.
     */
    const earthCentre = 1e9;
    const earth = {
      id: "embary",
      gm: 3.986_004_418e14,
      radiusM: 6.371e6,
      positionAt: () => ({ x: earthCentre, y: 0, z: 0 }),
    };
    const result = propagate({
      model: { centralGm: 1, perturbers: [earth], relativistic: false },
      initial: {
        // Ten thousand kilometres up, released from rest. It falls in within half an hour.
        position: { x: earthCentre + 1e7, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
      },
      durationSeconds: 86_400,
      limits: { tolerance: 1e-10, minStepSeconds: 0.01, maxStepSeconds: 60, maxSteps: 400_000 },
    });

    expect(result.fate.kind).toBe("impact");
    const final = result.samples[result.samples.length - 1];
    if (result.fate.kind === "impact") {
      expect(final.t).toBeLessThanOrEqual(result.fate.atSeconds);
    }
  });
});
