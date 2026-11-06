/**
 * Checked against published values, not against the formula that produced them.
 *
 * Every figure below is one a reference book states independently: the solar days come from
 * the NASA planetary fact sheets, the synodic month from the IAU, and the day counts per year
 * are the ones an almanac prints. If this module and those disagree, the module is wrong.
 */

import { describe, expect, it } from "vitest";
import { BODY_IDS } from "./bodies/registry";
import { solarDayDays, timeSense } from "./time-sense";

describe("a day, against the published fact sheets", () => {
  it.each([
    // body, solar day in Earth days, tolerance
    ["embary", 1.0, 0.001],
    ["mercury", 175.94, 0.01],
    ["venus", 116.75, 0.01],
    ["mars", 1.027, 0.001],
    ["jupiter", 0.4139, 0.001],
    ["saturn", 0.444, 0.002],
    // The Moon's day is the synodic month: a fortnight of light, then a fortnight of dark.
    ["moon", 29.53, 0.01],
  ] as const)("%s has a %s Earth-day solar day", (id, expected, tolerance) => {
    expect(timeSense(id).dayInEarthDays).toBeCloseTo(expected, -Math.log10(tolerance));
  });
});

describe("the four minutes that make a year come out right", () => {
  /**
   * A day is longer than a spin because the body has moved along its orbit, and the shortfall
   * accumulates to exactly one whole spin over a year. That identity is the sharpest check
   * there is on the solar-day formula: it holds for every prograde body and no fudged
   * constant can satisfy it by accident.
   */
  it.each(["embary", "mars", "jupiter", "saturn", "neptune"] as const)(
    "%s makes exactly one more spin per year than it has days",
    (id) => {
      const t = timeSense(id);
      expect(t.spinsPerYear - t.solarDaysPerYear).toBeCloseTo(1, 6);
    },
  );

  it("gives Earth 365.26 days and 366.26 spins", () => {
    const t = timeSense("embary");
    expect(t.solarDaysPerYear).toBeCloseTo(365.26, 1);
    expect(t.spinsPerYear).toBeCloseTo(366.26, 1);
  });

  /** Retrograde reverses it: Venus makes one fewer spin per year than it has days. */
  it("gives retrograde Venus one fewer spin per year than days", () => {
    const t = timeSense("venus");
    expect(t.spinsBackwards).toBe(true);
    expect(t.solarDaysPerYear - t.spinsPerYear).toBeCloseTo(1, 6);
  });
});

describe("the facts worth showing a child", () => {
  it("makes a Venus year shorter than two Venus days", () => {
    expect(timeSense("venus").solarDaysPerYear).toBeCloseTo(1.92, 1);
  });

  it("makes one Mercury day last two Mercury years", () => {
    // The 3:2 spin-orbit resonance, read off the other way round.
    expect(timeSense("mercury").solarDaysPerYear).toBeCloseTo(0.5, 2);
  });

  it("fits 12.37 full moons into an Earth year, and 13.37 orbits", () => {
    const t = timeSense("moon");
    expect(t.phaseCyclesPerEarthYear).toBeCloseTo(12.37, 1);
    expect(t.orbitsPerEarthYear).toBeCloseTo(13.37, 1);
    // The same lost lap as the day-versus-spin identity, one rung up.
    expect(t.orbitsPerEarthYear! - t.phaseCyclesPerEarthYear!).toBeCloseTo(1, 6);
  });

  it("separates the Moon's 27.32 day orbit from its 29.53 day phase cycle", () => {
    const t = timeSense("moon");
    expect(t.monthDays).toBeCloseTo(27.32, 1);
    expect(t.synodicMonthDays).toBeCloseTo(29.53, 1);
  });

  it("knows the Moon and Titan hold one face towards their planet", () => {
    expect(timeSense("moon").tidallyLocked).toBe(true);
    expect(timeSense("titan").tidallyLocked).toBe(true);
    expect(timeSense("embary").tidallyLocked).toBe(false);
    expect(timeSense("jupiter").tidallyLocked).toBe(false);
  });
});

describe("the formula itself", () => {
  it("returns an infinite day when a spin and a year cancel", () => {
    // One face towards the Sun forever. The arithmetic says infinity and that is correct.
    expect(solarDayDays(100, 100)).toBe(Infinity);
  });

  it("produces a finite, signed day for every body in the registry", () => {
    for (const id of BODY_IDS) {
      const t = timeSense(id);
      if (id === "sun") continue;
      expect(Number.isFinite(t.dayInEarthDays), `${id} day`).toBe(true);
      expect(t.dayInEarthDays, `${id} day`).toBeGreaterThan(0);
      expect(t.yearDays, `${id} year`).toBeGreaterThan(0);
    }
  });
});
