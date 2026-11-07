/**
 * How fast the clock may be told to run.
 *
 * Here rather than in either client because the two had drifted: the website offered a
 * century a second and the phone stopped at ten years, so the same control on the same
 * simulation had different ceilings, and the one that was asked for ("can the time go to 100
 * years") already existed on the other client. That is the same failure the conformance suite
 * exists for, so the list is gated by it.
 *
 * The steps are calendar units rather than round powers of ten, because what a viewer is
 * choosing is how much of a planet's motion fits in a second of their time. A month per
 * second is the Moon in a fortnight and Mercury in three seconds; ten to the sixth is nothing
 * anybody can picture.
 */

export interface ClockRate {
  readonly label: string;
  /** Simulated seconds per real second. */
  readonly secondsPerSecond: number;
}

/**
 * A Julian year, 365.25 days, is the unit the rest of the engine runs on, so "1 year/s" here
 * advances the clock by exactly one of the years the element tables are fitted in.
 */
const JULIAN_YEAR_SECONDS = 31_557_600;

export const RATE_PRESETS: readonly ClockRate[] = [
  { label: "real time", secondsPerSecond: 1 },
  { label: "1 min/s", secondsPerSecond: 60 },
  { label: "1 hour/s", secondsPerSecond: 3_600 },
  { label: "1 day/s", secondsPerSecond: 86_400 },
  { label: "1 week/s", secondsPerSecond: 604_800 },
  /**
   * One twelfth of a Julian year, 30.4375 days: the mean calendar month.
   *
   * Not the synodic month, which is 29.53 days and is the Moon's business rather than the
   * calendar's. A control labelled "1 month/s" is read against a calendar, so it steps the
   * calendar's month.
   */
  { label: "1 month/s", secondsPerSecond: 2_629_800 },
  { label: "1 year/s", secondsPerSecond: JULIAN_YEAR_SECONDS },
  { label: "10 years/s", secondsPerSecond: JULIAN_YEAR_SECONDS * 10 },
  /**
   * A hundred years a second, which is the fastest rate the ephemeris can honour for long.
   *
   * Named to continue the ladder rather than as "1 century/s", which is the same number and
   * breaks a progression a reader is already following: one year, ten years, a hundred.
   *
   * The long-span element tables are fitted for 3000 BC to 3000 AD. From now, holding this
   * rate runs out of fitted table in about ten real seconds in either direction, and the
   * clock stops at the edge rather than extrapolating a polynomial past its range. Faster
   * presets would spend almost all of their time clamped, so this is where the list ends.
   */
  { label: "100 years/s", secondsPerSecond: JULIAN_YEAR_SECONDS * 100 },
];
