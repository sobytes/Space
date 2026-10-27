/**
 * The tracker gate: the three things a clock does that a sequential integrator cannot follow
 * naively, plus the claim that the two gravity modes agree at the moment of the switch.
 */

import { describe, expect, it } from "vitest";
import { heliocentricPositionOf } from "./bodies/position";
import { ALL_MOONS, PLANETARY_SET, createNBodyTracker } from "./nbody-tracker";
import { J2000_JD, jdTdb } from "./time";
import { SECONDS_PER_DAY } from "./units";
import { length, sub } from "./vec";

const START = jdTdb(J2000_JD);
const TIGHT = { tolerance: 1e-13, minStepSeconds: 60, maxStepSeconds: SECONDS_PER_DAY };

describe("seeding", () => {
  it("starts exactly on the analytic ephemeris, so switching modes changes nothing visible", () => {
    const tracker = createNBodyTracker({ epoch: START, limits: TIGHT });
    for (const planet of PLANETARY_SET) {
      const analytic = heliocentricPositionOf(planet, START);
      const integrated = tracker.heliocentricPosition(planet);
      // Not bit-identical: the barycentric round trip subtracts and re-adds the Sun's offset.
      // A metre at Neptune's distance is 1e-11 relative, far below anything renderable.
      expect(length(sub(integrated, analytic)), planet).toBeLessThan(1);
    }
  });

  it("integrates the eight planets by default", () => {
    const tracker = createNBodyTracker({ epoch: START, limits: TIGHT });
    expect(tracker.status().bodyCount).toBe(9);
    expect(tracker.ids).toContain("sun");
    expect(tracker.ids).toContain("neptune");
  });

  it("accepts the moons, which is the same equation at a higher price", () => {
    const tracker = createNBodyTracker({
      epoch: START,
      bodies: [...PLANETARY_SET, ...ALL_MOONS],
      limits: TIGHT,
    });
    expect(tracker.status().bodyCount).toBe(32);
    // Phobos is the fastest body and the one that paces the step size. Its seeded velocity
    // comes from a central difference, so a wrong differencing interval would show up here as
    // an orbit that is not bound.
    const phobos = tracker.heliocentricPosition("phobos");
    const mars = tracker.heliocentricPosition("mars");
    const separation = length(sub(phobos, mars));
    expect(separation).toBeGreaterThan(9.2e6);
    expect(separation).toBeLessThan(9.6e6);
  });
});

describe("following a clock", () => {
  it("advances when the clock advances", () => {
    const tracker = createNBodyTracker({ epoch: START, limits: TIGHT });
    const before = tracker.heliocentricPosition("embary");
    const status = tracker.seek(jdTdb(J2000_JD + 30));
    expect(status.reseeded).toBe(false);
    expect(status.steps).toBeGreaterThan(0);
    expect(Math.abs(status.lagDays)).toBeLessThan(1e-6);
    // Earth covers roughly 77 million km in 30 days.
    const moved = length(sub(tracker.heliocentricPosition("embary"), before));
    expect(moved).toBeGreaterThan(7e10);
    expect(moved).toBeLessThan(9e10);
  });

  it("runs backwards and returns to where it started", () => {
    const tracker = createNBodyTracker({ epoch: START, limits: TIGHT });
    const origin = tracker.heliocentricPosition("mars");
    tracker.seek(jdTdb(J2000_JD + 400));
    tracker.seek(START);
    // Dormand-Prince is not symplectic, so the return is to the integrator's tolerance rather
    // than bit for bit. Mars sits 2.3e11 m out, so a kilometre is 4e-9 relative.
    expect(length(sub(tracker.heliocentricPosition("mars"), origin))).toBeLessThan(1e3);
  });

  it("re-seeds rather than trying to integrate a jump of centuries", () => {
    const tracker = createNBodyTracker({
      epoch: START,
      limits: TIGHT,
      reseedThresholdDays: 365,
    });
    const status = tracker.seek(jdTdb(J2000_JD + 36_525));
    expect(status.reseeded).toBe(true);
    expect(status.steps).toBe(0);
    expect(Math.abs(status.lagDays)).toBeLessThan(1e-9);
    // And it lands on the analytic ephemeris at the new date, since that is what it re-seeds from.
    const analytic = heliocentricPositionOf("jupiter", jdTdb(J2000_JD + 36_525));
    expect(length(sub(tracker.heliocentricPosition("jupiter"), analytic))).toBeLessThan(1);
  });

  it("reports lag instead of blowing its step budget", () => {
    const tracker = createNBodyTracker({ epoch: START, limits: TIGHT, stepBudget: 3 });
    const status = tracker.seek(jdTdb(J2000_JD + 3_000));
    expect(status.reseeded).toBe(false);
    expect(status.steps).toBe(3);
    // Three steps cannot cover 3,000 days, so the tracker must say it is behind rather than
    // pretending to be current. A silent lag here would render stale positions as live ones.
    expect(status.lagDays).toBeGreaterThan(2_000);
  });

  it("keeps its energy over a long follow", () => {
    const tracker = createNBodyTracker({ epoch: START, limits: TIGHT });
    for (let i = 1; i <= 120; i++) tracker.seek(jdTdb(J2000_JD + i * 30));
    const status = tracker.status();
    expect(status.energyDrift).toBeLessThan(1e-12);
    expect(status.reseeded).toBe(false);
  });
});

describe("divergence from the analytic ephemeris", () => {
  it("grows with time, which is the mutual perturbation becoming visible", () => {
    const tracker = createNBodyTracker({ epoch: START, limits: TIGHT });
    const gap = (days: number): number => {
      tracker.seek(jdTdb(J2000_JD + days));
      return length(
        sub(
          tracker.heliocentricPosition("jupiter"),
          heliocentricPositionOf("jupiter", jdTdb(J2000_JD + days)),
        ),
      );
    };
    const early = gap(365);
    const later = gap(3_650);
    expect(early).toBeGreaterThan(0);
    expect(later).toBeGreaterThan(early * 5);
  });
});
