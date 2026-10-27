/**
 * Secular perturbation theory: the long-term drift of an orbit's shape, computed without
 * integrating it.
 *
 * This exists to be a second opinion. `nbody.ts` evolves Cartesian state vectors step by step;
 * this evaluates the same physics through an entirely different route, orbit-averaging the
 * disturbing function and applying Lagrange's planetary equation. Two independent algorithms
 * agreeing is evidence; one algorithm agreeing with itself is not.
 *
 * The derivation. A body's perturbed motion follows from the disturbing function, the direct
 * pull of the perturber plus the indirect term from the perturber's pull on the central body:
 *
 *     R = G m2 [ 1/|r1 - r2|  -  (r1 . r2)/r2^3 ]
 *
 * Averaging R over both mean anomalies strips the orbital motion and leaves the part that drives
 * the slow drift. Lagrange's equation for the longitude of pericentre, for a coplanar orbit, is
 *
 *     dvarpi/dt = sqrt(1 - e^2) / (n a^2 e) * d<R>/de
 *
 * which follows from the Delaunay pair (G = L sqrt(1-e^2), g = varpi) and dg/dt = -dR/dG.
 *
 * Differentiating under the integral rather than differencing <R> matters: a central difference
 * in e would need the quadrature accurate to roughly 1e-8 of its own value, while the gradient
 * form needs only the usual quadrature accuracy. At fixed mean anomaly, Kepler's equation gives
 * dE/de = sin E / (1 - e cos E), and the rest is the chain rule.
 *
 * A limit worth having. Expanding 1/|r1 - r2| in Legendre polynomials for r1 < r2, the l = 1
 * direct term cancels the indirect term exactly, <P2(cos psi)> = 1/4 for a circular perturber,
 * and <r1^2> = a1^2 (1 + 3 e1^2 / 2), which gives
 *
 *     dvarpi/dt  ->  (3/4) sqrt(1 - e1^2) n1 (m2/M) alpha^3,     alpha = a1/a2
 *
 * `leadingOrderPericentreRate` is that closed form. It is only valid for small alpha, which is
 * precisely what makes it a good check: the quadrature must converge onto it as alpha shrinks,
 * and that pins the quadrature's scale and sign against hand-derived algebra.
 */

import { GM_SUN } from "./units";
import { dot, length, scale, sub, type Vec3 } from "./vec";

const KEPLER_TOLERANCE = 1e-15;
const KEPLER_MAX_ITERATIONS = 60;

function solveEccentricAnomaly(meanAnomaly: number, eccentricity: number): number {
  let e = meanAnomaly;
  for (let i = 0; i < KEPLER_MAX_ITERATIONS; i++) {
    const step =
      (e - eccentricity * Math.sin(e) - meanAnomaly) / (1 - eccentricity * Math.cos(e));
    e -= step;
    if (Math.abs(step) < KEPLER_TOLERANCE) return e;
  }
  throw new Error(`Kepler's equation did not converge (M=${meanAnomaly}, e=${eccentricity})`);
}

export interface SecularConfiguration {
  /** Semi-major axis of the perturbed body, metres. */
  readonly semiMajorAxisM: number;
  readonly eccentricity: number;
  /** Gravitational parameter of the perturbed body, m^3 s^-2. Enters only through n. */
  readonly gm: number;
  /** Gravitational parameter of the perturber. */
  readonly perturberGm: number;
  /** Perturber's semi-major axis, metres. Treated as a circular coplanar orbit. */
  readonly perturberSemiMajorAxisM: number;
}

/**
 * Secular rate of the longitude of pericentre, radians per second, from an exterior perturber
 * on a circular coplanar orbit. Positive is prograde.
 *
 * `samples` sets the quadrature resolution in each of the two mean anomalies, so the cost is
 * quadratic in it. The integrand is smooth whenever the orbits do not cross, which is the only
 * regime this function is valid in; a crossing orbit has no secular theory of this form.
 */
export function secularPericentreRate(
  config: SecularConfiguration,
  samples = 1200,
): number {
  const { semiMajorAxisM: a1, eccentricity: e1, perturberSemiMajorAxisM: a2 } = config;
  if (!(a1 > 0) || !(a2 > 0)) throw new Error("both semi-major axes must be positive");
  if (!(e1 > 0 && e1 < 1)) {
    throw new Error(`eccentricity must be in (0, 1); the rate divides by e, got ${e1}`);
  }
  if (a1 * (1 + e1) >= a2) {
    throw new Error(
      `orbits cross: apoapsis ${a1 * (1 + e1)} m reaches the perturber at ${a2} m, ` +
        "and the orbit-averaged disturbing function is not defined there",
    );
  }

  const mu = GM_SUN + config.gm;
  const meanMotion = Math.sqrt(mu / (a1 * a1 * a1));
  const root = Math.sqrt(1 - e1 * e1);
  let sum = 0;

  for (let i = 0; i < samples; i++) {
    const meanAnomaly = (2 * Math.PI * (i + 0.5)) / samples;
    const anomaly = solveEccentricAnomaly(meanAnomaly, e1);
    const cosE = Math.cos(anomaly);
    const sinE = Math.sin(anomaly);

    const r1: Vec3 = { x: a1 * (cosE - e1), y: a1 * root * sinE, z: 0 };
    // Derivative of the position with respect to e at fixed mean anomaly.
    const dEde = sinE / (1 - e1 * cosE);
    const dr1: Vec3 = {
      x: a1 * (-sinE * dEde - 1),
      y: a1 * ((-e1 / root) * sinE + root * cosE * dEde),
      z: 0,
    };

    for (let j = 0; j < samples; j++) {
      const theta = (2 * Math.PI * (j + 0.5)) / samples;
      const r2: Vec3 = { x: a2 * Math.cos(theta), y: a2 * Math.sin(theta), z: 0 };
      const d = sub(r2, r1);
      const dl = length(d);
      const gradient = sub(scale(d, 1 / (dl * dl * dl)), scale(r2, 1 / (a2 * a2 * a2)));
      sum += dot(gradient, dr1);
    }
  }

  const dRde = (config.perturberGm * sum) / (samples * samples);
  return (root / (meanMotion * a1 * a1 * e1)) * dRde;
}

/** The small-alpha closed form, radians per second. Derived in this file's header. */
export function leadingOrderPericentreRate(config: SecularConfiguration): number {
  const { semiMajorAxisM: a1, eccentricity: e1 } = config;
  const meanMotion = Math.sqrt((GM_SUN + config.gm) / (a1 * a1 * a1));
  const alpha = a1 / config.perturberSemiMajorAxisM;
  return (
    0.75 *
    Math.sqrt(1 - e1 * e1) *
    meanMotion *
    (config.perturberGm / GM_SUN) *
    alpha * alpha * alpha
  );
}
