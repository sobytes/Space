/**
 * The spin axes have to be right, and "looks about right on screen" cannot tell a 23 degree
 * frame error from a correct one. These check against published obliquities.
 */

import { describe, expect, it } from "vitest";
import { BODY_CONTRACTS, BODY_IDS } from "./bodies/registry";
import { SHORT_SPAN } from "./data/planets";
import {
  OBLIQUITY_J2000_DEG,
  obliquityToOrbitDeg,
  orientationOf,
  rotationPeriodDays,
} from "./rotation";
import { J2000_JD, jdTdb } from "./time";
import { length } from "./vec";

const J2000 = jdTdb(J2000_JD);
const RAD_TO_DEG = 180 / Math.PI;

describe("IAU orientation", () => {
  it("places the obliquity of the ecliptic where IAU 2006 does", () => {
    expect(OBLIQUITY_J2000_DEG).toBeCloseTo(23.4392794, 6);
  });

  it.each(BODY_IDS)("%s has a unit pole vector", (body) => {
    expect(length(orientationOf(body, J2000).poleEcliptic)).toBeCloseTo(1, 12);
  });

  /**
   * The derived tilt is measured from ecliptic north. The fact sheets quote obliquity to the
   * body's own orbit, and for a retrograde body they also pick the opposite pole. So the
   * comparison converts the convention first and then allows the orbital inclination as slack,
   * because that is exactly the angle between the two reference planes.
   */
  it.each(BODY_IDS.filter((id) => BODY_CONTRACTS[id].kind !== "moon"))(
    "%s obliquity matches its published value once conventions agree",
    (body) => {
    const contract = BODY_CONTRACTS[body];
    const derived = obliquityToOrbitDeg(body, J2000);
    const published = contract.obliquityToOrbitDeg;

    const inclination =
      contract.ephemeris.kind === "standish-elements"
        ? Math.abs(SHORT_SPAN.elements[contract.ephemeris.planet].atJ2000.inclinationDeg)
        : 7;

      expect(
        Math.abs(derived - published),
        `${body} derived obliquity ${derived.toFixed(2)} vs published ${published}, inclination ${inclination.toFixed(2)}`,
      ).toBeLessThan(inclination + 1.5);
    },
  );

  /**
   * Moons need a different check, and writing it surfaced two things I had wrong.
   *
   * I assumed every regular satellite's spin axis sits near its parent's. That holds for the
   * Galilean moons, Titan, Enceladus, Phobos and Deimos, which orbit in their planet's
   * equatorial plane. It fails for Earth's Moon, whose pole is 23.5 degrees from Earth's,
   * because the Moon is far enough out that the Sun dominates over Earth's oblateness and its
   * orbit follows the ecliptic instead. That is why its contract uses an ecliptic reference
   * plane while the others use parent-equator.
   *
   * I also assumed Triton's capture would show up as a tilted pole. It does not: its spin axis
   * sits 2.3 degrees from Neptune's. The retrograde evidence is in the sign of its rotation
   * rate and its 157 degree orbital inclination, not in where its pole points.
   */
  it.each(
    BODY_IDS.filter(
      (id) =>
        BODY_CONTRACTS[id].kind === "moon" &&
        BODY_CONTRACTS[id].ephemeris.kind === "mean-elements-about-parent" &&
        (BODY_CONTRACTS[id].ephemeris as { referencePlane: string }).referencePlane ===
          "parent-equator",
    ),
  )("%s orbits its parent's equator, so its pole sits near the parent's", (body) => {
    const parent = BODY_CONTRACTS[body].parent;
    if (parent === null) return;

    const moonPole = orientationOf(body, J2000).poleEcliptic;
    const parentPole = orientationOf(parent, J2000).poleEcliptic;
    const separation =
      Math.acos(
        Math.min(
          1,
          Math.max(
            -1,
            moonPole.x * parentPole.x + moonPole.y * parentPole.y + moonPole.z * parentPole.z,
          ),
        ),
      ) * RAD_TO_DEG;

    expect(separation, `${body} pole versus ${parent}'s`).toBeLessThan(5);
  });

  it("Earth's Moon follows the ecliptic rather than Earth's equator", () => {
    const moonPole = orientationOf("moon", J2000).poleEcliptic;
    const earthPole = orientationOf("embary", J2000).poleEcliptic;

    const fromEcliptic = Math.acos(Math.min(1, Math.max(-1, moonPole.z))) * RAD_TO_DEG;
    const fromEarth =
      Math.acos(
        Math.min(
          1,
          Math.max(
            -1,
            moonPole.x * earthPole.x + moonPole.y * earthPole.y + moonPole.z * earthPole.z,
          ),
        ),
      ) * RAD_TO_DEG;

    // Close to ecliptic north, and about an obliquity away from Earth's pole.
    expect(fromEcliptic, "Moon's pole versus ecliptic north").toBeLessThan(8);
    expect(fromEarth, "Moon's pole versus Earth's pole").toBeGreaterThan(20);
    expect(fromEarth).toBeCloseTo(OBLIQUITY_J2000_DEG, 0);
  });

  it("Triton is retrograde in its rotation rate, which is where the capture shows", () => {
    expect(BODY_CONTRACTS.triton.rotation.rotationRateDegPerDay).toBeLessThan(0);
    const ephemeris = BODY_CONTRACTS.triton.ephemeris;
    if (ephemeris.kind !== "mean-elements-about-parent") throw new Error("expected mean elements");
    // An inclination past 90 degrees is an orbit that cannot form in a prograde disc.
    expect(ephemeris.inclinationDeg).toBeGreaterThan(90);
  });

  it("gives Uranus an obliquity past 90 degrees, which is why it rolls rather than spins", () => {
    expect(obliquityToOrbitDeg("uranus", J2000)).toBeGreaterThan(90);
  });

  it("gives Venus an obliquity near 180 degrees, which is what retrograde spin looks like", () => {
    expect(obliquityToOrbitDeg("venus", J2000)).toBeGreaterThan(170);
  });

  it("advances Earth's prime meridian by very nearly a full turn in one day", () => {
    const a = orientationOf("embary", J2000).spin;
    const b = orientationOf("embary", jdTdb(J2000_JD + 1)).spin;
    const advanced = ((b - a) * RAD_TO_DEG + 360) % 360;
    // 360.9856 degrees per day, so one day leaves it 0.9856 degrees past a full turn.
    expect(advanced).toBeCloseTo(0.9856235, 4);
  });

  it.each(BODY_IDS)("%s rotation period matches its contract", (body) => {
    expect(rotationPeriodDays(body)).toBeCloseTo(
      360 / BODY_CONTRACTS[body].rotation.rotationRateDegPerDay,
      9,
    );
  });
});
