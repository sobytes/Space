/**
 * Checked against the published figures this module is assembled from, not against itself.
 *
 * Every number below is one somebody else printed: the faint young Sun at 70 per cent, the
 * habitable zone's inner edge at 0.95 au today, Earth's remaining billion years, and the red
 * giant tip at 2730 luminosities and 256 radii. If this module and those disagree, it is wrong.
 */

import { describe, expect, it } from "vitest";
import {
  DEEP_TIME_EVENTS, MAIN_SEQUENCE_END_GYR, RED_GIANT_TIP_GYR, SOLAR_AGE_NOW_GYR,
  engulfedAt, habitableZoneAt, insideHabitableZoneAt, mainSequenceLuminosity,
  runawayGreenhouseCrossing, solarStateAt,
} from "./deep-time";

describe("the Sun on the main sequence", () => {
  it("shines at 100 per cent today, by construction", () => {
    expect(mainSequenceLuminosity(SOLAR_AGE_NOW_GYR)).toBeCloseTo(1, 12);
  });

  /**
   * The faint young Sun, which is the whole reason this relation is worth having. At formation
   * the Sun put out about 70 per cent of today's light, which is not enough to keep Earth
   * above freezing with today's atmosphere, and Earth had liquid water anyway.
   */
  it("shines at 71 per cent when the Sun forms", () => {
    expect(mainSequenceLuminosity(0)).toBeCloseTo(0.714, 3);
  });

  it("brightens monotonically, never dims", () => {
    let previous = 0;
    for (let age = 0; age <= MAIN_SEQUENCE_END_GYR; age += 0.1) {
      const now = mainSequenceLuminosity(age);
      expect(now).toBeGreaterThan(previous);
      previous = now;
    }
  });

  it("keeps the effective temperature fixed while radius follows luminosity", () => {
    // R = sqrt(L) at fixed T is the first-order statement; the three must stay consistent.
    for (const age of [1, 3, SOLAR_AGE_NOW_GYR, 8]) {
      const state = solarStateAt(age);
      expect(state.radius).toBeCloseTo(Math.sqrt(state.luminosity), 9);
      expect(state.effectiveTemperatureK).toBeCloseTo(5772, 0);
    }
  });
});

describe("the habitable zone, against Kopparapu's published edges", () => {
  it("puts the inner edge at 0.95 au today", () => {
    expect(habitableZoneAt(SOLAR_AGE_NOW_GYR).innerAu).toBeCloseTo(0.95, 2);
  });

  it("puts the outer edge at 1.68 au today, which is past Mars", () => {
    expect(habitableZoneAt(SOLAR_AGE_NOW_GYR).outerAu).toBeCloseTo(1.68, 2);
  });

  it("sweeps outwards and never back", () => {
    let previous = 0;
    for (let age = 0; age <= MAIN_SEQUENCE_END_GYR; age += 0.25) {
      const inner = habitableZoneAt(age).innerAu;
      expect(inner).toBeGreaterThan(previous);
      previous = inner;
    }
  });

  it("holds Earth today and not in two billion years", () => {
    expect(insideHabitableZoneAt("embary", SOLAR_AGE_NOW_GYR)).toBe(true);
    expect(insideHabitableZoneAt("embary", SOLAR_AGE_NOW_GYR + 2)).toBe(false);
  });

  /** Mars is inside the outer edge now. It is not too cold for its distance, it is too thin. */
  it("already holds Mars, which is a fact about Mars's air and not its orbit", () => {
    expect(insideHabitableZoneAt("mars", SOLAR_AGE_NOW_GYR)).toBe(true);
  });
});

describe("when each body loses its water", () => {
  it("gives Earth about a billion years, long before the Sun becomes a giant", () => {
    const crossing = runawayGreenhouseCrossing("embary");
    expect(crossing.kind).toBe("crosses");
    if (crossing.kind !== "crosses") return;
    expect(crossing.fromNowGyr).toBeGreaterThan(0.8);
    expect(crossing.fromNowGyr).toBeLessThan(1.5);
    // The point worth making: five billion years of main sequence remain after that.
    expect(crossing.ageGyr).toBeLessThan(MAIN_SEQUENCE_END_GYR - 4);
  });

  it("says Mercury and Venus are already past it, not that nothing happens", () => {
    expect(runawayGreenhouseCrossing("mercury").kind).toBe("already-inside");
    expect(runawayGreenhouseCrossing("venus").kind).toBe("already-inside");
  });

  it("says Mars outlasts the main sequence, which is the opposite fact", () => {
    expect(runawayGreenhouseCrossing("mars").kind).toBe("not-before-the-end");
  });
});

describe("the giant phases", () => {
  it("reaches 2730 luminosities and 256 radii at the tip", () => {
    const tip = solarStateAt(RED_GIANT_TIP_GYR);
    expect(tip.luminosity).toBeCloseTo(2730, 0);
    expect(tip.radius).toBeCloseTo(256, 0);
    expect(tip.mass).toBeCloseTo(0.668, 3);
  });

  /**
   * Schröder and Connon Smith's headline result. Mercury and Venus go, and Earth goes too:
   * the Sun's mass loss lifts Earth's orbit, and tidal drag pulls it back in faster.
   */
  it("swallows Mercury, Venus and Earth, and spares Mars", () => {
    expect(engulfedAt("mercury", RED_GIANT_TIP_GYR)).toBe(true);
    expect(engulfedAt("venus", RED_GIANT_TIP_GYR)).toBe(true);
    expect(engulfedAt("embary", RED_GIANT_TIP_GYR)).toBe(true);
    expect(engulfedAt("mars", RED_GIANT_TIP_GYR)).toBe(false);
  });

  it("swallows nothing at all today", () => {
    for (const body of ["mercury", "venus", "embary", "mars"] as const) {
      expect(engulfedAt(body, SOLAR_AGE_NOW_GYR)).toBe(false);
    }
  });

  it("says which parts are modelled and which interpolated", () => {
    expect(solarStateAt(SOLAR_AGE_NOW_GYR).confidence).toBe("modelled");
    expect(solarStateAt(11.5).confidence).toBe("interpolated");
    expect(solarStateAt(13).confidence).toBe("end state");
  });

  it("ends as a white dwarf of half a Sun", () => {
    const end = solarStateAt(13);
    expect(end.phase).toBe("white-dwarf");
    expect(end.mass).toBeCloseTo(0.54, 2);
    // About Earth's radius: 0.0084 solar radii is 5,800 km.
    expect(end.radius * 695_700).toBeGreaterThan(4_000);
    expect(end.radius * 695_700).toBeLessThan(8_000);
  });
});

describe("the timeline", () => {
  it("is in order and every entry says where its date came from", () => {
    for (let i = 1; i < DEEP_TIME_EVENTS.length; i++) {
      expect(DEEP_TIME_EVENTS[i].ageGyr).toBeGreaterThan(DEEP_TIME_EVENTS[i - 1].ageGyr);
    }
    for (const event of DEEP_TIME_EVENTS) {
      expect(event.source.length).toBeGreaterThan(4);
      expect(event.detail.length).toBeGreaterThan(40);
    }
  });

  it("marks now where the Sun actually is", () => {
    const now = DEEP_TIME_EVENTS.find((event) => event.title === "Now");
    expect(now?.ageGyr).toBe(SOLAR_AGE_NOW_GYR);
  });
});
