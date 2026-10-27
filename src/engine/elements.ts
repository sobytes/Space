/**
 * Osculating orbital elements from a state vector.
 *
 * "Osculating" means the elements of the Keplerian orbit the body would follow from here if
 * every perturbation switched off. Under perturbation they drift, and that drift is the signal:
 * an apsidal precession rate is the secular trend in `longitudeOfPericentre`.
 *
 * The distinction that matters. `longitudeOfPericentre` is the classical varpi = Omega + omega,
 * with omega measured in the body's own orbital plane from the ascending node. It is NOT the
 * ecliptic longitude of the eccentricity vector, atan2(e_y, e_x). For a coplanar orbit the two
 * agree; for an inclined one they do not, and their secular rates differ. Mercury is inclined
 * 7 degrees, which makes the gap about 2.6 arcsec/century in its perihelion advance, and the
 * published planetary-perturbation figure is quoted for varpi. Measuring the projected
 * longitude instead and comparing it to that figure silently loses half a percent.
 */

import { cross, dot, length, normalize, scale, sub, type Vec3 } from "./vec";

/**
 * The eccentricity vector, e = ((v.v - mu/r) r - (r.v) v) / mu.
 *
 * It points from the focus toward pericentre and its magnitude is the eccentricity, which makes
 * it the natural handle on apsidal motion: no quadrant logic, no branch at e = 0.
 */
export function eccentricityVector(gm: number, position: Vec3, velocity: Vec3): Vec3 {
  const r = length(position);
  return scale(
    sub(scale(position, dot(velocity, velocity) - gm / r), scale(velocity, dot(position, velocity))),
    1 / gm,
  );
}

export interface OsculatingElements {
  readonly semiMajorAxisM: number;
  readonly eccentricity: number;
  readonly inclinationRad: number;
  readonly longitudeOfAscendingNodeRad: number;
  readonly argumentOfPericentreRad: number;
  /** varpi = Omega + omega. The quantity apsidal precession rates are quoted for. */
  readonly longitudeOfPericentreRad: number;
  /** Ecliptic longitude of the eccentricity vector. Equals varpi only when coplanar. */
  readonly projectedPericentreLongitudeRad: number;
}

export function osculatingElements(
  gm: number,
  position: Vec3,
  velocity: Vec3,
): OsculatingElements {
  const h = cross(position, velocity);
  const hLength = length(h);
  if (hLength === 0) throw new Error("radial trajectory: the orbital plane is undefined");
  const hHat = scale(h, 1 / hLength);

  const e = eccentricityVector(gm, position, velocity);
  const eccentricity = length(e);

  // The node line is where the orbital plane meets the reference plane. For a non-inclined
  // orbit it is undefined, so fall back to the reference x-axis, which makes omega measure
  // from there and keeps varpi continuous as the inclination passes through zero.
  const equatorial = Math.hypot(h.x, h.y) === 0;
  const node: Vec3 = equatorial ? { x: 1, y: 0, z: 0 } : normalize({ x: -h.y, y: h.x, z: 0 });
  const longitudeOfAscendingNodeRad = equatorial ? 0 : Math.atan2(h.x, -h.y);

  // Signed in-plane angle from the node to pericentre, with the orbit normal fixing the sign.
  const argumentOfPericentreRad =
    eccentricity === 0 ? 0 : Math.atan2(dot(hHat, cross(node, e)), dot(node, e));

  const speedSquared = dot(velocity, velocity);
  const r = length(position);

  return {
    semiMajorAxisM: 1 / (2 / r - speedSquared / gm),
    eccentricity,
    inclinationRad: Math.acos(Math.max(-1, Math.min(1, hHat.z))),
    longitudeOfAscendingNodeRad,
    argumentOfPericentreRad,
    longitudeOfPericentreRad: longitudeOfAscendingNodeRad + argumentOfPericentreRad,
    projectedPericentreLongitudeRad: Math.atan2(e.y, e.x),
  };
}
