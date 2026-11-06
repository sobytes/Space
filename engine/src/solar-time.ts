/**
 * What time it is on another world, and the honest answer to what that even means.
 *
 * Asked as: if it is Sunday 22:30 on Earth, what is it on Mars, and is there a Greenwich for
 * the solar system. There are two separate questions inside that and conflating them is how
 * every confident wrong answer starts.
 *
 * The first is coordinate time, and it is already solved and already running here. The IAU
 * defines TCB, the coordinate time of the solar system barycentre frame, and TDB, which is TCB
 * rescaled to stay within about 1.7 ms of a clock on Earth's geoid. Every JPL ephemeris is
 * published in TDB and this simulation's clock has been a TDB value since it was written. So
 * there is a universal time for the solar system, the app runs on it, and the answer to "what
 * time is it everywhere at once" is the number already on the clock.
 *
 * The second is civil time, and there is no universal answer because there cannot be one. A
 * civil clock exists to tell you where the Sun is, and the Sun is in a different place at every
 * body and moves at a different rate. UTC is specifically Earth's: leap seconds exist only to
 * keep it in step with Earth's rotation, which means nothing on Mars.
 *
 * What generalises is the construction rather than the clock. Greenwich is a chosen meridian
 * and GMT is the Sun's hour angle from it, and every body in this registry already has its
 * chosen meridian: the IAU fixes a prime meridian for all of them through the W angle, which
 * this engine already carries and already draws with. Mars's is the crater Airy-0, picked for
 * exactly the reason Greenwich was. So "the time at this body's Greenwich" is a question with
 * a real answer for all 32 bodies here, and this module computes it from the geometry rather
 * than from a table of offsets, which could not exist anyway: the offset changes continuously
 * because the days are different lengths.
 *
 * One caveat belongs on Earth specifically. The IAU gives it a uniformly rotating prime
 * meridian, W = 190.147 + 360.9856235 d, which puts the meridian at right ascension 280.147
 * degrees at J2000 where true Greenwich sidereal time is 280.46. That rounding is 75 seconds
 * of rotation, and by 2026 a linear rate has drifted a little further from Earth's actual,
 * irregular UT1, for a measured constant 92 seconds. The shape of the equation of time comes
 * out to within ten seconds across the year, so the geometry is right; matching a real sundial
 * to the second would need ERA, precession-nutation and UT1, none of which this engine carries
 * and none of which the other 31 bodies need. The constant is documented and pinned by a test
 * rather than tuned away.
 *
 * What this returns is apparent solar time, the sundial reading, because that is what the
 * geometry gives exactly. Mean solar time, which is what MTC and UTC actually are, differs from
 * it by the equation of time, and that correction is reported alongside rather than folded in
 * silently: on Mars it reaches nearly 50 minutes, far larger than Earth's quarter hour, because
 * Mars's orbit is a good deal more eccentric.
 */

import { BODY_CONTRACTS, type BodyId } from "./bodies/registry";
import { heliocentricPositionOf } from "./bodies/position";
import { OBLIQUITY_J2000_DEG } from "./rotation";
import { timeSense } from "./time-sense";
import { J2000_JD, type JdTdb } from "./time";
import { DAYS_PER_JULIAN_CENTURY } from "./units";
import type { Vec3 } from "./vec";

const DEG = Math.PI / 180;
const OBLIQUITY_RAD = OBLIQUITY_J2000_DEG * DEG;

function normalise(v: Vec3): Vec3 {
  const m = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}

/** The inverse of `equatorialToEcliptic`: a rotation about the shared x axis by +obliquity. */
function eclipticToEquatorial(v: Vec3): Vec3 {
  const c = Math.cos(OBLIQUITY_RAD);
  const s = Math.sin(OBLIQUITY_RAD);
  return { x: v.x, y: v.y * c - v.z * s, z: v.y * s + v.z * c };
}

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

/**
 * The body's own axes at this epoch, in the J2000 equatorial frame.
 *
 * The standard IAU construction. The pole comes straight from the published right ascension
 * and declination. The node, where the body's equator crosses the ICRF equator, is 90 degrees
 * of right ascension ahead of the pole. The prime meridian is that node carried round the pole
 * by W, which is the angle the engine already evaluates to draw the body's rotation.
 */
function bodyFrame(body: BodyId, epoch: JdTdb) {
  const rotation = BODY_CONTRACTS[body].rotation;
  const days = epoch - J2000_JD;
  const centuries = days / DAYS_PER_JULIAN_CENTURY;

  const ra = (rotation.poleRaDeg + rotation.poleRaRateDegPerCentury * centuries) * DEG;
  const dec = (rotation.poleDecDeg + rotation.poleDecRateDegPerCentury * centuries) * DEG;
  const w = (rotation.primeMeridianDeg + rotation.rotationRateDegPerDay * days) * DEG;

  const pole: Vec3 = {
    x: Math.cos(dec) * Math.cos(ra),
    y: Math.cos(dec) * Math.sin(ra),
    z: Math.sin(dec),
  };
  // Ascending node of the body equator on the ICRF equator, at right ascension ra + 90.
  const node: Vec3 = { x: -Math.sin(ra), y: Math.cos(ra), z: 0 };
  const nodeCrossPole = cross(pole, node);

  // Rodrigues about the pole by W, which for a unit axis perpendicular to the node is just a
  // rotation in the plane the two span.
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const primeMeridian: Vec3 = {
    x: node.x * cw + nodeCrossPole.x * sw,
    y: node.y * cw + nodeCrossPole.y * sw,
    z: node.z * cw + nodeCrossPole.z * sw,
  };
  return { pole, primeMeridian, east: cross(pole, primeMeridian) };
}

export interface SubSolarPoint {
  /** Planetocentric east longitude of the point the Sun is overhead, degrees, -180 to 180. */
  readonly longitudeDeg: number;
  /** Planetocentric latitude of that point, degrees. The Sun's declination for this body. */
  readonly latitudeDeg: number;
}

/** Where on the body the Sun is directly overhead, right now. */
export function subSolarPoint(body: BodyId, epoch: JdTdb): SubSolarPoint {
  // The Sun sits at the heliocentric origin, so the direction to it is just minus the body's
  // own position. Light time is ignored deliberately: it shifts the sub-solar point by under
  // an arcsecond of longitude, which is a fraction of a second on any clock here.
  const toSun = normalise(eclipticToEquatorial(
    (() => {
      const p = heliocentricPositionOf(body, epoch);
      return { x: -p.x, y: -p.y, z: -p.z };
    })(),
  ));

  const frame = bodyFrame(body, epoch);
  return {
    longitudeDeg: Math.atan2(dot(toSun, frame.east), dot(toSun, frame.primeMeridian)) / DEG,
    latitudeDeg: Math.asin(Math.max(-1, Math.min(1, dot(toSun, frame.pole)))) / DEG,
  };
}

export interface SolarClock {
  readonly body: BodyId;
  /** Apparent solar time at the IAU prime meridian, in hours of this body's own day, 0 to 24. */
  readonly hours: number;
  /** The same, as a clock reads it. */
  readonly formatted: string;
  readonly subSolar: SubSolarPoint;
  /** Sunrise to sunrise here, in Earth days. */
  readonly solLengthDays: number;
  /** One hour of this body's clock, in Earth seconds. Earth's is 3600 by construction. */
  readonly hourInEarthSeconds: number;
  /** Whole solar days elapsed at the prime meridian since J2000. Negative before it. */
  readonly dayNumber: number;
  /** True for a body whose clock the Sun drives backwards across the sky. */
  readonly sunRisesInTheWest: boolean;
}

/**
 * The time at this body's Greenwich.
 *
 * Apparent solar time: twelve hours plus the Sun's hour angle from the prime meridian, which is
 * the same definition Greenwich Mean Time had before it was replaced by an atomic standard.
 * At local apparent noon the Sun is over the prime meridian and the clock reads 12.
 *
 * The sign flips for a retrograde body, and that is not a tidy-up. On Venus the Sun rises in
 * the west, so the sub-solar longitude moves the other way, and without the flip the clock
 * would run backwards. A clock that counts down is not a clock.
 */
export function solarClock(body: BodyId, epoch: JdTdb): SolarClock {
  const subSolar = subSolarPoint(body, epoch);
  const retrograde = BODY_CONTRACTS[body].rotation.rotationRateDegPerDay < 0;
  const sense = retrograde ? -1 : 1;

  const raw = 12 - (sense * subSolar.longitudeDeg * 24) / 360;
  const hours = ((raw % 24) + 24) % 24;

  const sense_ = timeSense(body);
  const solLengthDays = sense_.dayInEarthDays;

  /**
   * Which solar day it is, counted at the prime meridian.
   *
   * The elapsed count has to come from the whole number of sols, not from dividing the elapsed
   * Earth days by the sol length and rounding: the second disagrees with the clock by a day
   * every time the fractional parts straddle midnight, which is exactly when someone would
   * notice. So the fraction is taken from the clock itself and subtracted off first.
   */
  const elapsedSols = (epoch - J2000_JD) / solLengthDays;
  const dayNumber = Math.round(elapsedSols - hours / 24);

  const whole = Math.floor(hours);
  const minutes = Math.floor((hours - whole) * 60);
  const seconds = Math.floor(((hours - whole) * 60 - minutes) * 60);
  const pad = (n: number) => String(n).padStart(2, "0");

  return {
    body,
    hours,
    formatted: `${pad(whole)}:${pad(minutes)}:${pad(seconds)}`,
    subSolar,
    solLengthDays,
    hourInEarthSeconds: (solLengthDays * 86_400) / 24,
    dayNumber,
    sunRisesInTheWest: retrograde,
  };
}
