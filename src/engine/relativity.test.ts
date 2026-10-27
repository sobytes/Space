/**
 * Einstein's 1915 result, measured rather than asserted.
 *
 * Newtonian gravity closes Mercury's ellipse exactly. General relativity does not, and the
 * leftover advance of perihelion it predicts is 42.98 arcseconds per century. This test
 * integrates Mercury twice under an identical integrator, once with the post-Newtonian term
 * and once without, and measures the difference.
 *
 * The comparison has to be differential. RK4 is not symplectic, so it introduces a spurious
 * precession of its own over a century of integration. Running both arms with the same step
 * size makes that artefact common to both, so it cancels in the difference, and what is left
 * is the physics. The Newtonian arm's own measured drift is reported as the noise floor, so
 * the margin is visible instead of implied.
 */

import { describe, expect, it } from "vitest";
import { createRk4Scratch, rk4Step } from "./integrate";
import {
  MERCURY,
  MERCURY_GR_PRECESSION_ARCSEC_PER_CENTURY,
  perihelionAdvanceArcsecPerCentury,
  postNewtonianAcceleration,
} from "./relativity";

const RAD_TO_ARCSEC = 648_000 / Math.PI;
const SECONDS_PER_CENTURY = 36_525 * 86_400;
const STEP_SECONDS = 1_000;

function makeAcceleration(includeRelativity: boolean) {
  const gm = MERCURY.gmSun;
  return (
    position: readonly [number, number, number],
    velocity: readonly [number, number, number],
    _t: number,
    out: Float64Array,
  ): void => {
    const [x, y, z] = position;
    const r2 = x * x + y * y + z * z;
    const invR3 = 1 / (r2 * Math.sqrt(r2));
    out[0] = -gm * x * invR3;
    out[1] = -gm * y * invR3;
    out[2] = -gm * z * invR3;

    if (includeRelativity) {
      const correction = postNewtonianAcceleration(
        gm,
        { x, y, z },
        { x: velocity[0], y: velocity[1], z: velocity[2] },
      );
      out[0] += correction.x;
      out[1] += correction.y;
      out[2] += correction.z;
    }
  };
}

/** Start exactly at perihelion on the +x axis, so the initial perihelion longitude is zero. */
function initialState(): Float64Array {
  const { semiMajorAxisMetres: a, eccentricity: e, gmSun: gm } = MERCURY;
  const perihelionRadius = a * (1 - e);
  const perihelionSpeed = Math.sqrt((gm / a) * ((1 + e) / (1 - e)));
  return new Float64Array([perihelionRadius, 0, 0, 0, perihelionSpeed, 0]);
}

interface PerihelionPassage {
  readonly timeSeconds: number;
  readonly longitudeRad: number;
}

/**
 * Integrates for the given span and records the longitude of every perihelion passage.
 * A passage is a local minimum of the radius, located by fitting a parabola through the
 * three samples that bracket it, which gets sub-step resolution without a smaller dt.
 */
function measurePerihelia(includeRelativity: boolean, spanSeconds: number): PerihelionPassage[] {
  const state = initialState();
  const scratch = createRk4Scratch();
  const acceleration = makeAcceleration(includeRelativity);

  const passages: PerihelionPassage[] = [];
  let unwrapOffset = 0;
  let previousAngle = Math.atan2(state[1], state[0]);

  let rPrev = 0;
  let rCurr = Math.hypot(state[0], state[1]);
  let completedSteps = 0;
  let anglePrev = previousAngle;
  let angleCurr = previousAngle;
  let time = 0;

  while (time < spanSeconds) {
    rk4Step(state, time, STEP_SECONDS, acceleration, scratch);
    time += STEP_SECONDS;
    completedSteps += 1;

    const rNext = Math.hypot(state[0], state[1]);
    let angle = Math.atan2(state[1], state[0]);
    // Unwrap so a monotonically advancing longitude does not jump by 2pi each orbit.
    if (angle - previousAngle < -Math.PI) unwrapOffset += 2 * Math.PI;
    else if (angle - previousAngle > Math.PI) unwrapOffset -= 2 * Math.PI;
    previousAngle = angle;
    angle += unwrapOffset;

    // Needs three real samples to bracket a minimum, so the first step cannot be tested.
    if (completedSteps >= 2 && rCurr < rPrev && rCurr < rNext) {
      const denom = rPrev - 2 * rCurr + rNext;
      const shift = denom === 0 ? 0 : (0.5 * (rPrev - rNext)) / denom;
      const longitude =
        angleCurr + shift * 0.5 * (angle - anglePrev) + shift * shift * 0.5 * (angle - 2 * angleCurr + anglePrev);
      passages.push({ timeSeconds: time - STEP_SECONDS + shift * STEP_SECONDS, longitudeRad: longitude });
    }

    rPrev = rCurr;
    rCurr = rNext;
    anglePrev = angleCurr;
    angleCurr = angle;
  }

  return passages;
}

/** Least-squares slope of perihelion longitude against time, in radians per second. */
function driftRate(passages: readonly PerihelionPassage[]): number {
  const n = passages.length;
  let sumT = 0, sumL = 0, sumTT = 0, sumTL = 0;
  for (const p of passages) {
    sumT += p.timeSeconds;
    sumL += p.longitudeRad;
    sumTT += p.timeSeconds * p.timeSeconds;
    sumTL += p.timeSeconds * p.longitudeRad;
  }
  return (n * sumTL - sumT * sumL) / (n * sumTT - sumT * sumT);
}

/** Longitude accumulates 2pi per orbit; the precession is what is left after removing that. */
function precessionArcsecPerCentury(passages: readonly PerihelionPassage[]): number {
  const orbits = passages.length - 1;
  const span = passages[orbits].timeSeconds - passages[0].timeSeconds;
  const meanPeriod = span / orbits;
  const perOrbit = driftRate(passages) * meanPeriod - 2 * Math.PI;
  return perOrbit * (SECONDS_PER_CENTURY / meanPeriod) * RAD_TO_ARCSEC;
}

describe("Mercury's perihelion precession", () => {
  it("recovers Einstein's 42.98 arcsec per century from the post-Newtonian term", () => {
    const span = SECONDS_PER_CENTURY;

    const newtonian = measurePerihelia(false, span);
    const relativistic = measurePerihelia(true, span);

    const newtonianDrift = precessionArcsecPerCentury(newtonian);
    const relativisticDrift = precessionArcsecPerCentury(relativistic);
    const measured = relativisticDrift - newtonianDrift;

    const analytic = perihelionAdvanceArcsecPerCentury(
      MERCURY.gmSun,
      MERCURY.semiMajorAxisMetres,
      MERCURY.eccentricity,
      MERCURY.orbitalPeriodDays,
    );

    console.table([
      { quantity: "orbits integrated", value: newtonian.length - 1 },
      { quantity: "step size (s)", value: STEP_SECONDS },
      { quantity: "Newtonian arm drift (arcsec/cy)", value: newtonianDrift.toFixed(4) },
      { quantity: "Relativistic arm drift (arcsec/cy)", value: relativisticDrift.toFixed(4) },
      { quantity: "difference, the physics (arcsec/cy)", value: measured.toFixed(4) },
      { quantity: "Einstein 1915 closed form (arcsec/cy)", value: analytic.toFixed(4) },
      { quantity: "published value (arcsec/cy)", value: MERCURY_GR_PRECESSION_ARCSEC_PER_CENTURY },
      { quantity: "error vs closed form (arcsec/cy)", value: (measured - analytic).toFixed(4) },
      { quantity: "error vs closed form (%)", value: (((measured - analytic) / analytic) * 100).toFixed(3) },
    ]);

    expect(analytic).toBeCloseTo(MERCURY_GR_PRECESSION_ARCSEC_PER_CENTURY, 1);
    expect(measured).toBeGreaterThan(42.0);
    expect(measured).toBeLessThan(44.0);
    expect(Math.abs(measured - analytic)).toBeLessThan(0.5);
  });
});
