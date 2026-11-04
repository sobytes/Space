/**
 * Given where you are, where you want to be, and how long you will take: how fast must you
 * leave?
 *
 * This is Lambert's problem, and it is the thing that turns both the asteroid tool and the
 * launch tool from toys into instruments. Before this, aiming at anything meant moving a
 * heading slider and watching the result miss, because the target volume of a planet is a few
 * parts in a billion of the sky and nobody finds it by hand. Solving Lambert means a client
 * can ask "what would hit Mars" and get an answer, which is also exactly what mission design
 * asks.
 *
 * The formulation is universal variables, Bate, Mueller & White 1971 chapter 5, in the form
 * Vallado gives as Algorithm 58 in "Fundamentals of Astrodynamics and Applications". Universal
 * variables are used rather than the classical p-iteration because one set of equations covers
 * elliptic, parabolic and hyperbolic transfers, and a transfer that crosses between them is
 * exactly what a user dragging a flight-time slider produces.
 *
 * The root is found by bisection rather than by Newton's method. Newton converges faster and
 * fails on the long-way transfers near a half revolution, where the time-of-flight curve is
 * nearly flat; bisection is slower, cannot diverge, and 200 iterations of it is still
 * microseconds.
 */

import { cross, dot, length, scale, sub, type Vec3 } from "../vec";

/**
 * Stumpff functions, which are where the universality comes from.
 *
 * C and S are the series that reduce to trigonometric functions for an ellipse, to hyperbolic
 * ones for a hyperbola, and to constants at the parabolic boundary. The series form is used
 * near zero because the closed forms both divide by z there and lose all their precision.
 */
export function stumpffC(z: number): number {
  if (z > 1e-6) return (1 - Math.cos(Math.sqrt(z))) / z;
  if (z < -1e-6) return (Math.cosh(Math.sqrt(-z)) - 1) / -z;
  return 1 / 2 - z / 24 + (z * z) / 720;
}

export function stumpffS(z: number): number {
  if (z > 1e-6) {
    const s = Math.sqrt(z);
    return (s - Math.sin(s)) / Math.sqrt(z * z * z);
  }
  if (z < -1e-6) {
    const s = Math.sqrt(-z);
    return (Math.sinh(s) - s) / Math.sqrt(-z * -z * -z);
  }
  return 1 / 6 - z / 120 + (z * z) / 5040;
}

export interface LambertSolution {
  /** Velocity required at the departure point, m/s, in the same frame as the positions. */
  readonly departureVelocity: Vec3;
  /** Velocity on arrival, m/s. The difference from the target's own velocity is what hurts. */
  readonly arrivalVelocity: Vec3;
  /** How many iterations the bisection used. Diagnostic, not physics. */
  readonly iterations: number;
}

/**
 * Solve Lambert's problem between two position vectors.
 *
 * `longWay` picks the transfer that goes round the other side of the central body. Both are
 * valid and they are wildly different journeys: for a given flight time one is a lazy arc and
 * the other a sprint, and the cheap one swaps between them as the flight time changes.
 *
 * Returns null where no transfer exists for that flight time, which is a real answer and not
 * an error: asking to cross the solar system in a week has no solution at any speed that
 * conserves energy.
 */
export function solveLambert(
  gm: number,
  from: Vec3,
  to: Vec3,
  flightSeconds: number,
  longWay = false,
): LambertSolution | null {
  if (!(flightSeconds > 0) || !Number.isFinite(flightSeconds)) return null;

  const r1 = length(from);
  const r2 = length(to);
  if (r1 === 0 || r2 === 0) return null;

  const cosDeltaNu = Math.max(-1, Math.min(1, dot(from, to) / (r1 * r2)));
  // The sign of the out-of-plane component decides which way round is "short".
  const normal = cross(from, to);
  let deltaNu = Math.acos(cosDeltaNu);
  if (longWay !== normal.z < 0) deltaNu = 2 * Math.PI - deltaNu;

  const sinDeltaNu = Math.sin(deltaNu);
  const a = sinDeltaNu * Math.sqrt((r1 * r2) / (1 - Math.cos(deltaNu)));
  // A of zero means the two points and the focus are collinear, which Lambert cannot resolve:
  // the transfer plane is undefined.
  if (!Number.isFinite(a) || Math.abs(a) < 1e-9) return null;

  const yOf = (z: number) => {
    const c = stumpffC(z);
    if (c <= 0) return NaN;
    return r1 + r2 + (a * (z * stumpffS(z) - 1)) / Math.sqrt(c);
  };

  const timeOf = (z: number) => {
    const y = yOf(z);
    if (!(y > 0)) return NaN;
    const x = Math.sqrt(y / stumpffC(z));
    return (x ** 3 * stumpffS(z) + a * Math.sqrt(y)) / Math.sqrt(gm);
  };

  /**
   * Bracket the root before bisecting.
   *
   * Time of flight rises monotonically with z over the range that matters, so walking up from
   * a hyperbolic z until the time exceeds the one asked for brackets it. The upper bound of
   * 4 pi squared is the first multi-revolution singularity; past it `y` goes negative and the
   * transfer stops existing.
   */
  let low = -4 * Math.PI * Math.PI;
  let high = 4 * Math.PI * Math.PI - 1e-6;
  const tLow = timeOf(low);
  const tHigh = timeOf(high);
  if (!Number.isFinite(tLow) || !Number.isFinite(tHigh)) {
    // Walk the lower bound up until y turns positive, which it does for any reachable target.
    let found = false;
    for (let z = -100; z < high; z += 1) {
      if (Number.isFinite(timeOf(z))) {
        low = z;
        found = true;
        break;
      }
    }
    if (!found) return null;
  }
  if (!(timeOf(low) <= flightSeconds && timeOf(high) >= flightSeconds)) return null;

  let z = 0;
  let iterations = 0;
  for (; iterations < 200; iterations++) {
    z = (low + high) / 2;
    const t = timeOf(z);
    if (!Number.isFinite(t)) {
      low = z;
      continue;
    }
    if (t < flightSeconds) low = z;
    else high = z;
  }

  const y = yOf(z);
  if (!(y > 0)) return null;

  // Lagrange coefficients, which turn the solved geometry back into velocities.
  const f = 1 - y / r1;
  const g = a * Math.sqrt(y / gm);
  const gDot = 1 - y / r2;
  if (g === 0) return null;

  return {
    departureVelocity: scale(sub(to, scale(from, f)), 1 / g),
    arrivalVelocity: scale(sub(scale(to, gDot), from), 1 / g),
    iterations,
  };
}
