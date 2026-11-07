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
 * meridian, W = 190.147 + 360.9856235 d, which does not track Earth's actual, irregular
 * rotation. Against the published equation of time the shape comes out right, to about six
 * seconds across the year, with a constant 22.8 second offset left over. Matching a real
 * sundial to the second would need ERA, precession-nutation and UT1, none of which this engine
 * carries and none of which the other 31 bodies need, so the constant is pinned by a test
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
import { J2000_JD, epochMsFromJdUtc, utcFromTdb, type JdTdb } from "./time";
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

/**
 * Where on the body the Sun is directly overhead, right now, or null if the question is empty.
 *
 * Null for the Sun itself, and that is the honest answer rather than a guard clause. The Sun
 * sits at the heliocentric origin, so the direction from it to itself is zero over zero: there
 * is no sub-solar point on the Sun because there is no sunrise there to measure from.
 *
 * Returning NaN instead, which is what the arithmetic does unaided, crashed the phone. Swift
 * traps on converting a non-finite Double to Int, so a NaN clock killed the app the moment
 * anyone pressed Solar system, while the website carried the same NaN to the screen and merely
 * printed nonsense. The conformance missed it because the generator skipped the Sun.
 */
export function subSolarPoint(body: BodyId, epoch: JdTdb): SubSolarPoint | null {
  const position = heliocentricPositionOf(body, epoch);
  if (Math.hypot(position.x, position.y, position.z) === 0) return null;

  // Light time is ignored deliberately: it shifts the sub-solar point by under an arcsecond of
  // longitude, which is a fraction of a second on any clock here.
  const toSun = normalise(eclipticToEquatorial({
    x: -position.x, y: -position.y, z: -position.z,
  }));

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
export function solarClock(body: BodyId, epoch: JdTdb): SolarClock | null {
  const subSolar = subSolarPoint(body, epoch);
  if (subSolar === null) return null;
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
  /**
   * Normalised away from negative zero, which JavaScript has and Swift does not.
   *
   * `Math.round(-0.3)` is -0, and `(-0).toLocaleString()` prints "-0", so the day before the
   * epoch read "day -0" in a browser and "day 0" on a phone. The conformance caught it; the
   * screen would have shown it to someone eventually.
   */
  const dayNumber = Math.round(elapsedSols - hours / 24) + 0;

  // Belt and braces after the crash above. Nothing should reach here non-finite now, and a
  // wrong number on a panel is still better than a trap on a phone.
  if (!Number.isFinite(hours) || !Number.isFinite(dayNumber)) return null;

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

/**
 * The date and time where that body is, now, as a label can carry it.
 *
 * Asked for after the first attempt showed how long a day and a year last there, which is a
 * fact about the body and not a clock: "i expect it to say year 2026 and month etc and
 * increase by the time setting". So this is the reading, and it moves when the clock does.
 *
 * Earth gets the calendar, because Earth has one. Nowhere else does. A date is a count of days
 * into a year with names agreed by people who live there, and the only body with people on it
 * has already agreed them, so inventing Martian months would be making something up and
 * printing it next to measured figures. What every body does have is a count of its own days
 * and a time of day at its prime meridian, which is exactly what Mars missions run on: sols
 * since a fixed epoch, and the clock at Airy-0. That generalises honestly to all 32.
 *
 * Null for the Sun, which has no sunrise to count from.
 */
/**
 * The zone an Earth time is quoted in.
 *
 * A time with no zone on it is not a time, it is a number that looks like one. The engine
 * cannot read a device's clock and must stay a pure function to be gated, so the client passes
 * the zone in and the arithmetic lives here. `offsetMinutes` is for the instant being shown,
 * not for now, which is what makes a date in July come out right when it is read in January.
 */
export interface EarthZone {
  readonly offsetMinutes: number;
  /** As a person writes it: "UTC", "GMT", "EST", "+05:30". */
  readonly label: string;
}

export const UTC: EarthZone = { offsetMinutes: 0, label: "UTC" };

export function localTimeLabel(
  body: BodyId,
  epoch: JdTdb,
  zone: EarthZone = UTC,
): string | null {
  const clock = solarClock(body, epoch);
  if (clock === null) return null;

  if (body === "embary") {
    // Earth's civil time, which is what the clock at the bottom of the screen already shows.
    /**
     * Snapped to the second before truncating to the minute.
     *
     * The round trip through TDB is good to about four microseconds, and truncation turns
     * four microseconds short of a minute into a whole minute lost: an exact 00:01:00 came
     * back as 00:00:59.999996 and displayed as 00:00. Rounding away float noise is not the
     * same as inventing precision.
     */
    const ms = Math.round(epochMsFromJdUtc(utcFromTdb(epoch)) / 1000) * 1000;
    // Shifted by the offset and then read back as UTC, which is how you format an instant in
    // another zone without a timezone database: move the instant, not the formatter.
    const shifted = new Date(ms + zone.offsetMinutes * 60_000);
    return `${shifted.toISOString().slice(0, 16).replace("T", " ")} ${zone.label}`;
  }

  const hhmm = clock.formatted.slice(0, 5);
  return `day ${clock.dayNumber.toLocaleString()} · ${hhmm}`;
}

/**
 * How high the Sun is above the horizon at a point on a body, in degrees.
 *
 * Negative means below it, so this is the whole answer to "is it night there" rather than an
 * approximation of one. Computed from the sub-solar point, which carries the Sun's declination
 * as well as its longitude, so it is right at the poles and right in winter: a guess made from
 * longitude alone says the Sun is up over Tromsø at midday in December, and it is not.
 *
 * Geometric, with no correction for refraction or for the Sun's half-degree width, which
 * together lift the apparent sunrise about 0.83 degrees earlier than this reports. That
 * matters within a few minutes of sunrise and nowhere else, and naming the limit is better
 * than pretending to a precision the question does not have.
 */
export function solarAltitudeDeg(
  body: BodyId,
  epoch: JdTdb,
  latitudeDeg: number,
  longitudeDeg: number,
): number | null {
  const subSolar = subSolarPoint(body, epoch);
  if (subSolar === null) return null;

  const toRad = Math.PI / 180;
  const lat = latitudeDeg * toRad;
  const dec = subSolar.latitudeDeg * toRad;
  // The hour angle is how far round the body you are from the point the Sun is over.
  const hourAngle = (longitudeDeg - subSolar.longitudeDeg) * toRad;

  const sinAltitude =
    Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(hourAngle);
  return Math.asin(Math.max(-1, Math.min(1, sinAltitude))) / toRad;
}

/**
 * Apparent solar time at a point, in hours, or null where there is no sunrise to count from.
 *
 * The reason a time zone is worth explaining. Civil time is a decision taken by a government
 * for a whole country at once; this is what the Sun is actually doing at that spot. Madrid
 * keeps the same clock as Warsaw and sits nineteen degrees west of it, so its noon arrives an
 * hour and a quarter after the clock says so, which is the whole lesson in one row.
 */
export function solarTimeHoursAt(
  body: BodyId,
  epoch: JdTdb,
  longitudeDeg: number,
): number | null {
  const clock = solarClock(body, epoch);
  if (clock === null) return null;
  const sense = BODY_CONTRACTS[body].rotation.rotationRateDegPerDay < 0 ? -1 : 1;
  const hours = clock.hours + (sense * longitudeDeg * 24) / 360;
  return ((hours % 24) + 24) % 24;
}
