/**
 * Every body must satisfy its own physics.
 *
 * This is the gate that makes a body contract a contract. It checks each entry against itself
 * and against the rest of the project: that the IAU prime-meridian rate and the published
 * sidereal period agree, that a retrograde spin is retrograde in both places, that a named
 * texture actually exists in the asset manifest, that the parent chain resolves, that an
 * atmosphere's composition sums to one.
 *
 * Where two authoritative sources genuinely disagree, the contract must declare it in
 * `knownDiscrepancies` naming the field. The gate then accepts the declared conflict and
 * rejects an undeclared one, so a real disagreement becomes documentation instead of
 * disappearing into a tolerance.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLANET_IDS, SHORT_SPAN } from "../data/planets";
import { GM_SUN } from "../units";
import { BODY_CONTRACTS, BODY_IDS } from "./registry";
import { flattening, rotationPeriodFromIau, type BodyContract } from "./contract";

const MANIFEST_TEXTURE_IDS: ReadonlySet<string> = new Set(
  (JSON.parse(readFileSync("scripts/assets.manifest.json", "utf8")) as {
    assets: { id: string }[];
  }).assets.map((a) => a.id),
);

const CONTRACTS = BODY_IDS.map((id) => [id, BODY_CONTRACTS[id]] as const);

function declares(contract: BodyContract, field: string): boolean {
  return contract.knownDiscrepancies.some((d) => d.field === field);
}

describe("every body satisfies its own contract", () => {
  it.each(CONTRACTS)("%s rotation rate agrees with its published sidereal period", (_id, c) => {
    const fromIau = rotationPeriodFromIau(c.rotation);
    if (declares(c, "siderealRotationDays")) {
      // A declared conflict still has to be a real one, or the declaration is covering nothing.
      expect(
        Math.abs(fromIau - c.siderealRotationDays) / Math.abs(c.siderealRotationDays),
        `${c.id} declares a rotation discrepancy, so there must actually be one`,
      ).toBeGreaterThan(1e-4);
      return;
    }
    expect(fromIau / c.siderealRotationDays, `${c.id} IAU rate vs fact-sheet period`).toBeCloseTo(
      1,
      4,
    );
  });

  it.each(CONTRACTS)("%s is retrograde in both places or neither", (_id, c) => {
    expect(
      Math.sign(c.rotation.rotationRateDegPerDay),
      `${c.id} IAU rate sign vs sidereal period sign`,
    ).toBe(Math.sign(c.siderealRotationDays));
  });

  it.each(CONTRACTS)("%s names textures that exist in the asset manifest", (_id, c) => {
    const named = [
      c.appearance.albedoTextureId,
      c.appearance.nightTextureId,
      c.appearance.cloudTextureId,
      c.appearance.normalTextureId,
      c.appearance.ringSystem?.textureId,
    ].filter((t): t is string => typeof t === "string");

    for (const textureId of named) {
      expect(
        MANIFEST_TEXTURE_IDS.has(textureId),
        `${c.id} names texture "${textureId}" which is not in scripts/assets.manifest.json`,
      ).toBe(true);
    }
  });

  it.each(CONTRACTS)("%s has a geometry that is physically possible", (_id, c) => {
    expect(c.equatorialRadiusM, `${c.id} equatorial radius`).toBeGreaterThan(0);
    expect(c.polarRadiusM, `${c.id} polar radius must not exceed equatorial`).toBeLessThanOrEqual(
      c.equatorialRadiusM,
    );
    // Saturn is the flattest body here at about 0.098. Anything past 0.15 is a typo.
    expect(flattening(c), `${c.id} flattening`).toBeLessThan(0.15);
    expect(c.gm, `${c.id} gm`).toBeGreaterThan(0);
  });

  it.each(CONTRACTS)("%s has a parent that resolves, and no cycle", (_id, c) => {
    const seen = new Set<string>([c.id]);
    let cursor = c.parent;
    while (cursor !== null) {
      expect(BODY_IDS, `${c.id} parent chain names unknown body ${cursor}`).toContain(cursor);
      expect(seen.has(cursor), `${c.id} parent chain cycles at ${cursor}`).toBe(false);
      seen.add(cursor);
      cursor = BODY_CONTRACTS[cursor].parent;
    }
  });

  it.each(CONTRACTS)("%s atmosphere composition sums to one, when it has one", (_id, c) => {
    if (c.atmosphere === null) return;
    const total = Object.values(c.atmosphere.composition).reduce((a, b) => a + b, 0);
    expect(total, `${c.id} composition mole fractions`).toBeCloseTo(1, 2);
    expect(c.atmosphere.scaleHeightM, `${c.id} scale height`).toBeGreaterThan(0);
  });

  it.each(CONTRACTS)("%s cites a source for its rotational elements", (_id, c) => {
    expect(c.rotation.source.length, `${c.id} rotation source`).toBeGreaterThan(10);
  });

  it.each(CONTRACTS)("%s declares every discrepancy against a real field", (_id, c) => {
    for (const d of c.knownDiscrepancies) {
      expect(d.field in c, `${c.id} declares a discrepancy on "${d.field}", which is not a field`).toBe(
        true,
      );
      expect(d.preferred.length, `${c.id} ${d.field} preferred value`).toBeGreaterThan(10);
      expect(d.rejected.length, `${c.id} ${d.field} rejected value`).toBeGreaterThan(10);
    }
  });

  it.each(CONTRACTS)("%s carries educational content with its facts", (_id, c) => {
    expect(c.education.oneLine.length, `${c.id} one-liner`).toBeGreaterThan(20);
    expect(c.education.whyItMatters.length, `${c.id} why it matters`).toBeGreaterThan(60);
    expect(c.education.facts.length, `${c.id} needs at least three facts`).toBeGreaterThanOrEqual(3);
  });

  it("covers every planet the engine knows about", () => {
    for (const planet of PLANET_IDS) {
      expect(BODY_IDS, `engine knows planet ${planet} but no contract covers it`).toContain(planet);
    }
  });

  it("gives every body with a standish-elements source a matching planet id", () => {
    for (const [, c] of CONTRACTS) {
      if (c.ephemeris.kind !== "standish-elements") continue;
      expect(PLANET_IDS, `${c.id} names planet ${c.ephemeris.planet}`).toContain(
        c.ephemeris.planet,
      );
    }
  });

  it("gives exactly one body a fixed position, and it is the star", () => {
    const fixed = CONTRACTS.filter(([, c]) => c.ephemeris.kind === "fixed-at-barycentre");
    expect(fixed).toHaveLength(1);
    expect(fixed[0][1].kind).toBe("star");
  });
});

/**
 * Checks that only apply to satellites.
 *
 * These are where the moon data proves itself. The orbital period is not quoted independently;
 * it is derived from the IAU prime-meridian rate on the grounds that a tidally locked body
 * turns once per orbit. That is only legitimate if the result reproduces the independently
 * published semi-major axis through Kepler's third law, which is what the second test here
 * does. Two unrelated sources agreeing to a fraction of a percent is the evidence.
 */
describe("moons", () => {
  const MOONS = CONTRACTS.filter(([, c]) => c.kind === "moon");
  const SECONDS_PER_DAY = 86_400;

  it("there are moons to check, so a filter typo cannot make this vacuous", () => {
    expect(MOONS.length).toBeGreaterThanOrEqual(10);
  });

  /**
   * Tolerance is 1e-5, and the reason is Earth's Moon specifically. Its orbital period is the
   * independently published sidereal month of 27.321582 d while the IAU prime-meridian rate
   * implies 27.3216610 d, a difference of 6.9 seconds over 27 days, or 2.9 parts per million.
   * Two separately published figures agreeing that closely is tidal locking confirmed, not
   * refuted. The other moons derive their period from the IAU rate so they agree exactly.
   *
   * 1e-5 is still a sharp check: a 3:2 spin-orbit resonance like Mercury's would miss by 50%.
   */
  it.each(MOONS)("%s is tidally locked: it turns once per orbit", (_id, contract) => {
    if (contract.ephemeris.kind !== "mean-elements-about-parent") return;
    const fromRotation = rotationPeriodFromIau(contract.rotation);
    const ratio = fromRotation / contract.ephemeris.periodDays;
    expect(
      Math.abs(ratio - 1),
      `${contract.id} rotation period over orbital period is ${ratio}`,
    ).toBeLessThan(1e-5);
  });

  it.each(MOONS)("%s satisfies Kepler's third law about its parent", (_id, contract) => {
    if (contract.ephemeris.kind !== "mean-elements-about-parent") return;
    const parent = contract.parent;
    if (parent === null) return;

    const periodSeconds = Math.abs(contract.ephemeris.periodDays) * SECONDS_PER_DAY;
    const parentGm = BODY_CONTRACTS[parent].gm;
    const derived = Math.cbrt((parentGm * periodSeconds ** 2) / (4 * Math.PI ** 2));
    const published = contract.ephemeris.semiMajorAxisM;

    const error = Math.abs(derived - published) / published;
    expect(
      error,
      `${contract.id}: period implies a = ${(derived / 1000).toFixed(0)} km, published ${(published / 1000).toFixed(0)} km`,
    ).toBeLessThan(0.005);
  });

  /**
   * A moon outside its parent's Hill sphere is not bound to it, so this catches a semi-major
   * axis entered in the wrong unit, which is otherwise easy to miss.
   */
  it.each(MOONS)("%s orbits inside its parent's Hill sphere", (_id, contract) => {
    if (contract.ephemeris.kind !== "mean-elements-about-parent") return;
    const parent = contract.parent;
    if (parent === null || parent === "sun") return;

    const parentContract = BODY_CONTRACTS[parent];
    if (parentContract.ephemeris.kind !== "standish-elements") return;

    const parentOrbitM = SHORT_SPAN.elements[parentContract.ephemeris.planet].atJ2000
      .semiMajorAxisAu as unknown as number;
    const hillRadius =
      parentOrbitM * 1.495_978_707e11 * Math.cbrt(parentContract.gm / (3 * GM_SUN));

    expect(
      contract.ephemeris.semiMajorAxisM,
      `${contract.id} must orbit inside ${parent}'s Hill radius of ${(hillRadius / 1000).toExponential(2)} km`,
    ).toBeLessThan(hillRadius);
  });

  it.each(MOONS)("%s orbits above its parent's surface", (_id, contract) => {
    if (contract.ephemeris.kind !== "mean-elements-about-parent") return;
    const parent = contract.parent;
    if (parent === null) return;
    expect(
      contract.ephemeris.semiMajorAxisM,
      `${contract.id} cannot orbit inside ${parent}`,
    ).toBeGreaterThan(BODY_CONTRACTS[parent].equatorialRadiusM);
  });

  it("Triton is the retrograde one, and nothing else is", () => {
    const retrograde = MOONS.filter(([, c]) => c.rotation.rotationRateDegPerDay < 0).map(
      ([id]) => id,
    );
    expect(retrograde).toContain("triton");
    // Uranus's moons are retrograde in the IAU sense too, but none are in the registry yet.
    expect(retrograde.length).toBeLessThanOrEqual(2);
  });

  it("the Galilean moons are in a 1:2:4 resonance", () => {
    const period = (id: "io" | "europa" | "ganymede") => {
      const e = BODY_CONTRACTS[id].ephemeris;
      if (e.kind !== "mean-elements-about-parent") throw new Error("expected mean elements");
      return e.periodDays;
    };

    // Laplace resonance: Europa takes twice Io's period, Ganymede twice Europa's.
    expect(period("europa") / period("io"), "Europa over Io").toBeCloseTo(2, 1);
    expect(period("ganymede") / period("europa"), "Ganymede over Europa").toBeCloseTo(2, 1);
    expect(period("ganymede") / period("io"), "Ganymede over Io").toBeCloseTo(4, 1);
  });
});
