/**
 * Time scales for the engine.
 *
 * Three Julian Dates that look identical as floats and mean different things: UTC (what a
 * clock says, with leap seconds), TT (Terrestrial Time, the uniform scale ephemerides are
 * tabulated against), and TDB (Barycentric Dynamical Time, TT plus a periodic relativistic
 * term). Feeding a JD-UTC into an algorithm that wants JD-TDB is a ~70 second error, which is
 * 2000 km of Earth's orbit, so the three are separate branded types and the compiler refuses
 * to swap them.
 *
 * Leap-second table source, checked 2026-10-27:
 * https://data.iana.org/time-zones/data/leap-seconds.list, whose header states it is "Updated
 * through IERS Bulletin C" (https://hpiers.obspm.fr/iers/bul/bulc/bulletinc.dat) and gives an
 * expiry of 28 June 2027. It lists 28 step points: TAI-UTC = 10 s at the 1972-01-01 start of
 * the integer-offset UTC system, then 27 inserted leap seconds from 1972-07-01 through
 * 2017-01-01, reaching the 37 s in force today.
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

/** 2000-01-01 12:00:00 TT, the epoch the Standish element tables are referenced to. */
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

/** Julian years (365.25 d), accurate to a day, which is all `modelForYear` needs. */
export function julianYearForModelSelection(jd: JdTdb): number {
  return 2000 + (jd - J2000_JD) / 365.25;
}

export function jdUtcFromEpochMs(ms: number): JdUtc {
  return jdUtc(UNIX_EPOCH_JD + ms / (SECONDS_PER_DAY * 1000));
}

export function epochMsFromJdUtc(jd: JdUtc): number {
  return (jd - UNIX_EPOCH_JD) * SECONDS_PER_DAY * 1000;
}

/**
 * `[NTP seconds since 1900-01-01, UTC date, TAI-UTC seconds]`. The first two columns are the
 * same instant stated twice: the NTP integer is verbatim from the IERS file so a reviewer can
 * diff the rows against it, and the date is the human-readable form. `toLeapStep` requires
 * them to agree, so a mistranscribed row fails at import rather than shifting time by a day.
 */
const LEAP_SECOND_STEPS: readonly (readonly [number, string, number])[] = [
  [2272060800, "1972-01-01", 10],
  [2287785600, "1972-07-01", 11],
  [2303683200, "1973-01-01", 12],
  [2335219200, "1974-01-01", 13],
  [2366755200, "1975-01-01", 14],
  [2398291200, "1976-01-01", 15],
  [2429913600, "1977-01-01", 16],
  [2461449600, "1978-01-01", 17],
  [2492985600, "1979-01-01", 18],
  [2524521600, "1980-01-01", 19],
  [2571782400, "1981-07-01", 20],
  [2603318400, "1982-07-01", 21],
  [2634854400, "1983-07-01", 22],
  [2698012800, "1985-07-01", 23],
  [2776982400, "1988-01-01", 24],
  [2840140800, "1990-01-01", 25],
  [2871676800, "1991-01-01", 26],
  [2918937600, "1992-07-01", 27],
  [2950473600, "1993-07-01", 28],
  [2982009600, "1994-07-01", 29],
  [3029443200, "1996-01-01", 30],
  [3076704000, "1997-07-01", 31],
  [3124137600, "1999-01-01", 32],
  [3345062400, "2006-01-01", 33],
  [3439756800, "2009-01-01", 34],
  [3550089600, "2012-07-01", 35],
  [3644697600, "2015-07-01", 36],
  [3692217600, "2017-01-01", 37],
];

interface LeapStep {
  readonly fromJdUtc: JdUtc;
  readonly taiMinusUtcSeconds: number;
}

function toLeapStep(row: readonly [number, string, number]): LeapStep {
  const [ntpSeconds, utcDate, offset] = row;
  const fromNtp = NTP_EPOCH_JD + ntpSeconds / SECONDS_PER_DAY;
  const fromDate = jdUtcFromEpochMs(Date.parse(`${utcDate}T00:00:00Z`));
  if (fromNtp !== fromDate) {
    throw new Error(
      `Leap-second row ${utcDate} is JD ${fromDate}, but its NTP timestamp ${ntpSeconds} is JD ${fromNtp}`,
    );
  }
  return { fromJdUtc: jdUtc(fromNtp), taiMinusUtcSeconds: offset };
}

const LEAP_STEPS: readonly LeapStep[] = LEAP_SECOND_STEPS.map(toLeapStep);
const FIRST_LEAP_STEP = LEAP_STEPS[0];

/**
 * TAI - UTC at an instant, in seconds.
 *
 * Before 1972-01-01 UTC had no integer offset at all: it ran on "rubber seconds", a set of
 * per-interval rate and offset formulas, so no single number is right there. Earlier instants
 * get the 1972 value. Code that needs a pre-1972 instant should carry TT or TDB directly.
 */
export function taiMinusUtcSeconds(jd: JdUtc): number {
  let offset = FIRST_LEAP_STEP.taiMinusUtcSeconds;
  for (const step of LEAP_STEPS) {
    if (jd < step.fromJdUtc) break;
    offset = step.taiMinusUtcSeconds;
  }
  return offset;
}

const ttMinusUtcDays = (taiMinusUtc: number): number =>
  (taiMinusUtc + TT_MINUS_TAI_SECONDS) / SECONDS_PER_DAY;

export function ttFromUtc(jd: JdUtc): JdTt {
  return jdTt(jd + ttMinusUtcDays(taiMinusUtcSeconds(jd)));
}

export function utcFromTt(jd: JdTt): JdUtc {
  for (let i = LEAP_STEPS.length - 1; i >= 0; i -= 1) {
    const step = LEAP_STEPS[i];
    const candidate = jdUtc(jd - ttMinusUtcDays(step.taiMinusUtcSeconds));
    if (candidate >= step.fromJdUtc) return candidate;
  }
  return jdUtc(jd - ttMinusUtcDays(FIRST_LEAP_STEP.taiMinusUtcSeconds));
}

/**
 * TDB - TT in seconds, the first-order form from the Astronomical Almanac: the annual term
 * from the Earth's eccentric orbit plus its first harmonic. Its 1.66 ms peak is 50 m of
 * Earth's orbital motion, well below anything this engine claims, but it is included so that
 * `tdbFromTt` is a real conversion rather than an identity wearing a different brand.
 *
 * The argument is a day count rather than a branded date because the term's own rate is under
 * 1e-10 s/s, so it does not matter which of TT or TDB the count is measured on.
 */
function tdbMinusTtSecondsAt(daysSinceJ2000: number): number {
  const anomaly = toRadians(deg(357.53 + 0.985_600_28 * daysSinceJ2000));
  return 0.001_658 * Math.sin(anomaly) + 0.000_014 * Math.sin(2 * anomaly);
}

export function tdbMinusTtSeconds(jd: JdTt): number {
  return tdbMinusTtSecondsAt(jd - J2000_JD);
}

export function tdbFromTt(jd: JdTt): JdTdb {
  return jdTdb(jd + tdbMinusTtSecondsAt(jd - J2000_JD) / SECONDS_PER_DAY);
}

export function ttFromTdb(jd: JdTdb): JdTt {
  return jdTt(jd - tdbMinusTtSecondsAt(jd - J2000_JD) / SECONDS_PER_DAY);
}

export function tdbFromUtc(jd: JdUtc): JdTdb {
  return tdbFromTt(ttFromUtc(jd));
}

export function utcFromTdb(jd: JdTdb): JdUtc {
  return utcFromTt(ttFromTdb(jd));
}
