/**
 * The two things that have actually gone wrong with orbit paths.
 *
 * First, drawing a moon's orbit heliocentrically. Over one of its own periods a moon's
 * heliocentric path is dominated by where its planet went, not by the orbit: Phobos circles
 * Mars in 7.7 hours while Mars travels 660,000 km, so the drawn path was a straight streak
 * seventy times longer than the 9,234 km orbit it was meant to show. Nothing about that looks
 * like an error on screen; it looks like the moon has no orbit line. The periapsis test is
 * what distinguishes them, and it is the same check the iOS client runs.
 *
 * Second, drawing orbits that do not belong at the current scale. Focusing a planet drew every
 * planetary orbit, each an astronomical unit or more across, so only their near edges crossed
 * the view as streaks well above the planet. Reported as "the lines are not correctly in the
 * centre of the planet like they are on mobile", which is exactly right: iOS had the rule and
 * the website did not.
 */

import { describe, expect, it } from "vitest";
import { BODY_CONTRACTS, BODY_IDS, type BodyId } from "@solar/engine/bodies/registry";
import { orbitIsVisible, orbitSamples } from "./OrbitPaths";

const MOONS = BODY_IDS.filter(
  (id) => BODY_CONTRACTS[id].ephemeris.kind === "mean-elements-about-parent",
);

describe("a moon's orbit is drawn about its planet", () => {
  it("has moons to check, so an empty list cannot pass", () => {
    expect(MOONS.length).toBeGreaterThan(15);
  });

  it.each(MOONS)("%s closest approach is its periapsis, not its planet's own motion", (id) => {
    const contract = BODY_CONTRACTS[id];
    const ephemeris = contract.ephemeris;
    if (ephemeris.kind !== "mean-elements-about-parent") throw new Error("not a moon");

    const samples = orbitSamples(id, ephemeris.periodDays, contract.parent);
    let closest = Infinity;
    for (let i = 0; i < samples.length; i += 3) {
      closest = Math.min(closest, Math.hypot(samples[i], samples[i + 1], samples[i + 2]));
    }

    const periapsis = ephemeris.semiMajorAxisM * (1 - ephemeris.eccentricity);
    // Two percent: the path is 512 samples of a real ephemeris, so the nearest vertex sits
    // just off the true periapsis, and the elements precess within the sampled period.
    expect(Math.abs(closest - periapsis) / periapsis).toBeLessThan(0.02);
  });

  it("would fail if a moon were sampled heliocentrically", () => {
    // The bug this test exists for, reproduced on purpose: drop the parent subtraction and
    // Phobos's closest approach becomes its distance from the Sun rather than from Mars.
    const ephemeris = BODY_CONTRACTS.phobos.ephemeris;
    if (ephemeris.kind !== "mean-elements-about-parent") throw new Error("not a moon");

    const samples = orbitSamples("phobos", ephemeris.periodDays, null);
    let closest = Infinity;
    for (let i = 0; i < samples.length; i += 3) {
      closest = Math.min(closest, Math.hypot(samples[i], samples[i + 1], samples[i + 2]));
    }
    const periapsis = ephemeris.semiMajorAxisM * (1 - ephemeris.eccentricity);
    expect(closest / periapsis).toBeGreaterThan(1_000);
  });
});

describe("which orbits belong on screen", () => {
  const planets = BODY_IDS.filter(
    (id) => BODY_CONTRACTS[id].ephemeris.kind === "standish-elements",
  ).map((id) => ({ id, parent: null as BodyId | null }));
  const moons = MOONS.map((id) => ({ id, parent: BODY_CONTRACTS[id].parent }));

  it("draws every planetary orbit in the system view", () => {
    expect(planets.every((o) => orbitIsVisible(o, "sun"))).toBe(true);
  });

  it("draws no planetary orbit from a planet, which is the reported bug", () => {
    for (const focus of ["embary", "mars", "jupiter", "neptune"] as const) {
      expect(planets.some((o) => orbitIsVisible(o, focus)), `${focus}`).toBe(false);
    }
  });

  it("draws a moon's orbit from its planet and from the moon itself", () => {
    const moon = moons.find((m) => m.id === "moon");
    expect(moon).toBeDefined();
    expect(orbitIsVisible(moon!, "embary")).toBe(true);
    expect(orbitIsVisible(moon!, "moon")).toBe(true);
  });

  it("draws no other system's moons, so Jupiter never shows Saturn's", () => {
    const jovian = moons.filter((m) => m.parent === "jupiter");
    expect(jovian.length).toBeGreaterThan(3);
    expect(jovian.some((m) => orbitIsVisible(m, "saturn"))).toBe(false);
    expect(jovian.every((m) => orbitIsVisible(m, "jupiter"))).toBe(true);
  });

  it("draws no moon orbit in the system view, where they are under a pixel", () => {
    expect(moons.some((m) => orbitIsVisible(m, "sun"))).toBe(false);
  });
});
