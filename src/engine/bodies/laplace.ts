/**
 * The Laplace plane, which is where most regular satellites actually orbit.
 *
 * A moon close to its planet is held in the planet's equatorial plane by the oblateness bulge.
 * A moon far away is held in the planet's orbital plane by the Sun. In between, the orbit
 * settles onto a warped surface that transitions from one to the other, and JPL's satellite
 * tables quote elements in exactly that plane for Mars, Jupiter and Saturn.
 *
 * Treating Laplace as "the parent's equator" is correct to a fraction of a degree for the
 * inner moons and badly wrong for the outer ones. Saturn's Laplace radius is about 2.5 million
 * km: Mimas at 186,000 km is firmly equatorial, Iapetus at 3.56 million km is past the
 * transition, and Phoebe at 12.9 million km is effectively in Saturn's orbital plane. Pinning
 * all three to the equator would put Iapetus and Phoebe in visibly wrong orbits.
 *
 * Reference: Tremaine, Touma and Namouni, "Satellite dynamics on the Laplace surface",
 * Astronomical Journal 137, 3706 (2009).
 */

import { J2000_JD, type JdTdb } from "../time";
import { GM_SUN, toMetresFromAu } from "../units";
import { normalize, rotateX, rotateZ, vec3, type Vec3 } from "../vec";
import { orientationOf } from "../rotation";
import { SHORT_SPAN } from "../data/planets";
import { BODY_CONTRACTS, type BodyId } from "./registry";

/**
 * Second zonal harmonic, the oblateness term that holds inner moons in the equatorial plane.
 * Values from JPL's planetary gravity field solutions.
 */
export const J2: Readonly<Partial<Record<BodyId, number>>> = {
  embary: 1.082_63e-3,
  mars: 1.960_45e-3,
  jupiter: 1.4736e-2,
  saturn: 1.6298e-2,
  uranus: 3.343_43e-3,
  neptune: 3.411e-3,
};

/**
 * The Laplace radius: where the Sun's torque on a satellite's orbit equals the planet's
 * oblateness torque.
 *
 *   r_L^5 = 2 J2 R_p^2 a_p^3 (M_p / M_sun)
 */
export function laplaceRadiusM(planet: BodyId): number | null {
  const j2 = J2[planet];
  const contract = BODY_CONTRACTS[planet];
  if (j2 === undefined || contract.ephemeris.kind !== "standish-elements") return null;

  const planetOrbitM = toMetresFromAu(
    SHORT_SPAN.elements[contract.ephemeris.planet].atJ2000.semiMajorAxisAu,
  );
  const massRatio = contract.gm / GM_SUN;

  return Math.pow(
    2 * j2 * contract.equatorialRadiusM ** 2 * planetOrbitM ** 3 * massRatio,
    1 / 5,
  );
}

/**
 * Tilt of the Laplace plane away from the planet's orbital plane, radians.
 *
 *   tan(2 i_L) = sin(2 eps) / ( cos(2 eps) + (a / r_L)^5 )
 *
 * with eps the planet's obliquity. Close in the ratio vanishes and i_L tends to eps, meaning
 * the plane coincides with the equator. Far out the ratio dominates and i_L tends to zero,
 * meaning the plane coincides with the planet's orbit.
 */
export function laplaceTiltFromOrbit(
  obliquityRad: number,
  semiMajorAxisM: number,
  laplaceRadius: number,
): number {
  const ratio = (semiMajorAxisM / laplaceRadius) ** 5;
  return 0.5 * Math.atan2(Math.sin(2 * obliquityRad), Math.cos(2 * obliquityRad) + ratio);
}

export interface PlaneOrientation {
  /** Unit normal of the orbital plane, in the J2000 ecliptic frame. */
  readonly pole: Vec3;
  /** How far the plane sits from the planet's equator, degrees. Zero means equatorial. */
  readonly tiltFromEquatorDeg: number;
}

/**
 * The Laplace plane's pole for one satellite, in ecliptic coordinates.
 *
 * The plane's pole lies in the arc between the planet's spin pole and its orbit pole, which
 * for everything here is close enough to the ecliptic pole to use directly: the planets'
 * orbital inclinations are a couple of degrees, far below the tens of degrees this function
 * is resolving between.
 */
export function laplacePlaneFor(planet: BodyId, semiMajorAxisM: number, epoch: JdTdb): PlaneOrientation {
  const spinPole = orientationOf(planet, epoch).poleEcliptic;
  const radius = laplaceRadiusM(planet);

  // No oblateness figure means no transition to compute; fall back to the equator.
  if (radius === null) return { pole: spinPole, tiltFromEquatorDeg: 0 };

  const obliquity = Math.acos(Math.min(1, Math.max(-1, Math.abs(spinPole.z))));
  const tiltFromOrbit = laplaceTiltFromOrbit(obliquity, semiMajorAxisM, radius);
  const tiltFromEquator = obliquity - tiltFromOrbit;

  // Rotate the ecliptic pole towards the spin pole by the plane's tilt from the orbit plane.
  const azimuth = Math.atan2(spinPole.y, spinPole.x);
  const pole = normalize(rotateZ(rotateX(vec3(0, 0, 1), tiltFromOrbit), azimuth));

  return { pole, tiltFromEquatorDeg: (tiltFromEquator * 180) / Math.PI };
}

/** Rotation taking a plane's local frame into the ecliptic, given that plane's pole. */
export function intoPlane(local: Vec3, pole: Vec3): Vec3 {
  const tilt = Math.acos(Math.min(1, Math.max(-1, pole.z)));
  const azimuth = Math.atan2(pole.y, pole.x);
  return rotateZ(rotateX(local, tilt), azimuth);
}

export { J2000_JD };
