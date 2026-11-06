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
  engulfedAt, engulfmentAt, equilibriumTemperatureAt, habitableZoneAt, insideHabitableZoneAt,
  mainSequenceLuminosity, orbitalPeriodAt, runawayGreenhouseCrossing, semiMajorAxisAt,
  solarStateAt,
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

/**
 * What the Sun's mass loss does to everything else, which is the half of its evolution that
 * reaches the planets mechanically rather than through light.
 */
describe("orbits, as the Sun sheds mass", () => {
  it("leaves orbits alone while no mass is lost", () => {
    // The main sequence loses about a hundredth of a per cent, which moves nothing.
    expect(semiMajorAxisAt("embary", SOLAR_AGE_NOW_GYR)).toBeCloseTo(1.0, 2);
    expect(semiMajorAxisAt("embary", MAIN_SEQUENCE_END_GYR)).toBeCloseTo(1.0, 2);
  });

  /**
   * The adiabatic result: a times M is conserved, so losing a third of the Sun pushes every
   * orbit out by half. This is checked as the invariant rather than against one number, so a
   * wrong exponent cannot pass by matching Earth and missing Jupiter.
   */
  it("conserves a times M for every body", () => {
    for (const body of ["mercury", "venus", "embary", "mars", "jupiter"] as const) {
      const now = semiMajorAxisAt(body, SOLAR_AGE_NOW_GYR) * solarStateAt(SOLAR_AGE_NOW_GYR).mass;
      const tip = semiMajorAxisAt(body, RED_GIANT_TIP_GYR) * solarStateAt(RED_GIANT_TIP_GYR).mass;
      expect(tip).toBeCloseTo(now, 9);
    }
  });

  it("puts Earth at 1.50 au by the red giant tip", () => {
    expect(semiMajorAxisAt("embary", RED_GIANT_TIP_GYR)).toBeCloseTo(1.497, 2);
  });

  /** P goes as M^-2, not M^-1: the orbit widens and the pull weakens at the same time. */
  it("stretches Earth's year to 2.24 of today's", () => {
    expect(orbitalPeriodAt("embary", RED_GIANT_TIP_GYR)).toBeCloseTo(2.241, 2);
  });

  it("keeps the solar system's shape, inflating it rather than reordering it", () => {
    const order = ["mercury", "venus", "embary", "mars", "jupiter"] as const;
    const ratio = order.map((b) => semiMajorAxisAt(b, RED_GIANT_TIP_GYR)
      / semiMajorAxisAt(b, SOLAR_AGE_NOW_GYR));
    for (const r of ratio) expect(r).toBeCloseTo(ratio[0], 9);
  });
});

describe("equilibrium temperature, against the published figures", () => {
  it.each([
    ["mercury", 440, 8],
    ["venus", 227, 3],
    ["embary", 255, 3],
    ["mars", 210, 4],
  ] as const)("puts %s at about %s K today", (body, expected, tolerance) => {
    expect(Math.abs(equilibriumTemperatureAt(body, SOLAR_AGE_NOW_GYR) - expected))
      .toBeLessThan(tolerance);
  });

  it("warms every body as the Sun brightens", () => {
    for (const body of ["venus", "embary", "mars"] as const) {
      expect(equilibriumTemperatureAt(body, MAIN_SEQUENCE_END_GYR))
        .toBeGreaterThan(equilibriumTemperatureAt(body, SOLAR_AGE_NOW_GYR));
    }
  });
});

describe("what is actually destroyed", () => {
  /**
   * Schröder 2008's headline, and the part my first version got right for the wrong reason.
   *
   * Comparing the giant's radius against each planet's *present* orbit swallows Earth. Doing
   * it properly, against the orbit after mass loss, Earth is at 1.50 au and the photosphere
   * only reaches 1.19, so expansion very nearly saves it. The published model loses it anyway,
   * to tidal drag on the envelope, and that is carried here as a citation rather than computed.
   */
  it("finds Earth outside the photosphere and loses it to tides regardless", () => {
    const earth = engulfmentAt("embary", RED_GIANT_TIP_GYR);
    expect(earth.orbitAu).toBeGreaterThan(earth.photosphereAu);
    expect(earth.insidePhotosphere).toBe(false);
    expect(earth.lostToTides).toBe(true);
    expect(engulfedAt("embary", RED_GIANT_TIP_GYR)).toBe(true);
  });

  it("swallows Mercury and Venus outright, orbit expansion and all", () => {
    for (const body of ["mercury", "venus"] as const) {
      expect(engulfmentAt(body, RED_GIANT_TIP_GYR).insidePhotosphere).toBe(true);
    }
  });

  it("spares Mars by a clear margin", () => {
    const mars = engulfmentAt("mars", RED_GIANT_TIP_GYR);
    expect(mars.insidePhotosphere).toBe(false);
    expect(mars.lostToTides).toBe(false);
    expect(mars.orbitAu / mars.photosphereAu).toBeGreaterThan(1.8);
  });

  it("takes the Moon with Earth, rather than leaving it orbiting nothing", () => {
    expect(engulfedAt("embary", RED_GIANT_TIP_GYR)).toBe(true);
    expect(engulfedAt("moon", RED_GIANT_TIP_GYR)).toBe(true);
    // And the Galilean moons go when Jupiter does, which is to say not at all.
    expect(engulfedAt("jupiter", RED_GIANT_TIP_GYR)).toBe(false);
    expect(engulfedAt("io", RED_GIANT_TIP_GYR)).toBe(false);
  });

  it("destroys nothing at all today", () => {
    for (const body of ["mercury", "venus", "embary", "mars"] as const) {
      expect(engulfedAt(body, SOLAR_AGE_NOW_GYR)).toBe(false);
    }
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
