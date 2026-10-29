/**
 * Mercury's anomalous perihelion advance, measured by integration.
 *
 * The measurement lives here rather than in a test file so that the gate and the UI read the
 * same code. A demonstration the user can run and a demonstration the CI can fail on should
 * never be two separate implementations.
 */

import { createRk4Scratch, rk4Step } from "../integrate";
import {
  MERCURY,
  MERCURY_GR_PRECESSION_ARCSEC_PER_CENTURY,
  perihelionAdvanceArcsecPerCentury,
  postNewtonianAcceleration,
} from "../relativity";
import type { Demonstration, DemonstrationResult } from "./types";

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
      const c = postNewtonianAcceleration(
        gm,
        { x, y, z },
        { x: velocity[0], y: velocity[1], z: velocity[2] },
      );
      out[0] += c.x;
      out[1] += c.y;
      out[2] += c.z;
    }
  };
}

/** Starts exactly at perihelion on the +x axis, so the initial perihelion longitude is zero. */
function initialState(): Float64Array {
  const { semiMajorAxisMetres: a, eccentricity: e, gmSun: gm } = MERCURY;
  return new Float64Array([
    a * (1 - e),
    0,
    0,
    0,
    Math.sqrt((gm / a) * ((1 + e) / (1 - e))),
    0,
  ]);
}

interface Passage {
  readonly timeSeconds: number;
  readonly longitudeRad: number;
}

function measurePerihelia(includeRelativity: boolean, spanSeconds: number): Passage[] {
  const state = initialState();
  const scratch = createRk4Scratch();
  const acceleration = makeAcceleration(includeRelativity);

  const passages: Passage[] = [];
  let unwrapOffset = 0;
  let previousRaw = Math.atan2(state[1], state[0]);
  let rPrev = 0;
  let rCurr = Math.hypot(state[0], state[1]);
  let anglePrev = previousRaw;
  let angleCurr = previousRaw;
  let completedSteps = 0;
  let time = 0;

  while (time < spanSeconds) {
    rk4Step(state, time, STEP_SECONDS, acceleration, scratch);
    time += STEP_SECONDS;
    completedSteps += 1;

    const rNext = Math.hypot(state[0], state[1]);
    const raw = Math.atan2(state[1], state[0]);
    if (raw - previousRaw < -Math.PI) unwrapOffset += 2 * Math.PI;
    else if (raw - previousRaw > Math.PI) unwrapOffset -= 2 * Math.PI;
    previousRaw = raw;
    const angle = raw + unwrapOffset;

    // Three real samples are needed to bracket a minimum, so the first step cannot be tested.
    if (completedSteps >= 2 && rCurr < rPrev && rCurr < rNext) {
      const denom = rPrev - 2 * rCurr + rNext;
      const shift = denom === 0 ? 0 : (0.5 * (rPrev - rNext)) / denom;
      const longitude =
        angleCurr +
        shift * 0.5 * (angle - anglePrev) +
        shift * shift * 0.5 * (angle - 2 * angleCurr + anglePrev);
      passages.push({
        timeSeconds: time - STEP_SECONDS + shift * STEP_SECONDS,
        longitudeRad: longitude,
      });
    }

    rPrev = rCurr;
    rCurr = rNext;
    anglePrev = angleCurr;
    angleCurr = angle;
  }

  return passages;
}

function driftRate(passages: readonly Passage[]): number {
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

/** Longitude gains 2pi per orbit; the precession is whatever is left after removing that. */
function precessionArcsecPerCentury(passages: readonly Passage[]): number {
  const orbits = passages.length - 1;
  const span = passages[orbits].timeSeconds - passages[0].timeSeconds;
  const meanPeriod = span / orbits;
  const perOrbit = driftRate(passages) * meanPeriod - 2 * Math.PI;
  return perOrbit * (SECONDS_PER_CENTURY / meanPeriod) * RAD_TO_ARCSEC;
}

export interface PrecessionMeasurement {
  readonly newtonianArcsecPerCentury: number;
  readonly relativisticArcsecPerCentury: number;
  readonly differenceArcsecPerCentury: number;
  readonly closedFormArcsecPerCentury: number;
  readonly orbitsIntegrated: number;
}

/**
 * Differential by construction. RK4 is not symplectic, so a century of integration precesses
 * slightly on its own. Running both arms at an identical step size makes that artefact common
 * to both, so it cancels in the difference and what remains is the relativistic term.
 */
export function measureMercuryPrecession(centuries = 1): PrecessionMeasurement {
  const span = SECONDS_PER_CENTURY * centuries;
  const newtonian = measurePerihelia(false, span);
  const relativistic = measurePerihelia(true, span);

  const newtonianArcsecPerCentury = precessionArcsecPerCentury(newtonian);
  const relativisticArcsecPerCentury = precessionArcsecPerCentury(relativistic);

  return {
    newtonianArcsecPerCentury,
    relativisticArcsecPerCentury,
    differenceArcsecPerCentury: relativisticArcsecPerCentury - newtonianArcsecPerCentury,
    closedFormArcsecPerCentury: perihelionAdvanceArcsecPerCentury(
      MERCURY.gmSun,
      MERCURY.semiMajorAxisMetres,
      MERCURY.eccentricity,
      MERCURY.orbitalPeriodDays,
    ),
    orbitsIntegrated: newtonian.length - 1,
  };
}

function run(): DemonstrationResult {
  const m = measureMercuryPrecession(1);
  return {
    measured: m.differenceArcsecPerCentury,
    control: { label: "Newtonian gravity alone", value: m.newtonianArcsecPerCentury },
    rows: [
      { label: "orbits integrated", value: String(m.orbitsIntegrated) },
      { label: "integrator step", value: `${STEP_SECONDS} s, fourth-order Runge-Kutta` },
      { label: "Newtonian arm", value: `${m.newtonianArcsecPerCentury.toFixed(4)} arcsec/century` },
      { label: "with relativity", value: `${m.relativisticArcsecPerCentury.toFixed(4)} arcsec/century` },
      { label: "the difference", value: `${m.differenceArcsecPerCentury.toFixed(4)} arcsec/century` },
      { label: "Einstein's closed form", value: `${m.closedFormArcsecPerCentury.toFixed(4)} arcsec/century` },
    ],
    caveats: [
      "This is a two-body measurement, Sun and Mercury only. The full observed advance of " +
        "about 5600 arcsec per century is mostly the precession of the equinoxes plus the pull " +
        "of the other planets. The 43 arcseconds isolated here is the part that is left over " +
        "once those are subtracted, and the part Newton cannot explain.",
    ],
  };
}

export const MERCURY_PRECESSION: Demonstration = {
  id: "mercury-precession",
  title: "The 43 arcseconds that needed a new theory of gravity",
  question: "Newton's gravity says an orbit is a closed ellipse. Why isn't Mercury's?",
  attribution: "Urbain Le Verrier, 1859; explained by Albert Einstein, 18 November 1915",
  history:
    "Le Verrier found that Mercury's perihelion advances about 43 arcseconds per century more " +
    "than Newtonian gravity allows, once every other planet's pull is accounted for. For fifty " +
    "years the favoured explanation was an undiscovered planet, Vulcan, orbiting closer to the " +
    "Sun. Nobody found it. In November 1915 Einstein computed the advance from general " +
    "relativity, got 43 arcseconds with no free parameters, and later wrote that it gave him " +
    "palpitations. It was the first time the new theory explained something the old one could not.",
  published: {
    value: MERCURY_GR_PRECESSION_ARCSEC_PER_CENTURY,
    unit: "arcsec/century",
    tolerance: 0.01,
    source:
      "Einstein, Sitzungsberichte der Preussischen Akademie der Wissenschaften, 18 Nov 1915; " +
      "Clemence, Rev. Mod. Phys. 19, 361 (1947)",
  },
  run,
};
