/**
 * Do the moons orbit in the right plane?
 *
 * This is the test Uranus demands. Its spin axis is tilted 98 degrees, and its moons orbit in
 * its equatorial plane, so they circle a pole that lies almost in the ecliptic. Rendered in the
 * ecliptic frame their orbits stand nearly vertical while every other moon system lies nearly
 * flat. If the reference-plane transform were missing or wrong, Uranus's moons would lie flat
 * like the rest and nothing else would look obviously broken.
 *
 * The orbit normal is measured from two sampled positions rather than read from the elements,
 * so this checks the code path the renderer actually uses.
 */

import { describe, expect, it } from "vitest";
import { BODY_CONTRACTS, BODY_IDS, type BodyId } from "./registry";
import { heliocentricPositionOf } from "./position";
import { J2000_JD, jdTdb } from "../time";
import { cross, length, normalize, sub } from "../vec";

const MOONS = BODY_IDS.filter((id) => BODY_CONTRACTS[id].kind === "moon");
const RAD_TO_DEG = 180 / Math.PI;

/** Orbit normal, from three positions spread across a fraction of the moon's period. */
function orbitNormal(moon: BodyId) {
  const contract = BODY_CONTRACTS[moon];
  if (contract.ephemeris.kind !== "mean-elements-about-parent") throw new Error("not a satellite");
  const parent = contract.parent!;
  const step = Math.abs(contract.ephemeris.periodDays) / 8;

  const relative = (offset: number) => {
    const epoch = jdTdb(J2000_JD + offset);
    return sub(heliocentricPositionOf(moon, epoch), heliocentricPositionOf(parent, epoch));
  };

  const a = relative(0);
  const b = relative(step);
  return normalize(cross(a, b));
}

/** Angle between the orbit's normal and ecliptic north, degrees. */
function inclinationToEcliptic(moon: BodyId): number {
  const n = orbitNormal(moon);
  return Math.acos(Math.min(1, Math.max(-1, Math.abs(n.z)))) * RAD_TO_DEG;
}

describe("moon orbit planes in the ecliptic frame", () => {
  it("prints every moon's orbit plane", () => {
    const rows = MOONS.map((id) => {
      const contract = BODY_CONTRACTS[id];
      const ephemeris = contract.ephemeris;
      return {
        moon: id,
        parent: contract.parent,
        plane: ephemeris.kind === "mean-elements-about-parent" ? ephemeris.referencePlane : "n/a",
        "tilt from ecliptic": `${inclinationToEcliptic(id).toFixed(1)}°`,
        "orbit radius (km)":
          ephemeris.kind === "mean-elements-about-parent"
            ? (ephemeris.semiMajorAxisM / 1000).toFixed(0)
            : "n/a",
      };
    });
    console.table(rows);
    expect(rows.length).toBeGreaterThanOrEqual(20);
  });

  /**
   * The headline. Uranus is tipped 98 degrees, so its moons orbit a pole lying nearly in the
   * ecliptic, which puts their orbital planes nearly perpendicular to it.
   */
  it.each(MOONS.filter((id) => BODY_CONTRACTS[id].parent === "uranus"))(
    "%s orbits nearly perpendicular to the ecliptic, because Uranus is on its side",
    (moon) => {
      const tilt = inclinationToEcliptic(moon);
      expect(tilt, `${moon} orbit plane versus the ecliptic`).toBeGreaterThan(80);
    },
  );

  it.each(MOONS.filter((id) => ["jupiter", "mars"].includes(BODY_CONTRACTS[id].parent ?? "")))(
    "%s orbits close to the ecliptic, because its planet is barely tilted",
    (moon) => {
      const tilt = inclinationToEcliptic(moon);
      expect(tilt, `${moon} orbit plane versus the ecliptic`).toBeLessThan(30);
    },
  );

  it("Saturn's inner moons follow its 27 degree tilt", () => {
    for (const moon of ["mimas", "enceladus", "tethys", "dione", "rhea"] as const) {
      const tilt = inclinationToEcliptic(moon);
      expect(tilt, `${moon} should follow Saturn's obliquity`).toBeGreaterThan(20);
      expect(tilt, `${moon} should follow Saturn's obliquity`).toBeLessThan(35);
    }
  });

  /**
   * The Laplace transition, visible as a number. Iapetus sits past Saturn's Laplace radius,
   * so its orbit is pulled part of the way from Saturn's equator towards Saturn's own orbital
   * plane, and Phoebe further out is pulled almost all the way.
   */
  /**
   * Triton's orbit is inclined about 129.6 degrees to the ecliptic, and getting that right
   * depends entirely on using JPL's real ascending node. An earlier version invented a node,
   * which made its 157 degree inclination add to Neptune's 28 degree tilt instead of
   * combining with it, and produced a 5 degree orbit: almost in the ecliptic, and wrong.
   * The measurement folds angles past 90, so 129.6 reads as 50.4.
   */
  it("Triton's orbit is steeply inclined and retrograde, as a captured body's should be", () => {
    const folded = inclinationToEcliptic("triton");
    expect(folded, "Triton folded inclination").toBeGreaterThan(45);
    expect(folded, "Triton folded inclination").toBeLessThan(56);
    // Unfolded: the normal points below the ecliptic, so the orbit runs backwards.
    expect(orbitNormal("triton").z, "Triton's orbit normal must point south").toBeLessThan(0);
  });

  it("Iapetus and Phoebe sit between Saturn's equator and the ecliptic", () => {
    const inner = inclinationToEcliptic("rhea");
    const iapetus = inclinationToEcliptic("iapetus");
    const phoebe = inclinationToEcliptic("phoebe");

    expect(iapetus, "Iapetus should sit closer to the ecliptic than Rhea").toBeLessThan(inner);
    expect(phoebe, "Phoebe should sit closer still").toBeLessThan(iapetus);
  });

  it.each(MOONS)("%s stays a sensible distance from its parent over an orbit", (moon) => {
    const contract = BODY_CONTRACTS[moon];
    if (contract.ephemeris.kind !== "mean-elements-about-parent") return;
    const parent = contract.parent!;
    const a = contract.ephemeris.semiMajorAxisM;
    const e = contract.ephemeris.eccentricity;

    for (let i = 0; i < 12; i++) {
      const epoch = jdTdb(J2000_JD + (Math.abs(contract.ephemeris.periodDays) * i) / 12);
      const separation = length(
        sub(heliocentricPositionOf(moon, epoch), heliocentricPositionOf(parent, epoch)),
      );
      // Never closer than perihelion nor further than aphelion, allowing for rounding.
      expect(separation, `${moon} at sample ${i}`).toBeGreaterThan(a * (1 - e) * 0.98);
      expect(separation, `${moon} at sample ${i}`).toBeLessThan(a * (1 + e) * 1.02);
    }
  });
});
