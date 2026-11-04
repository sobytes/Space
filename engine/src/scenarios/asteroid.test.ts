/**
 * Asteroid scenarios, checked against events that actually happened.
 *
 * Impact energy is easy to get wrong by a factor of a thousand and have it still look
 * plausible, so it is gated against three real impacts spanning eight orders of magnitude.
 * The dynamics are gated on behaviour that follows from the physics regardless of the
 * ephemeris: a body released at its parent's own velocity inherits that orbit, and a body
 * given more than escape speed leaves.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAUNCH,
  impactEnergy,
  initialStateFor,
  perturbersFrom,
  runAsteroid,
} from "./asteroid";
import { heliocentricPositionOf } from "../bodies/position";
import { J2000_JD, jdTdb } from "../time";
import { AU_IN_METRES, GM_SUN } from "../units";
import { length, sub } from "../vec";
import { eccentricityOf } from "../propagate";

const J2000 = jdTdb(J2000_JD);

describe("impact energy against real events", () => {
  /**
   * Each row is a well-documented impact with a published yield. Diameters and entry speeds
   * are the commonly cited central estimates, and the tolerance is wide because those inputs
   * are themselves uncertain by tens of percent. The point is to catch an error of a factor
   * of a thousand, which is the kind this formula actually suffers from.
   */
  it.each([
    ["Chelyabinsk 2013", 19, 3_300, 19_160, 0.4, 0.8],
    ["Tunguska 1908", 55, 3_000, 15_000, 3, 15],
    ["Chicxulub", 10_000, 2_600, 20_000, 1e7, 2e8],
  ])("%s lands inside its published yield range", (_name, diameter, density, speed, low, high) => {
    const estimate = impactEnergy(diameter, density, speed);
    expect(estimate.energyMegatonsTnt, `${_name} megatons`).toBeGreaterThan(low);
    expect(estimate.energyMegatonsTnt, `${_name} megatons`).toBeLessThan(high);
  });

  it("scales as the cube of diameter and the square of speed", () => {
    const base = impactEnergy(100, 3_000, 10_000).energyJoules;
    expect(impactEnergy(200, 3_000, 10_000).energyJoules / base).toBeCloseTo(8, 6);
    expect(impactEnergy(100, 3_000, 20_000).energyJoules / base).toBeCloseTo(4, 6);
  });
});

describe("launch geometry", () => {
  it("releases the body at the chosen altitude above its parent", () => {
    const launch = { ...DEFAULT_LAUNCH, originBody: "embary" as const, altitudeM: 1e9 };
    const state = initialStateFor(launch);
    const parent = heliocentricPositionOf("embary", launch.startEpoch);
    const separation = length(sub(state.position, parent));
    expect(separation).toBeCloseTo(6_378_137 + 1e9, -3);
  });

  it("inherits the parent's orbital motion, so zero relative speed means the parent's orbit", () => {
    const launch = {
      ...DEFAULT_LAUNCH,
      originBody: "embary" as const,
      altitudeM: 1e9,
      speedMS: 0,
      startEpoch: J2000,
    };
    const state = initialStateFor(launch);

    // Earth's orbital speed is about 29.8 km/s; a released body must be carrying it.
    const speed = length(state.velocity);
    expect(speed).toBeGreaterThan(28_000);
    expect(speed).toBeLessThan(31_000);

    // And it must be on a near-circular, roughly 1 au orbit as a result.
    const e = eccentricityOf(GM_SUN, state.position, state.velocity);
    expect(e).toBeLessThan(0.1);
  });
});

describe("where things end up", () => {
  it("builds a perturber for every body except the Sun, each with a real mass", () => {
    const perturbers = perturbersFrom(J2000);
    expect(perturbers.length).toBeGreaterThanOrEqual(9);
    expect(perturbers.some((p) => p.id === "sun")).toBe(false);
    for (const p of perturbers) {
      expect(p.gm, `${p.id} gm`).toBeGreaterThan(0);
      expect(length(p.positionAt(0)), `${p.id} position at t=0`).toBeGreaterThan(0);
    }
  });

  it("sends a body past solar escape speed onto an unbound orbit", () => {
    const outcome = runAsteroid({
      ...DEFAULT_LAUNCH,
      originBody: "embary",
      altitudeM: 1e9,
      // Earth carries about 29.8 km/s and escape at 1 au is about 42.1 km/s, so 20 km/s
      // added along track puts it comfortably over.
      speedMS: 20_000,
      headingDeg: 0,
      durationYears: 60,
      startEpoch: J2000,
    });

    expect(outcome.finalEccentricity).toBeGreaterThan(1);
    expect(outcome.result.fate.kind, outcome.summary).toBe("escaped");
    expect(outcome.summary).toContain("unbound");
  });

  it("keeps a gently released body bound near its parent's orbit", () => {
    const outcome = runAsteroid({
      ...DEFAULT_LAUNCH,
      originBody: "embary",
      altitudeM: 2e9,
      speedMS: 500,
      headingDeg: 90,
      durationYears: 20,
      startEpoch: J2000,
    });

    expect(outcome.finalEccentricity).toBeLessThan(1);
    expect(outcome.finalSemiMajorAxisAu).not.toBeNull();
    expect(outcome.finalSemiMajorAxisAu!).toBeGreaterThan(0.7);
    expect(outcome.finalSemiMajorAxisAu!).toBeLessThan(1.5);
  });

  it("records a trajectory and any close approaches it made", () => {
    const outcome = runAsteroid({
      ...DEFAULT_LAUNCH,
      durationYears: 15,
      startEpoch: J2000,
    });
    expect(outcome.result.samples.length).toBeGreaterThan(100);
    for (const approach of outcome.result.closeApproaches) {
      expect(approach.distanceM).toBeLessThanOrEqual(0.2 * AU_IN_METRES);
      expect(approach.distanceM).toBeGreaterThan(0);
    }
  });
});

describe("the drawn path", () => {
  /**
   * How sharply does the recorded path turn between consecutive points?
   *
   * This is the invariant the eye actually judges, and it is the one that was broken. A path
   * is drawn as straight segments between samples, so the angle between consecutive segments
   * is exactly how polygonal it looks. Twelve points around an orbit is thirty degrees a
   * segment and reads as a dodecagon; the overlapping dodecagons of a fifty-year run were
   * reported from the phone as a path that did not look right.
   *
   * Sample counts are the wrong thing to assert. The shipped iOS value of 600 is a perfectly
   * reasonable-looking number and is fine at two years; what makes it wrong at fifty is the
   * geometry it produces, and only the geometry says so.
   */
  // The 200 year case needs its own timeout: measured at 5.6 s for 53,729 steps, which is the
  // propagation being genuinely long rather than slow. It runs off the main thread in both
  // clients, so this is a test-harness limit and not a user-facing one.
  it.each([2, 10, 50, 200])("stays smooth over %i years", (years) => {
    const outcome = runAsteroid({ ...DEFAULT_LAUNCH, originBody: "embary", durationYears: years });
    const samples = outcome.result.samples;
    expect(samples.length).toBeGreaterThan(100 * years);

    let worstTurnDeg = 0;
    for (let i = 1; i + 1 < samples.length; i++) {
      const a = sub(samples[i].position, samples[i - 1].position);
      const b = sub(samples[i + 1].position, samples[i].position);
      const la = length(a);
      const lb = length(b);
      if (la === 0 || lb === 0) continue;
      const cos = (a.x * b.x + a.y * b.y + a.z * b.z) / (la * lb);
      worstTurnDeg = Math.max(
        worstTurnDeg,
        (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI,
      );
    }
    // Measured at 3.1 degrees for every span up to 50 years and 4.2 at 200, where the sample
    // cap starts to bite. Ten is well clear of both and far below the thirty that was shipped.
    expect(worstTurnDeg).toBeLessThan(10);
  }, 30_000);

  it("records the end of the run, not a sample interval short of it", () => {
    const years = 50;
    const outcome = runAsteroid({ ...DEFAULT_LAUNCH, originBody: "embary", durationYears: years });
    const samples = outcome.result.samples;
    const requested = years * 365.25 * 86_400;
    expect(samples[samples.length - 1].t).toBeCloseTo(requested, 3);
  });
});
