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
import {
  DEFAULT_LIMITS,
  eccentricityOf,
  propagate,
  specificAngularMomentum,
  specificEnergy,
  twoBodyModel,
  type Perturber,
} from "./propagate";
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
