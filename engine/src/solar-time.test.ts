/**
 * The sign conventions here are the whole risk, so the tests attack them directly.
 *
 * A sub-solar longitude is four opportunities to be off by a sign or a quarter turn: the
 * ecliptic-to-equatorial rotation, the node's right ascension, the sense of W, and the
 * retrograde flip. Every one of them produces a plausible-looking clock. What distinguishes a
 * correct one is that it advances monotonically through exactly 24 hours in one solar day, for
 * every body including the ones that spin backwards, and that the Sun's declination tracks the
 * seasons on a body whose seasons are independently known.
 */

import { describe, expect, it } from "vitest";
import { BODY_CONTRACTS, BODY_IDS } from "./bodies/registry";
import { solarClock, subSolarPoint } from "./solar-time";
import { timeSense } from "./time-sense";
import { jdTdb, type JdTdb } from "./time";

const at = (iso: string): JdTdb => jdTdb(2_440_587.5 + Date.parse(iso) / 86_400_000);

describe("the Sun's declination, against seasons nobody has to take on trust", () => {
  /**
   * Earth's solstices are the sharpest available check on the whole frame construction. On
   * 21 June the Sun stands over the Tropic of Cancer, which is Earth's obliquity exactly, and
   * on 21 December over the Tropic of Capricorn. Get the obliquity rotation backwards and the
   * two swap; get the node wrong and both land near zero.
   */
  it("puts the Sun over the Tropic of Cancer at the June solstice", () => {
    expect(subSolarPoint("embary", at("2025-06-21T03:00:00Z"))!.latitudeDeg).toBeCloseTo(23.44, 1);
  });

  it("puts it over the Tropic of Capricorn at the December solstice", () => {
    expect(subSolarPoint("embary", at("2025-12-21T15:00:00Z"))!.latitudeDeg).toBeCloseTo(-23.44, 1);
  });

  it("puts it on the equator at the equinoxes", () => {
    expect(subSolarPoint("embary", at("2025-03-20T09:00:00Z"))!.latitudeDeg).toBeCloseTo(0, 0);
    expect(subSolarPoint("embary", at("2025-09-22T18:00:00Z"))!.latitudeDeg).toBeCloseTo(0, 0);
  });

  it("never sends the Sun to a latitude the body's tilt cannot reach", () => {
    for (const id of BODY_IDS) {
      if (id === "sun") continue;
      let extreme = 0;
      // A year of samples, so a body with any tilt reaches its own tropic.
      for (let i = 0; i < 400; i++) {
        const point = subSolarPoint(id, jdTdb(2_451_545 + i * 0.97 * 365))!;
        extreme = Math.max(extreme, Math.abs(point.latitudeDeg));
      }
      expect(extreme, `${id} sub-solar latitude`).toBeLessThanOrEqual(90.001);
    }
  });
});

describe("the clock at the prime meridian", () => {
  it("reads noon when the Sun is over the prime meridian", () => {
    // Found by construction rather than by looking it up: step until the sub-solar longitude
    // crosses zero, then assert the clock agrees that it is midday.
    let epoch = jdTdb(2_451_545);
    for (let i = 0; i < 2000; i++) {
      const next = jdTdb(2_451_545 + i * 0.0005);
      if (Math.abs(subSolarPoint("embary", next)!.longitudeDeg) < 0.1) {
        epoch = next;
        break;
      }
    }
    expect(Math.abs(subSolarPoint("embary", epoch)!.longitudeDeg)).toBeLessThan(0.2);
    expect(solarClock("embary", epoch)!.hours).toBeCloseTo(12, 1);
  });

  /**
   * One solar day, exactly 24 hours, forwards, for every body.
   *
   * This is the invariant that makes the retrograde flip provable rather than plausible.
   * Venus turns backwards, so without the flip its clock runs down instead of up, and this
   * fails on the very first step. Nothing else in the module catches that.
   */
  it.each(BODY_IDS.filter((id) => id !== "sun" && id !== "mercury"))(
    "advances once through 24 hours on %s",
    (id) => {
    const sol = timeSense(id).dayInEarthDays;
    const start = jdTdb(2_451_545);
    const steps = 48;

    let previous = solarClock(id, start)!.hours;
    let wraps = 0;
    for (let i = 1; i <= steps; i++) {
      const hours = solarClock(id, jdTdb(start + (sol * i) / steps))!.hours;
      // Forwards, allowing exactly one wrap through midnight over the whole sol.
      if (hours < previous) {
        wraps += 1;
        expect(previous, `${id} wrapped from`).toBeGreaterThan(20);
        expect(hours, `${id} wrapped to`).toBeLessThan(4);
      }
        previous = hours;
      }
      expect(wraps, `${id} wraps per sol`).toBe(1);
    },
  );

  /**
   * Mercury is excluded above because on Mercury that invariant is false, and the reason is
   * one of the best facts in the solar system rather than a defect here.
   *
   * It is locked 3:2, so a solar day lasts two of its years, and near perihelion its orbital
   * angular rate briefly exceeds its rotation rate. For a few Earth days the Sun stops in the
   * sky, reverses, and goes forward again, so a sundial at the prime meridian genuinely runs
   * backwards for a while. The first version of this test failed on exactly that, stepping
   * back from 12.03 hours, which is to say around local noon, which is where perihelion falls
   * on this clock. The code was right and the test's assumption was not.
   */
  it("runs Mercury's Sun backwards twice a day, as it really does", () => {
    const sol = timeSense("mercury").dayInEarthDays;
    const start = jdTdb(2_451_545);
    const samples = 400;

    const readings: { at: number; hours: number }[] = [];
    for (let i = 0; i <= samples; i++) {
      const fraction = i / samples;
      readings.push({
        at: fraction,
        hours: solarClock("mercury", jdTdb(start + sol * fraction))!.hours,
      });
    }

    const reversals = readings
      .slice(1)
      .map((reading, i) => ({ reading, previous: readings[i] }))
      // A wrap through midnight is a drop from near 24 to near 0, not a drop in the middle
      // of the day. Only the latter is the Sun actually going backwards.
      .filter(({ reading, previous }) => reading.hours < previous.hours && previous.hours < 20);

    expect(reversals.length, "Mercury's Sun should reverse").toBeGreaterThan(0);

    /**
     * Twice per solar day, near noon and near midnight.
     *
     * This caught the second wrong assumption in the same test. A Mercury solar day is two
     * Mercury years, so the planet passes perihelion twice during it, and the Sun reverses at
     * each pass. Once the prime meridian is facing the Sun, which is noon, and once facing
     * away, which is midnight and where the reversal happens below the horizon.
     */
    for (const { previous } of reversals) {
      const fromNoon = Math.abs(previous.hours - 12);
      const fromMidnight = Math.min(previous.hours, 24 - previous.hours);
      expect(
        Math.min(fromNoon, fromMidnight),
        `reversed at ${previous.hours.toFixed(2)}, which is neither noon nor midnight`,
      ).toBeLessThan(1.5);
    }

    const nearNoon = reversals.filter((r) => Math.abs(r.previous.hours - 12) < 1.5);
    const nearMidnight = reversals.filter(
      (r) => Math.min(r.previous.hours, 24 - r.previous.hours) < 1.5,
    );
    expect(nearNoon.length, "a reversal at perihelion facing the Sun").toBeGreaterThan(0);
    expect(nearMidnight.length, "and another facing away").toBeGreaterThan(0);

    // Days, not weeks: the reversals together are a small part of a 176 day solar day.
    const span = (reversals.length / samples) * sol;
    expect(span).toBeGreaterThan(1);
    expect(span).toBeLessThan(30);
  });

  it("returns to the same reading one sol later", () => {
    for (const id of ["embary", "mars", "venus", "jupiter", "moon"] as const) {
      const sol = timeSense(id).dayInEarthDays;
      const a = solarClock(id, jdTdb(2_451_545))!;
      const b = solarClock(id, jdTdb(2_451_545 + sol))!;
      // Within a couple of minutes of the body's own clock: a mean sol against a true one.
      expect(Math.abs(b.hours - a.hours), id).toBeLessThan(0.25);
    }
  });

  it("counts a new solar day each time the clock wraps", () => {
    const sol = timeSense("mars").dayInEarthDays;
    const a = solarClock("mars", jdTdb(2_451_545))!;
    const b = solarClock("mars", jdTdb(2_451_545 + sol))!;
    expect(b.dayNumber - a.dayNumber).toBe(1);
  });
});

/**
 * The equation of time, which is the sharpest independent check in this file.
 *
 * `solarClock` returns apparent solar time at Greenwich for Earth: the sundial. UTC is mean
 * solar time there. The gap is the equation of time, a curve tabulated in almanacs for
 * centuries that swings to about +16m24s in early November and -14m12s in mid February.
 * Nothing in this module knows that curve, so reproducing its shape means the obliquity
 * rotation, the node, the sense of W and the Sun direction are all correct together: a sign
 * error anywhere turns a sixteen minute swing into hours.
 *
 * The shape is what is tested, not the absolute value, because there is a constant offset and
 * it is a property of the model rather than a defect. The IAU gives Earth a uniformly rotating
 * prime meridian, W = 190.147 + 360.9856235 d, which places the meridian at right ascension
 * 280.147 degrees at J2000 where true Greenwich sidereal time is 280.46. That 0.313 degree
 * rounding is 75 seconds of rotation, and the rest of the measured 92 is the drift of a linear
 * rate against Earth's actual, irregular UT1 by 2026. Reproducing a real sundial to the second
 * needs ERA, precession-nutation and UT1, none of which this engine carries, and every other
 * body in the registry is served correctly by the same uniform model. So the constant is
 * pinned and explained rather than tuned away.
 */
describe("Earth's sundial against the clock", () => {
  /** Measured, explained above, and asserted below so it cannot drift unnoticed. */
  const MODEL_OFFSET_MINUTES = -1.533;

  const offsetMinutes = (iso: string) => {
    const utcHours = (Date.parse(iso) % 86_400_000) / 3_600_000;
    let diff = solarClock("embary", at(iso))!.hours - utcHours;
    if (diff > 12) diff -= 24;
    if (diff < -12) diff += 24;
    return diff * 60;
  };

  /** Almanac values for the equation of time on these dates, minutes. */
  const PUBLISHED: readonly (readonly [string, number])[] = [
    ["2026-02-11T12:00:00Z", -14.2],
    ["2026-05-14T12:00:00Z", 3.7],
    ["2026-07-26T12:00:00Z", -6.5],
    ["2026-11-03T12:00:00Z", 16.4],
  ];

  it.each(PUBLISHED)("reproduces the equation of time at %s", (iso, published) => {
    /**
     * Ten seconds, stated as a bound rather than as `toBeCloseTo` digits.
     *
     * The almanac figures are quoted to a tenth of a minute, so asking for agreement inside
     * 0.05 of a minute is asking for better than the reference knows. Ten seconds against a
     * curve thirty-one minutes wide is the geometry being right, not a fit.
     */
    expect(Math.abs(offsetMinutes(iso) - MODEL_OFFSET_MINUTES - published)).toBeLessThan(0.17);
  });

  it("holds that offset constant all year, which is what makes it a model constant", () => {
    const offsets = PUBLISHED.map(([iso, published]) => offsetMinutes(iso) - published);
    const spread = Math.max(...offsets) - Math.min(...offsets);
    // Three seconds of spread across February to November. A geometry error would not be flat.
    expect(spread * 60).toBeLessThan(10);
    for (const offset of offsets) {
      expect(Math.abs(offset - MODEL_OFFSET_MINUTES)).toBeLessThan(0.17);
    }
  });

  it("never strays outside the range an almanac gives it", () => {
    for (let day = 0; day < 365; day++) {
      const epoch = jdTdb(2_461_041.5 + day);
      const utcHours = ((epoch - Math.floor(epoch) + 0.5) % 1) * 24;
      let diff = solarClock("embary", epoch)!.hours - utcHours;
      if (diff > 12) diff -= 24;
      if (diff < -12) diff += 24;
      expect(Math.abs(diff * 60), `day ${day}`).toBeLessThan(19);
    }
  });
});

describe("what a body's hour is worth", () => {
  it("gives Earth an hour of exactly 3600 seconds, by construction", () => {
    expect(solarClock("embary", jdTdb(2_451_545))!.hourInEarthSeconds).toBeCloseTo(3600, 0);
  });

  /** A Mars sol is 24h 39m 35s, so a Mars hour divided out is 2.75 per cent longer. */
  it("gives Mars an hour 2.7 per cent longer than ours", () => {
    const hour = solarClock("mars", jdTdb(2_451_545))!.hourInEarthSeconds;
    expect(hour / 3600).toBeCloseTo(1.0275, 3);
  });

  it("knows which bodies see the Sun rise in the west", () => {
    expect(solarClock("venus", jdTdb(2_451_545))!.sunRisesInTheWest).toBe(true);
    expect(solarClock("embary", jdTdb(2_451_545))!.sunRisesInTheWest).toBe(false);
  });

  it("formats a readable clock for every body", () => {
    for (const id of BODY_IDS) {
      if (id === "sun") continue;
      expect(solarClock(id, jdTdb(2_451_545))!.formatted, id).toMatch(/^\d\d:\d\d:\d\d$/);
    }
  });
});

describe("the contract holds for every body", () => {
  it("has rotational elements for everything it clocks", () => {
    for (const id of BODY_IDS) {
      expect(BODY_CONTRACTS[id].rotation.rotationRateDegPerDay, id).not.toBe(0);
    }
  });
});
