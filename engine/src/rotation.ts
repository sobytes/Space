/**
 * Body orientation from the IAU rotational elements.
 *
 * The IAU gives a body's north pole as a right ascension and declination in the Earth equatorial
 * frame of J2000, drifting slowly, plus a prime meridian angle W that advances at W1 degrees per
 * day. That is enough to say exactly which way a planet's axis points and exactly where on its
 * surface is facing you, at any instant.
 *
 * One frame conversion is needed and it is easy to get silently wrong. Positions in this engine
 * are in the J2000 ecliptic, because that is the frame the Standish element tables use, while
 * IAU poles are in the J2000 equatorial frame. The two differ by the obliquity of the ecliptic.
 * Skipping that rotation tilts every planet by 23.4 degrees, which looks almost plausible and
 * is completely wrong.
 */

import { BODY_CONTRACTS, type BodyId } from "./bodies/registry";
import type { RotationalElements } from "./bodies/contract";
import { J2000_JD, type JdTdb } from "./time";
import { DAYS_PER_JULIAN_CENTURY, normalizeAngle, toRadians } from "./units";
import { cross, rotateX, vec3, type Vec3 } from "./vec";

/**
 * Obliquity of the ecliptic at J2000.0, in degrees.
 * IAU 2006 precession, 84381.406 arcseconds.
 */
export const OBLIQUITY_J2000_DEG = 84_381.406 / 3600;

const OBLIQUITY_RAD = toRadians(OBLIQUITY_J2000_DEG as never);

export interface Orientation {
  /** Unit vector along the body's north pole, in the J2000 ecliptic frame. */
  readonly poleEcliptic: Vec3;
  /** Rotation of the prime meridian about the pole, radians, wrapped to [0, 2pi). */
  readonly spin: number;
  /** Angle between the pole and ecliptic north, radians. The axial tilt as drawn. */
  readonly tilt: number;
  /** Direction the pole leans, measured in the ecliptic plane, radians. */
  readonly poleAzimuth: number;
}

/** A unit vector from a right ascension and declination, in the frame they were given in. */
function directionFrom(raRad: number, decRad: number): Vec3 {
  const cosDec = Math.cos(decRad);
  return vec3(cosDec * Math.cos(raRad), cosDec * Math.sin(raRad), Math.sin(decRad));
}

/**
 * Equatorial to ecliptic is a rotation about the shared x axis by the negative obliquity.
 * Both frames are J2000, so no precession term is needed.
 */
export function equatorialToEcliptic(v: Vec3): Vec3 {
  return rotateX(v, -OBLIQUITY_RAD);
}

export function orientationFromElements(
  rotation: RotationalElements,
  epoch: JdTdb,
): Orientation {
  const daysSinceJ2000 = epoch - J2000_JD;
  const centuries = daysSinceJ2000 / DAYS_PER_JULIAN_CENTURY;

  const raDeg = rotation.poleRaDeg + rotation.poleRaRateDegPerCentury * centuries;
  const decDeg = rotation.poleDecDeg + rotation.poleDecRateDegPerCentury * centuries;
  const wDeg = rotation.primeMeridianDeg + rotation.rotationRateDegPerDay * daysSinceJ2000;

  const poleEcliptic = equatorialToEcliptic(
    directionFrom(toRadians(raDeg as never), toRadians(decDeg as never)),
  );

  // Tilt is measured from ecliptic north, so it comes straight from the pole's z component.
  const tilt = Math.acos(Math.min(1, Math.max(-1, poleEcliptic.z)));
  const poleAzimuth = Math.atan2(poleEcliptic.y, poleEcliptic.x);

  return {
    poleEcliptic,
    spin: normalizeAngle(toRadians(wDeg as never)),
    tilt,
    poleAzimuth,
  };
}

export function orientationOf(body: BodyId, epoch: JdTdb): Orientation {
  return orientationFromElements(BODY_CONTRACTS[body].rotation, epoch);
}

/**
 * A body's three axes, as a renderer or a sundial needs them.
 *
 * `Orientation` above gives the pole plus two angles, which is enough to say which way the axis
 * points and nothing at all about which face is turned towards you. Reconstructing that from
 * the angles means picking an Euler sequence, and the sequence is where this goes wrong: the
 * website drew every body from `tilt` and `poleAzimuth` through a y-up sequence while render
 * space is z-up, which put every spin axis between 52 and 96 degrees from the IAU pole. Earth
 * was 68 degrees out, far enough that the camera looked almost down a pole and the planet
 * appeared to turn the wrong way. Reported exactly that way: "earth is spining on the wrong
 * direction?".
 *
 * So the frame is built here, once, as vectors. There is no sequence to choose and nothing for
 * a client to reconstruct, and `subSolarPoint` and the drawn globe now come from the same three
 * lines of arithmetic, which is what stops a lit hemisphere and a clock disagreeing.
 */
export interface BodyFrame {
  /** Unit vector along the body's north pole. */
  readonly pole: Vec3;
  /** Unit vector through the point where the prime meridian crosses the equator. */
  readonly primeMeridian: Vec3;
  /** Unit vector through the equator a quarter turn east of the prime meridian. */
  readonly east: Vec3;
}

/**
 * The standard IAU construction, in the J2000 equatorial frame the elements are published in.
 *
 * The pole comes straight from the published right ascension and declination. The node, where
 * the body's equator crosses the ICRF equator, is 90 degrees of right ascension ahead of the
 * pole. The prime meridian is that node carried round the pole by W.
 */
export function bodyFrameEquatorial(rotation: RotationalElements, epoch: JdTdb): BodyFrame {
  const daysSinceJ2000 = epoch - J2000_JD;
  const centuries = daysSinceJ2000 / DAYS_PER_JULIAN_CENTURY;

  const ra = toRadians((rotation.poleRaDeg
    + rotation.poleRaRateDegPerCentury * centuries) as never);
  const dec = toRadians((rotation.poleDecDeg
    + rotation.poleDecRateDegPerCentury * centuries) as never);
  const w = toRadians((rotation.primeMeridianDeg
    + rotation.rotationRateDegPerDay * daysSinceJ2000) as never);

  const pole = directionFrom(ra, dec);
  const node = vec3(-Math.sin(ra), Math.cos(ra), 0);
  const nodeCrossPole = cross(pole, node);

  // Rodrigues about the pole by W. The node is perpendicular to the pole, so the third term
  // vanishes and this is a plain rotation in the plane the two vectors span.
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const primeMeridian = vec3(
    node.x * cw + nodeCrossPole.x * sw,
    node.y * cw + nodeCrossPole.y * sw,
    node.z * cw + nodeCrossPole.z * sw,
  );

  return { pole, primeMeridian, east: cross(pole, primeMeridian) };
}

/** The same frame in the J2000 ecliptic, which is the frame every position here is in. */
export function bodyFrameOf(body: BodyId, epoch: JdTdb): BodyFrame {
  const frame = bodyFrameEquatorial(BODY_CONTRACTS[body].rotation, epoch);
  return {
    pole: equatorialToEcliptic(frame.pole),
    primeMeridian: equatorialToEcliptic(frame.primeMeridian),
    east: equatorialToEcliptic(frame.east),
  };
}

/** Sidereal rotation period in days, signed. Negative is retrograde. */
export function rotationPeriodDays(body: BodyId): number {
  return 360 / BODY_CONTRACTS[body].rotation.rotationRateDegPerDay;
}

/**
 * Obliquity in the convention the NASA fact sheets use, degrees.
 *
 * The IAU and the fact sheets do not mean the same thing by "north pole", and the difference is
 * exactly 180 degrees for a retrograde body. The IAU picks the pole lying north of the
 * invariable plane whatever direction the body spins. The fact sheets pick the pole the
 * right-hand rule gives for the actual rotation. So Uranus is 97.77 degrees in the fact sheet
 * and its IAU pole sits 82.23 degrees from ecliptic north, and Venus is 177.4 against 2.6.
 *
 * Both are correct. Mixing them silently flips a planet upside down, so the conversion is
 * written down here rather than left for someone to rediscover.
 */
export function obliquityToOrbitDeg(body: BodyId, epoch: JdTdb): number {
  const tiltDeg = (orientationOf(body, epoch).tilt * 180) / Math.PI;
  const retrograde = BODY_CONTRACTS[body].rotation.rotationRateDegPerDay < 0;
  return retrograde ? 180 - tiltDeg : tiltDeg;
}
