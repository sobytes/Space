/**
 * Going to a date, and saying how much to trust what you see when you get there.
 *
 * Asked for as "can we work out time from a specific date like a unix timestamp". The whole
 * simulation is already a pure function of one epoch, so the arithmetic was never the hard
 * part: `tdbFromUtc` and friends have existed since the clock did. What was missing was a way
 * in, and the honesty that has to come with it.
 *
 * The honesty is the point. The element tables are fits over a stated window, and the window
 * is not infinite. Standish's short-span table is fitted for 1800 to 2050 and the long-span
 * one for 3000 BC to 3000 AD with wider quoted errors; `modelForYear` already swaps between
 * them, so a date anywhere in that range is answered by the table meant for it. Step outside
 * and the answer is an extrapolation of a polynomial nobody fitted there, which is not a
 * worse answer so much as a different kind of thing. A simulator that silently draws the
 * planets for the year 9000 is lying with a straight face, so this returns the standing of an
 * epoch alongside it and the clients print it.
 */

import { LONG_SPAN, SHORT_SPAN } from "./data/planets";
import {
  jdTdb, jdUtcFromEpochMs, epochMsFromJdUtc, julianYearForModelSelection,
  tdbFromUtc, utcFromTdb, type JdTdb,
} from "./time";

/**
 * Above this magnitude a bare number is read as milliseconds rather than seconds.
 *
 * 1e11 seconds is the year 5138 and 1e11 milliseconds is 1973, so nothing anybody would type
 * is ambiguous: a present-day timestamp is 1.7e9 in seconds or 1.7e12 in milliseconds, three
 * orders of magnitude either side of the line. The resolved date is always shown back, so a
 * wrong guess is visible rather than silent.
 */
export const MILLISECOND_THRESHOLD = 1e11;

/** Seconds or milliseconds since 1970-01-01 UTC, to the epoch the simulation runs on. */
export function epochFromUnixTimestamp(value: number): JdTdb {
  const ms = Math.abs(value) >= MILLISECOND_THRESHOLD ? value : value * 1000;
  return tdbFromUtc(jdUtcFromEpochMs(ms));
}

/** The same, backwards. Seconds, because that is what "a unix timestamp" means unqualified. */
export function unixSecondsFromEpoch(epoch: JdTdb): number {
  return epochMsFromJdUtc(utcFromTdb(epoch)) / 1000;
}

/** An ISO instant, as a browser's date input or a Swift date formatter produces it. */
export function epochFromIsoUtc(iso: string): JdTdb | null {
  const ms = Date.parse(iso.endsWith("Z") || /[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`);
  return Number.isFinite(ms) ? tdbFromUtc(jdUtcFromEpochMs(ms)) : null;
}

export interface EphemerisStanding {
  /** Which fitted table answers for this epoch. */
  readonly model: "short-span" | "long-span";
  /** Whether that table's published validity window actually covers it. */
  readonly inside: boolean;
  readonly year: number;
  /** One line a client can print verbatim. */
  readonly note: string;
}

/**
 * Which table answers for this epoch, and whether it was fitted to.
 *
 * `modelForYear` picks the table; this says what that choice means. Inside the short span the
 * quoted errors are the ones on the accuracy panel. Inside the long span they are wider, by
 * roughly an order of magnitude for the outer planets, and the note says so rather than
 * letting a figure keep its usual error bar when it has not earned it. Outside both, the
 * positions are an extrapolation and the note refuses to dress that up.
 */
export function ephemerisStandingAt(epoch: JdTdb): EphemerisStanding {
  const year = Math.floor(julianYearForModelSelection(epoch));
  const inShort = year >= SHORT_SPAN.validFromYear && year <= SHORT_SPAN.validToYear;
  const inLong = year >= LONG_SPAN.validFromYear && year <= LONG_SPAN.validToYear;

  if (inShort) {
    return {
      model: "short-span",
      inside: true,
      year,
      note: `Positions from the ${SHORT_SPAN.validFromYear} to ${SHORT_SPAN.validToYear} `
        + "element table, which is the one these accuracy figures were measured against.",
    };
  }
  if (inLong) {
    return {
      model: "long-span",
      inside: true,
      year,
      note: "Outside 1800 to 2050, so positions come from the long-span table. It is fitted "
        + "for 3000 BC to 3000 AD and its quoted errors are far wider, by about an order of "
        + "magnitude for the outer planets.",
    };
  }
  return {
    model: "long-span",
    inside: false,
    year,
    note: "Beyond 3000 BC to 3000 AD, which no table here was fitted for. The planets are "
      + "still drawn, by extrapolating a polynomial past its range, and where they are shown "
      + "is not where they were.",
  };
}

/** The furthest out a date may be set while still being answered by a fitted table. */
export const SUPPORTED_YEARS = {
  from: LONG_SPAN.validFromYear,
  to: LONG_SPAN.validToYear,
} as const;

/** Clamp into the fitted range, for a control that should not offer a meaningless answer. */
export function clampToSupported(epoch: JdTdb): JdTdb {
  const year = julianYearForModelSelection(epoch);
  if (year >= SUPPORTED_YEARS.from && year <= SUPPORTED_YEARS.to) return epoch;
  // One Julian year is 365.25 days and J2000 is at year 2000.0, which is all the inverse needs.
  const target = year < SUPPORTED_YEARS.from ? SUPPORTED_YEARS.from : SUPPORTED_YEARS.to;
  return jdTdb(2_451_545.0 + (target - 2000) * 365.25);
}
