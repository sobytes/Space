/**
 * Time scales for the engine.
 *
 * Three Julian Dates that look identical as floats and mean different things: UTC (what a
 * clock says, with leap seconds), TT (Terrestrial Time, the uniform scale ephemerides are
 * tabulated against), and TDB (Barycentric Dynamical Time, TT plus a periodic relativistic
 * term under 2 ms). Feeding a JD-UTC into an algorithm that wants JD-TDB is a ~70 second
 * error, which is 30 arcseconds of lunar motion and 2000 km of Earth's orbit. So the three
 * are separate branded types here and the compiler refuses to swap them.
 *
 * Leap-second table source, checked 2026-10-27:
 * https://data.iana.org/time-zones/data/leap-seconds.list, whose own header states it is
 * "Updated through IERS Bulletin C" (https://hpiers.obspm.fr/iers/bul/bulc/bulletinc.dat)
 * and gives an expiry of 28 June 2027, so TAI-UTC = 37 s is current as of that check. The
 * file lists 28 step points: TAI-UTC = 10 s at the 1972-01-01 start of the integer-offset
 * UTC system, then 27 inserted leap seconds from 1972-07-01 through 2017-01-01. The rows
 * below are copied in that file's own units (NTP seconds since 1900-01-01) so a reviewer
 * can diff them against it line by line.
 */

import { DAYS_PER_JULIAN_CENTURY, SECONDS_PER_DAY, deg, toRadians } from "./units";

declare const TIME_SCALE: unique symbol;

type JulianDateIn<Scale extends string> = number & { readonly [TIME_SCALE]: Scale };

/** Julian Date on the UTC scale. Only meaningful from 1972 onwards; see `taiMinusUtcSeconds`. */
export type JdUtc = JulianDateIn<"UTC">;
/** Julian Date on the Terrestrial Time scale. */
export type JdTt = JulianDateIn<"TT">;
/** Julian Date on the Barycentric Dynamical Time scale. Ephemeris arguments live here. */
export type JdTdb = JulianDateIn<"TDB">;

export const jdUtc = (v: number) => v as JdUtc;
export const jdTt = (v: number) => v as JdTt;
export const jdTdb = (v: number) => v as JdTdb;

/** 2000-01-01 12:00:00 TT, the epoch every element table below is referenced to. */
export const J2000_JD = 2451545.0;

/** 1970-01-01 00:00:00 UTC, the zero of `Date.prototype.getTime`. */
export const UNIX_EPOCH_JD = 2440587.5;

/** 1900-01-01 00:00:00 UTC, the zero of the NTP timestamps in the IERS leap-second file. */
export const NTP_EPOCH_JD = 2415020.5;

/** TT - TAI, fixed by the IAU at exactly this value. */
export const TT_MINUS_TAI_SECONDS = 32.184;

export function julianCenturiesSinceJ2000(jd: JdTdb): number {
  return (jd - J2000_JD) / DAYS_PER_JULIAN_CENTURY;
}

/**
 * A Julian-year number (365.25 d) for selecting a model validity window. Not a calendar
 * date: it drifts up to a day from the Gregorian year boundary, which does not matter when
 * the window edges being tested are 1800 and 2050.
 */
export function approximateJulianYear(jd: JdTdb): number {
  return 2000 + (jd - J2000_JD) / 365.25;
}

export function jdUtcFromEpochMs(ms: number): JdUtc {
  return jdUtc(UNIX_EPOCH_JD + ms / (SECONDS_PER_DAY * 1000));
}

export function epochMsFromJdUtc(jd: JdUtc): number {
  return (jd - UNIX_EPOCH_JD) * SECONDS_PER_DAY * 1000;
}

/** `[NTP seconds since 1900-01-01, TAI-UTC in seconds]`, verbatim from the IERS file. */
const LEAP_SECOND_STEPS: readonly (readonly [number, number])[] = [
  [2272060800, 10], // 1972-01-01
  [2287785600, 11], // 1972-07-01
  [2303683200, 12], // 1973-01-01
  [2335219200, 13], // 1974-01-01
  [2366755200, 14], // 1975-01-01
  [2398291200, 15], // 1976-01-01
  [2429913600, 16], // 1977-01-01
  [2461449600, 17], // 1978-01-01
  [2492985600, 18], // 1979-01-01
  [2524521600, 19], // 1980-01-01
  [2571782400, 20], // 1981-07-01
  [2603318400, 21], // 1982-07-01
  [2634854400, 22], // 1983-07-01
  [2698012800, 23], // 1985-07-01
  [2776982400, 24], // 1988-01-01
  [2840140800, 25], // 1990-01-01
  [2871676800, 26], // 1991-01-01
  [2918937600, 27], // 1992-07-01
  [2950473600, 28], // 1993-07-01
  [2982009600, 29], // 1994-07-01
  [3029443200, 30], // 1996-01-01
  [3076704000, 31], // 1997-07-01
  [3124137600, 32], // 1999-01-01
  [3345062400, 33], // 2006-01-01
  [3439756800, 34], // 2009-01-01
  [3550089600, 35], // 2012-07-01
  [3644697600, 36], // 2015-07-01
  [3692217600, 37], // 2017-01-01
];

interface LeapStep {
  readonly fromJdUtc: JdUtc;
  readonly taiMinusUtcSeconds: number;
}

const LEAP_STEPS: readonly LeapStep[] = LEAP_SECOND_STEPS.map(([ntpSeconds, offset]) => ({
  fromJdUtc: jdUtc(NTP_EPOCH_JD + ntpSeconds / SECONDS_PER_DAY),
  taiMinusUtcSeconds: offset,
}));

const FIRST_LEAP_STEP = LEAP_STEPS[0];
const LATEST_LEAP_STEP = LEAP_STEPS[LEAP_STEPS.length - 1];

/**
 * TAI - UTC at an instant, in seconds.
 *
 * Before 1972-01-01 UTC had no integer offset at all: it ran on "rubber seconds", a set of
 * per-interval rate and offset formulas, so no single number is right there. This returns
 * the 1972 value of 10 s for earlier instants rather than pretending otherwise. Code that
 * needs a pre-1972 instant should carry TT or TDB directly instead of routing through UTC.
 */
export function taiMinusUtcSeconds(jd: JdUtc): number {
  let offset = FIRST_LEAP_STEP.taiMinusUtcSeconds;
  for (const step of LEAP_STEPS) {
    if (jd < step.fromJdUtc) break;
    offset = step.taiMinusUtcSeconds;
  }
  return offset;
}

export function ttFromUtc(jd: JdUtc): JdTt {
  const offset = taiMinusUtcSeconds(jd) + TT_MINUS_TAI_SECONDS;
  return jdTt(jd + offset / SECONDS_PER_DAY);
}

/**
 * The leap-second table is keyed in UTC, so inverting needs a fixed point. The offset is a
 * step function, so one refinement from the latest offset lands on the right step unless the
 * instant is inside the ~70 second window straddling a leap insertion, where UTC is ambiguous
 * anyway.
 */
export function utcFromTt(jd: JdTt): JdUtc {
  let guess = jdUtc(jd - (LATEST_LEAP_STEP.taiMinusUtcSeconds + TT_MINUS_TAI_SECONDS) / SECONDS_PER_DAY);
  for (let i = 0; i < 2; i += 1) {
    const offset = taiMinusUtcSeconds(guess) + TT_MINUS_TAI_SECONDS;
    guess = jdUtc(jd - offset / SECONDS_PER_DAY);
  }
  return guess;
}

/**
 * TDB - TT in seconds, the first-order form from the Astronomical Almanac: the dominant
 * annual term from the Earth's eccentric orbit plus its first harmonic. Peak amplitude
 * 1.66 ms, which is 50 m of Earth's orbital motion, so it is far below anything this engine
 * claims. It is implemented rather than skipped because `tdbFromTt` returning its argument
 * unchanged would make the TDB brand a lie, and because it is two lines.
 */
export function tdbMinusTtSeconds(jd: JdTt): number {
  const g = toRadians(deg(357.53 + 0.985_600_28 * (jd - J2000_JD)));
  return 0.001_658 * Math.sin(g) + 0.000_014 * Math.sin(2 * g);
}

export function tdbFromTt(jd: JdTt): JdTdb {
  return jdTdb(jd + tdbMinusTtSeconds(jd) / SECONDS_PER_DAY);
}

/**
 * Evaluates the periodic term at TDB instead of TT. The two differ by under 2 ms, and the
 * term's rate is under 1e-10 s/s, so the resulting error is well under a nanosecond.
 */
export function ttFromTdb(jd: JdTdb): JdTt {
  const approx = jdTt(jd);
  return jdTt(jd - tdbMinusTtSeconds(approx) / SECONDS_PER_DAY);
}

export function tdbFromUtc(jd: JdUtc): JdTdb {
  return tdbFromTt(ttFromUtc(jd));
}

export function utcFromTdb(jd: JdTdb): JdUtc {
  return utcFromTt(ttFromTdb(jd));
}
