/**
 * First post-Newtonian corrections to gravity.
 *
 * This exists for one reason. Newtonian gravity predicts a closed ellipse, and Mercury's
 * orbit does not close. The leftover advance of its perihelion, 43 arcseconds per century
 * once every planetary perturbation is subtracted, was unexplained from Le Verrier in 1859
 * until Einstein derived exactly that figure from general relativity in November 1915.
 *
 * So the correction below is not polish. It is the term that makes the difference between a
 * simulation that looks right and one that reproduces the first experimental confirmation of
 * general relativity. Switching it on and watching the precession appear is the demonstration.
 */

import { GM_SUN, SPEED_OF_LIGHT_M_S } from "./units";
import { dot, lengthSquared, type Vec3 } from "./vec";

const C2 = SPEED_OF_LIGHT_M_S * SPEED_OF_LIGHT_M_S;

/**
 * Einstein-Infeld-Hoffmann acceleration for a test body about a central mass, to order 1/c^2.
 *
 *   a = (GM / c^2 r^3) [ (4GM/r - v^2) r + 4 (r . v) v ]
 *
 * Integrated over one orbit this reproduces the closed-form advance below, which is the
 * check that the gauge and the factors are right.
 */
export function postNewtonianAcceleration(gm: number, position: Vec3, velocity: Vec3): Vec3 {
  const r2 = lengthSquared(position);
  const r = Math.sqrt(r2);
  const v2 = lengthSquared(velocity);
  const rDotV = dot(position, velocity);

  const prefactor = gm / (C2 * r2 * r);
  const radialTerm = 4 * (gm / r) - v2;

  return {
    x: prefactor * (radialTerm * position.x + 4 * rDotV * velocity.x),
    y: prefactor * (radialTerm * position.y + 4 * rDotV * velocity.y),
    z: prefactor * (radialTerm * position.z + 4 * rDotV * velocity.z),
  };
}

/**
 * The closed-form relativistic advance of perihelion per orbit, in radians.
 *
 *   dw = 6 pi GM / (c^2 a (1 - e^2))
 *
 * Einstein, "Erklarung der Perihelbewegung des Merkur aus der allgemeinen
 * Relativitatstheorie", Sitzungsberichte der Preussischen Akademie der Wissenschaften,
 * 18 November 1915. This is the analytic value the numerical integration must recover.
 */
export function perihelionAdvancePerOrbit(gm: number, semiMajorAxis: number, eccentricity: number): number {
  return (6 * Math.PI * gm) / (C2 * semiMajorAxis * (1 - eccentricity * eccentricity));
}

/** The same advance expressed the way the literature quotes it, arcseconds per Julian century. */
export function perihelionAdvanceArcsecPerCentury(
  gm: number,
  semiMajorAxis: number,
  eccentricity: number,
  orbitalPeriodDays: number,
): number {
  const perOrbit = perihelionAdvancePerOrbit(gm, semiMajorAxis, eccentricity);
  const orbitsPerCentury = 36_525 / orbitalPeriodDays;
  return perOrbit * orbitsPerCentury * (648_000 / Math.PI);
}

/**
 * Mercury's osculating orbit, from JPL's planetary physical and orbital parameters
 * (https://ssd.jpl.nasa.gov/planets/phys_par.html and the Standish element table).
 * Kept here so the demonstration and its gate read from one place.
 */
export const MERCURY = {
  semiMajorAxisMetres: 5.790_890_0e10,
  eccentricity: 0.205_630,
  orbitalPeriodDays: 87.969_257,
  gmSun: GM_SUN,
} as const;

/**
 * The published value this demonstration is measured against.
 * Clemence, "The Relativity Effect in Planetary Motions", Rev. Mod. Phys. 19, 361 (1947)
 * gives the general-relativistic prediction as 43.03 arcsec/century; the modern figure
 * from the same formula with current constants is 42.98.
 */
export const MERCURY_GR_PRECESSION_ARCSEC_PER_CENTURY = 42.98;
