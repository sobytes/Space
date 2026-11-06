import { describe, expect, it } from "vitest";
import { BODY_CONTRACTS, BODY_IDS } from "./bodies/registry";
import { MARK_INTERVALS, MAX_MARKS, markIntervalFor, orbitTimeMarks } from "./orbit-time";
import { jdTdb } from "./time";
import { SECONDS_PER_DAY } from "./units";

const J2000 = jdTdb(2_451_545.0);

/** Real periods, so the chosen intervals are checked against bodies that exist. */
const PERIODS: readonly (readonly [string, number, string])[] = [
  ["Phobos", 0.31891, "1 hour"],
  ["Io", 1.769138, "3 hours"],
  ["Triton", 5.876854, "6 hours"],
  ["the Moon", 27.321582, "2 days"],
  ["Mercury", 87.9691, "5 days"],
  ["Iapetus", 79.3215, "5 days"],
  ["Earth", 365.256, "30 days"],
  ["Mars", 686.98, "30 days"],
  ["Jupiter", 4332.589, "1 year"],
  ["Neptune", 60_190, "10 years"],
];

describe("how long a mark is worth", () => {
  it.each(PERIODS)("gives %s marks every %s", (_name, periodDays, label) => {
    expect(markIntervalFor(periodDays).label).toBe(label);
  });

  it.each(PERIODS)("never exceeds the mark budget for %s", (_name, periodDays) => {
    expect(markIntervalFor(periodDays).marksPerOrbit).toBeLessThanOrEqual(MAX_MARKS);
  });

  /**
   * The interval has to be the finest that fits, not merely one that fits.
   *
   * Without this the coarsest interval in the ladder passes every other test in this file
   * while giving Phobos one mark a century, which is a correct answer to the wrong question.
   */
  it.each(PERIODS)("uses the finest interval that fits for %s", (_name, periodDays) => {
    const chosen = markIntervalFor(periodDays);
    const periodSeconds = periodDays * SECONDS_PER_DAY;
    // Every finer rung must overflow the budget. That is what "finest that fits" means, and
    // checking it against the ladder rather than against a doubling is what matters: the
    // rungs are round units, so 180 days to 1 year is a factor of 2.03 and not 2.
    for (const rung of MARK_INTERVALS) {
      if (rung.seconds >= chosen.seconds) continue;
      expect(periodSeconds / rung.seconds, `${rung.label} should not fit`)
        .toBeGreaterThan(MAX_MARKS);
    }
  });

  it("holds every real body in the registry inside the budget", () => {
    const periods = BODY_IDS.flatMap((id) => {
      const { ephemeris } = BODY_CONTRACTS[id];
      return ephemeris.kind === "mean-elements-about-parent" ? [ephemeris.periodDays] : [];
    });
    expect(periods.length).toBeGreaterThan(15);
    for (const period of periods) {
      expect(markIntervalFor(period).marksPerOrbit).toBeLessThanOrEqual(MAX_MARKS);
    }
  });
});

describe("where the marks go", () => {
  it("puts the first mark on the body itself, now", () => {
    const { marks } = orbitTimeMarks(27.321582, J2000);
    expect(marks[0].index).toBe(0);
    expect(marks[0].secondsFromNow).toBe(0);
    expect(marks[0].epoch).toBe(J2000);
  });

  it("spaces them by exactly the interval", () => {
    const { interval, marks } = orbitTimeMarks(27.321582, J2000);
    for (let i = 1; i < marks.length; i++) {
      expect(marks[i].secondsFromNow - marks[i - 1].secondsFromNow).toBeCloseTo(
        interval.seconds,
        6,
      );
    }
  });

  it("stops short of a full orbit, so the last mark never lands on the first", () => {
    for (const [, periodDays] of PERIODS) {
      const { marks } = orbitTimeMarks(periodDays, J2000);
      const last = marks[marks.length - 1].secondsFromNow;
      expect(last).toBeLessThan(periodDays * SECONDS_PER_DAY);
    }
  });

  it("goes forward only, because the past and the future must not look alike", () => {
    const { marks } = orbitTimeMarks(365.256, J2000);
    expect(marks.every((m) => m.secondsFromNow >= 0)).toBe(true);
  });

  it("slides with the clock rather than staying put", () => {
    const later = jdTdb(J2000 + 3);
    const a = orbitTimeMarks(27.321582, J2000);
    const b = orbitTimeMarks(27.321582, later);
    expect(b.marks[0].epoch).toBe(later);
    expect(b.marks[0].epoch - a.marks[0].epoch).toBeCloseTo(3, 9);
  });

  it("never returns more marks than the budget", () => {
    for (const [, periodDays] of PERIODS) {
      expect(orbitTimeMarks(periodDays, J2000).marks.length).toBeLessThanOrEqual(MAX_MARKS);
    }
  });
});
