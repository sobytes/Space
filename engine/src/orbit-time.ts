/**
 * How long it takes to get anywhere on a drawn orbit.
 *
 * An orbit path says where a body goes and says nothing at all about when, which is half the
 * point of watching one. Asked for directly: a view of the Moon's orbit with no concept of
 * time in it, and the observation that the app can work the timing out properly, so it should.
 *
 * The answer is to put marks along the path at equal intervals of time, counted from the
 * current epoch. That makes three things readable at once. Where the body is now. Where it
 * will be in a stated number of days. And, because the marks are equally spaced in time and
 * therefore unequally spaced along the path, how much faster it moves near periapsis: the
 * marks crowd where Kepler's second law says they must, and that is measured here rather than
 * drawn as an illustration.
 *
 * What lives in this module is only the decision that both clients have to agree on, which is
 * the interval and what to call it. Each client samples its own ephemeris at the epochs this
 * returns, so the marks sit on the path that client actually drew, and the `orbit-time`
 * conformance domain holds the two to the same answer. The alternative, each client picking
 * its own tick spacing, is exactly how the marker threshold once came to exist on the web and
 * not on the phone.
 */

import { SECONDS_PER_DAY, DAYS_PER_JULIAN_YEAR } from "./units";
import type { JdTdb } from "./time";
import { jdTdb } from "./time";

const HOUR = 3_600;
const DAY = SECONDS_PER_DAY;
const YEAR = DAYS_PER_JULIAN_YEAR * SECONDS_PER_DAY;

/**
 * The intervals a mark is allowed to represent, shortest first.
 *
 * Round numbers of familiar units, not a computed subdivision of the period. "One mark every
 * 2.276 days" is the kind of label that is technically derived from the orbit and useless to
 * read; "one mark every 2 days" is a thing a person can count in their head. The cost is that
 * the marks do not divide the orbit a whole number of times, which is correct anyway: nothing
 * says an orbital period is a whole number of days, and pretending otherwise would hide that
 * the Moon's month is 27.32 days and not 28.
 */
export const MARK_INTERVALS: readonly { readonly seconds: number; readonly label: string }[] = [
  { seconds: HOUR, label: "1 hour" },
  { seconds: 3 * HOUR, label: "3 hours" },
  { seconds: 6 * HOUR, label: "6 hours" },
  { seconds: 12 * HOUR, label: "12 hours" },
  { seconds: DAY, label: "1 day" },
  { seconds: 2 * DAY, label: "2 days" },
  { seconds: 5 * DAY, label: "5 days" },
  { seconds: 10 * DAY, label: "10 days" },
  { seconds: 15 * DAY, label: "15 days" },
  { seconds: 30 * DAY, label: "30 days" },
  { seconds: 90 * DAY, label: "90 days" },
  { seconds: 180 * DAY, label: "180 days" },
  { seconds: YEAR, label: "1 year" },
  { seconds: 2 * YEAR, label: "2 years" },
  { seconds: 5 * YEAR, label: "5 years" },
  { seconds: 10 * YEAR, label: "10 years" },
  { seconds: 25 * YEAR, label: "25 years" },
  { seconds: 50 * YEAR, label: "50 years" },
  { seconds: 100 * YEAR, label: "100 years" },
];

/**
 * The most marks an orbit may carry.
 *
 * Above roughly this many the marks stop being countable and become a dotted line, which
 * conveys less than the plain line did. Phobos at 7.65 hours gets eight marks an orbit and
 * Neptune at 165 years gets seventeen, so one rule covers five orders of magnitude of period.
 */
export const MAX_MARKS = 24;

export interface MarkInterval {
  readonly seconds: number;
  /** For a legend: "one mark every 2 days". Never a derived fraction of the period. */
  readonly label: string;
  /** How many marks fit in one orbit. Fractional, because periods are not whole units. */
  readonly marksPerOrbit: number;
}

/**
 * The finest round interval that does not exceed `MAX_MARKS` marks in one orbit.
 *
 * Finest rather than nearest-to-a-target, so the answer only ever moves one step as a period
 * changes, and two bodies with similar periods cannot land on wildly different spacings.
 */
export function markIntervalFor(periodDays: number): MarkInterval {
  const periodSeconds = Math.abs(periodDays) * SECONDS_PER_DAY;
  const chosen =
    MARK_INTERVALS.find((candidate) => periodSeconds / candidate.seconds <= MAX_MARKS)
    // A period longer than a century of marks still has to render something, and the coarsest
    // interval with too many marks beats no marks at all.
    ?? MARK_INTERVALS[MARK_INTERVALS.length - 1];

  return {
    seconds: chosen.seconds,
    label: chosen.label,
    marksPerOrbit: periodSeconds / chosen.seconds,
  };
}

export interface OrbitTimeMark {
  /** The epoch to sample the body at. */
  readonly epoch: JdTdb;
  /** Whole intervals ahead of now. 0 is the body's current position. */
  readonly index: number;
  readonly secondsFromNow: number;
}

/**
 * The epochs to put marks at, starting from now and going one full orbit forward.
 *
 * Anchored to the current epoch rather than to a fixed reference, so mark zero is always the
 * body itself and every other mark answers "and where will it be in n of these". The whole
 * set slides along the path as the clock runs, which is the behaviour that makes it a clock
 * rather than a ruler.
 *
 * Forward only. A mark behind the body is where it has already been, and drawing the past and
 * the future identically makes the direction of travel unreadable.
 */
export function orbitTimeMarks(periodDays: number, now: JdTdb): {
  readonly interval: MarkInterval;
  readonly marks: readonly OrbitTimeMark[];
} {
  const interval = markIntervalFor(periodDays);
  const periodSeconds = Math.abs(periodDays) * SECONDS_PER_DAY;
  // Strictly inside one period: a mark at exactly one period would sit on top of mark zero.
  const count = Math.min(MAX_MARKS, Math.max(1, Math.ceil(periodSeconds / interval.seconds)));

  const marks: OrbitTimeMark[] = [];
  for (let index = 0; index < count; index++) {
    const secondsFromNow = index * interval.seconds;
    if (index > 0 && secondsFromNow >= periodSeconds) break;
    marks.push({
      epoch: jdTdb(now + secondsFromNow / SECONDS_PER_DAY),
      index,
      secondsFromNow,
    });
  }
  return { interval, marks };
}
