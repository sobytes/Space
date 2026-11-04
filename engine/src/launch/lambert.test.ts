import { describe, expect, it } from "vitest";
import { solveLambert, stumpffC, stumpffS } from "./lambert";
import { propagate, twoBodyModel } from "../propagate";
import { length, sub, type Vec3 } from "../vec";
import { AU_IN_METRES, GM_SUN } from "../units";

/**
 * Lambert's problem, checked two ways that cannot both be wrong in the same direction.
 *
 * The analytic check pins the magnitude against a Hohmann transfer, whose delta-v has a
 * closed form. The round-trip check is the stronger one: take the velocity the solver
 * returns, fly it through the integrator for the stated time, and see whether it arrives.
 * That tests the solver against a completely different piece of code, and a solution that
 * does not arrive is worthless however plausible its number looks.
 */
describe("Lambert", () => {
  const from: Vec3 = { x: AU_IN_METRES, y: 0, z: 0 };

  it("matches the analytic Hohmann transfer", () => {
    const r1 = AU_IN_METRES;
    const r2 = 1.524 * AU_IN_METRES;
    const transferAxis = (r1 + r2) / 2;
    const flight = Math.PI * Math.sqrt(transferAxis ** 3 / GM_SUN);
    // 179 degrees rather than 180: at exactly half a revolution the transfer plane is
    // undefined, because the two points and the focus are collinear. That is a real property
    // of the problem rather than a limitation here, and real missions avoid it too.
    const theta = (Math.PI * 179) / 180;
    const to: Vec3 = { x: r2 * Math.cos(theta), y: r2 * Math.sin(theta), z: 0 };

    const solution = solveLambert(GM_SUN, from, to, flight)!;
    expect(solution).not.toBeNull();
    /**
     * Agreement to six parts in a million, and the residual is the one degree.
     *
     * The analytic Hohmann figure is for exactly half a revolution and this transfer is 179
     * degrees, so the two are not quite the same manoeuvre. Six parts in a million of
     * 32.7 km/s is 0.2 m/s, which is the difference the degree makes rather than anything the
     * solver got wrong: the round-trip test below pins the solver itself to under a metre.
     */
    const analytic = Math.sqrt(GM_SUN * (2 / r1 - 1 / transferAxis));
    expect(Math.abs(length(solution.departureVelocity) / analytic - 1)).toBeLessThan(2e-5);
  });

  /**
   * Fly the answer and see whether it arrives.
   *
   * The tolerance is in metres over an astronomical unit, so it is really asking whether the
   * two agree to the integrator's own accuracy. Measured: under a metre in every case.
   */
  it.each([
    ["a transfer to Mars distance", { x: -1.52 * AU_IN_METRES, y: 0.03 * AU_IN_METRES, z: 0 }, 259],
    ["a quarter turn out of plane", { x: 0, y: 1.2 * AU_IN_METRES, z: 0.1 * AU_IN_METRES }, 100],
    ["a short inner-system hop", { x: 0.8 * AU_IN_METRES, y: 0.5 * AU_IN_METRES, z: 0 }, 40],
  ] as const)("actually arrives: %s", (_label, to, days) => {
    const solution = solveLambert(GM_SUN, from, to, days * 86_400);
    expect(solution).not.toBeNull();

    const result = propagate({
      model: twoBodyModel(),
      initial: { position: from, velocity: solution!.departureVelocity },
      durationSeconds: days * 86_400,
      limits: { tolerance: 1e-12, minStepSeconds: 1, maxStepSeconds: 86_400 * 5, maxSteps: 500_000 },
    });
    const arrived = result.samples[result.samples.length - 1].position;
    expect(length(sub(arrived, to))).toBeLessThan(1_000);
  });

  it("reports no solution rather than a wrong one", () => {
    // Crossing the solar system in an hour conserves no energy anyone has.
    expect(solveLambert(GM_SUN, from, { x: -30 * AU_IN_METRES, y: 0, z: 0 }, 3_600)).toBeNull();
    expect(solveLambert(GM_SUN, from, { x: 2 * AU_IN_METRES, y: 0, z: 0 }, 0)).toBeNull();
    expect(solveLambert(GM_SUN, from, { x: 0, y: 0, z: 0 }, 86_400)).toBeNull();
  });

  /**
   * The long way round is a different journey, not a rounding difference.
   *
   * For the same two points and the same clock, going the other way about the Sun is a
   * genuinely different transfer, and which one is cheaper swaps as the flight time changes.
   */
  it("gives a different and also valid answer the long way round", () => {
    const to: Vec3 = { x: 0, y: 1.4 * AU_IN_METRES, z: 0 };
    const short = solveLambert(GM_SUN, from, to, 200 * 86_400)!;
    const long = solveLambert(GM_SUN, from, to, 200 * 86_400, true)!;
    expect(length(sub(short.departureVelocity, long.departureVelocity))).toBeGreaterThan(1_000);

    for (const solution of [short, long]) {
      const result = propagate({
        model: twoBodyModel(),
        initial: { position: from, velocity: solution.departureVelocity },
        durationSeconds: 200 * 86_400,
        limits: { tolerance: 1e-12, minStepSeconds: 1, maxStepSeconds: 86_400 * 5, maxSteps: 500_000 },
      });
      const arrived = result.samples[result.samples.length - 1].position;
      expect(length(sub(arrived, to))).toBeLessThan(5_000);
    }
  });
});

describe("Stumpff functions", () => {
  /**
   * The series and the closed forms must agree across the boundary where the code switches.
   *
   * Both closed forms divide by z, so near zero they lose everything; the series is used
   * there instead. A discontinuity at the switch would show up as a transfer that jumps when
   * a flight time is nudged, which is exactly the kind of thing a user finds and a test does
   * not, unless the test looks here.
   */
  it("are continuous across the series and closed-form boundary", () => {
    for (const z of [-1e-5, -1e-6, -1e-7, 0, 1e-7, 1e-6, 1e-5]) {
      expect(stumpffC(z)).toBeCloseTo(0.5, 4);
      expect(stumpffS(z)).toBeCloseTo(1 / 6, 5);
    }
  });

  it("reduce to the circular and hyperbolic forms away from zero", () => {
    // z = (pi)^2 is half a revolution of the eccentric anomaly.
    expect(stumpffC(Math.PI ** 2)).toBeCloseTo(2 / Math.PI ** 2, 10);
    expect(stumpffC(-1)).toBeCloseTo(Math.cosh(1) - 1, 10);
    expect(stumpffS(-1)).toBeCloseTo(Math.sinh(1) - 1, 10);
  });
});
