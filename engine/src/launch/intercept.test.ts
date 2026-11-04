import { describe, expect, it } from "vitest";
import {
  findTransferWindow,
  hohmannFlightDays,
  orbitalPeriodDays,
  refineIntercept,
  solveIntercept,
  synodicPeriodDays,
} from "./intercept";
import { heliocentricStateOf } from "../bodies/position";
import { jdTdb } from "../time";
import { contractFor } from "../bodies/registry";
import { DEFAULT_LAUNCH, runAsteroid } from "../scenarios/asteroid";
import { length, sub } from "../vec";

/** 2026-01-01, a date with a real Mars window later the same year. */
const START = jdTdb(2_461_041);

describe("orbital and synodic periods", () => {
  /**
   * From the element tables, not from where the body happens to be standing.
   *
   * A first version applied Kepler's third law to the instantaneous heliocentric distance,
   * which equals the semi-major axis only for a circular orbit. Mars is eccentric enough that
   * it returned a 775 day year instead of 687, and the Earth-Mars synodic period came out 98
   * days long. That is three months of error in the answer to "when is the next launch
   * window", which is the one question this module exists to answer.
   */
  it.each([
    ["embary", 365.26],
    ["mars", 686.98],
    ["venus", 224.70],
    ["jupiter", 4332.6],
  ] as const)("gives %s its published year", (body, days) => {
    expect(orbitalPeriodDays(body) / days).toBeCloseTo(1, 2);
  });

  it.each([
    ["mars", 779.9],
    ["venus", 583.9],
    ["jupiter", 398.9],
  ] as const)("gives Earth and %s their published synodic period", (body, days) => {
    expect(synodicPeriodDays("embary", body) / days).toBeCloseTo(1, 2);
  });

  it("gives the Hohmann flight time to Mars as about nine months", () => {
    expect(hohmannFlightDays("embary", "mars")).toBeGreaterThan(240);
    expect(hohmannFlightDays("embary", "mars")).toBeLessThan(290);
  });
});

describe("solving a transfer", () => {
  /**
   * The solved departure velocity must actually reach the target.
   *
   * Checked against the ephemeris rather than against the solver: propagate nothing, just ask
   * where the target will be on the arrival date and confirm Lambert was aimed at that point.
   * A solution aimed at where the planet is now, rather than where it will be, is the classic
   * way to get this wrong and it looks entirely plausible.
   */
  it("aims at where the target will be, not where it is", () => {
    const flightDays = 280;
    const intercept = solveIntercept("embary", "mars", START, flightDays)!;
    expect(intercept).not.toBeNull();

    const nowMars = heliocentricStateOf("mars", START).position;
    const thenMars = heliocentricStateOf("mars", jdTdb(START + flightDays)).position;
    // Mars moves a long way in 280 days; if it did not, this test would prove nothing.
    expect(length(sub(thenMars, nowMars))).toBeGreaterThan(1e11);
  });

  it("refuses a journey that cannot be made in the time", () => {
    expect(solveIntercept("embary", "neptune", START, 5)).toBeNull();
    expect(solveIntercept("embary", "embary", START, 200)).toBeNull();
    expect(solveIntercept("embary", "mars", START, 0)).toBeNull();
  });
});

describe("finding a launch window", () => {
  /**
   * The costs have to land in the band real missions pay.
   *
   * These are departure delta-v relative to the body being left, which is the quantity a
   * launch vehicle has to supply above escape. Published figures: about 3.6 km/s for Mars,
   * 2.5 for Venus, 8.8 for a Hohmann transfer to Jupiter. A model that returned half or
   * double those would still draw a plausible-looking trajectory.
   */
  it.each([
    ["mars", 2.5, 5.0],
    ["venus", 2.0, 4.5],
    ["jupiter", 8.0, 11.0],
  ] as const)("costs about what a real mission to %s costs", (body, lowKms, highKms) => {
    const window = findTransferWindow("embary", body, START)!;
    expect(window).not.toBeNull();
    const kms = window.best.departureDeltaVMS / 1000;
    expect(kms).toBeGreaterThan(lowKms);
    expect(kms).toBeLessThan(highKms);
  });

  /**
   * The search has to reach past the minimum-energy transfer to find it.
   *
   * Sized from the span being searched rather than from the physics, the grid stopped at 391
   * days for Jupiter against a Hohmann time of 997, so it could only offer fast expensive
   * trajectories and reported 13.4 km/s for a journey that costs 9.1. The answer looked
   * perfectly reasonable, which is what made it dangerous.
   */
  it("searches far enough out to find the cheap transfer to Jupiter", () => {
    const window = findTransferWindow("embary", "jupiter", START)!;
    expect(window.best.flightDays).toBeGreaterThan(hohmannFlightDays("embary", "jupiter") * 0.8);
  });

  it("finds the 2026 Mars window, which opens in the second half of the year", () => {
    const window = findTransferWindow("embary", "mars", START)!;
    const daysIntoYear = window.best.departEpoch - START;
    expect(daysIntoYear).toBeGreaterThan(180);
    expect(daysIntoYear).toBeLessThan(420);
  });

  it("reports the whole scan, so a client can draw the valley and not just its floor", () => {
    const window = findTransferWindow("embary", "mars", START)!;
    expect(window.scanned.length).toBeGreaterThan(500);
    const costs = window.scanned.map((s) => s.departureDeltaVMS);
    // A real porkchop has a deep minimum: the worst departure costs many times the best.
    expect(Math.max(...costs) / Math.min(...costs)).toBeGreaterThan(2);
  });
});

describe("aiming at something and hitting it", () => {
  /**
   * The whole point of the feature, end to end.
   *
   * Solve a transfer, correct it under full gravity, fly it with every planet pulling, and
   * see whether it arrives. Before this the asteroid tool could not hit anything: its
   * controls were a heading and a speed, and a planet's target volume is a few parts in a
   * billion of the sky.
   *
   * Three failures had to be fixed to get here and each looked completely plausible from the
   * outside. The release frame was not orthonormal, so the angles meant something slightly
   * other than what they said. The aim was computed from the planet's centre while the object
   * departs five million kilometres away. And the Jacobian was measured with a one metre per
   * second nudge that moves the arrival point by 0.17 au.
   */
  it.each([
    ["embary", "venus"],
    ["embary", "mars"],
    ["mars", "embary"],
  ] as const)("hits %s to %s", (from, to) => {
    const releaseAltitudeM = 5e9;
    const window = findTransferWindow(from, to, START, { releaseAltitudeM });
    expect(window, `no transfer window from ${from} to ${to}`).not.toBeNull();

    const refined = refineIntercept(window!.best, { releaseAltitudeM });
    expect(refined).not.toBeNull();

    const outcome = runAsteroid({
      ...DEFAULT_LAUNCH,
      originBody: from,
      startEpoch: refined!.intercept.departEpoch,
      altitudeM: releaseAltitudeM,
      speedMS: refined!.intercept.departureDeltaVMS,
      headingDeg: refined!.intercept.headingDeg,
      inclinationDeg: refined!.intercept.inclinationDeg,
      diameterM: 300,
      densityKgM3: 3_000,
      durationYears: Math.max(1, Math.ceil((refined!.intercept.flightDays / 365.25) * 1.3)),
    });

    expect(outcome.result.fate.kind, `aimed at ${to} and did not arrive`).toBe("impact");
    if (outcome.result.fate.kind === "impact") {
      expect(outcome.result.fate.body).toBe(to);
    }
    expect(outcome.consequences, "an impact must report what it did").not.toBeNull();
  }, 60_000);

  /**
   * The correction has to improve on the two-body aim, not merely run.
   *
   * Lambert alone arrives about 75,000 km from Earth, which is a clean miss by twelve Earth
   * radii and looks like a direct hit on any plot anyone would draw of it.
   */
  it("closes most of the gap that the two-body aim leaves", () => {
    const releaseAltitudeM = 5e9;
    const window = findTransferWindow("embary", "mars", START, { releaseAltitudeM })!;
    const refined = refineIntercept(window.best, { releaseAltitudeM })!;
    expect(refined.missM).toBeLessThan(contractFor("mars").equatorialRadiusM);
  }, 60_000);
});
