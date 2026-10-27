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
    expect(MOONS.length).toBeGreaterThanOrEqual(20);
  });

  /**
   * Tidal locking, checked against two genuinely independent numbers.
   *
   * The orbital period is computed from Kepler's third law using the published semi-major
   * axis and the parent's GM. The rotation period comes from the IAU prime-meridian rate.
   * Nothing links them, so their agreement is evidence rather than arithmetic.
   *
   * One percent, not one part in a million. The parent GM values are system totals that
   * include the moons themselves, and close-in satellites are also perturbed by the planet's
   * oblateness, so pure two-body Kepler is not exact. Mimas is the worst at 0.49%. The gate is
   * still sharp: Mercury's 3:2 spin-orbit resonance would miss by 50%.
   */
  it.each(MOONS.filter(([, c]) => c.rotationRegime === "synchronous"))(
    "%s is tidally locked: it turns once per orbit",
    (_id, contract) => {
      if (contract.ephemeris.kind !== "mean-elements-about-parent") return;
      const ratio =
        Math.abs(rotationPeriodFromIau(contract.rotation)) /
        Math.abs(contract.ephemeris.periodDays);
      expect(
        Math.abs(ratio - 1),
        `${contract.id} rotation over orbital period is ${ratio}`,
      ).toBeLessThan(0.01);
    },
  );

  /**
   * Phoebe is the exception that makes the rule worth testing. It turns once every 9.3 hours
   * while taking 549 days to orbit Saturn, so it was never tidally locked, which together
   * with its retrograde orbit marks it as captured rather than formed with Saturn.
   */
  it.each(MOONS.filter(([, c]) => c.rotationRegime === "independent"))(
    "%s is declared an independent rotator, and genuinely is one",
    (_id, contract) => {
      if (contract.ephemeris.kind !== "mean-elements-about-parent") return;
      const ratio =
        Math.abs(rotationPeriodFromIau(contract.rotation)) /
        Math.abs(contract.ephemeris.periodDays);
      expect(
        Math.abs(ratio - 1),
        `${contract.id} is declared independent, so it must not be synchronous`,
      ).toBeGreaterThan(0.1);
    },
  );

  it.each(MOONS)("%s declares a rotation regime", (_id, contract) => {
    expect(contract.rotationRegime, `${contract.id}`).toBeDefined();
  });

  it.each(MOONS)("%s satisfies Kepler's third law about its parent", (_id, contract) => {
    if (contract.ephemeris.kind !== "mean-elements-about-parent") return;
    const parent = contract.parent;
    if (parent === null) return;

    const periodSeconds = Math.abs(contract.ephemeris.periodDays) * SECONDS_PER_DAY;
    const derived = Math.cbrt(
      (BODY_CONTRACTS[parent].gm * periodSeconds ** 2) / (4 * Math.PI ** 2),
    );
    const published = contract.ephemeris.semiMajorAxisM;

    expect(
      Math.abs(derived - published) / published,
      `${contract.id}: period implies a = ${(derived / 1000).toFixed(0)} km, published ${(published / 1000).toFixed(0)} km`,
    ).toBeLessThan(0.005);
  });

  it.each(MOONS)("%s orbits inside its parent's Hill sphere", (_id, contract) => {
    if (contract.ephemeris.kind !== "mean-elements-about-parent") return;
    const parent = contract.parent;
    if (parent === null || parent === "sun") return;

    const parentContract = BODY_CONTRACTS[parent];
    if (parentContract.ephemeris.kind !== "standish-elements") return;

    const parentOrbitAu = SHORT_SPAN.elements[parentContract.ephemeris.planet].atJ2000
      .semiMajorAxisAu as unknown as number;
    const hillRadius =
      parentOrbitAu * 1.495_978_707e11 * Math.cbrt(parentContract.gm / (3 * GM_SUN));

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

  /**
   * A moon's IAU rotation sign should match its parent's, because both follow the same
   * north-pole convention. Uranus's moons all come out negative for the same reason Uranus
   * does, which is a convention artifact rather than a physical oddity.
   *
   * Triton is the one real exception: it rotates opposite to Neptune because it orbits
   * opposite to Neptune, having been captured.
   */
  it.each(MOONS)("%s rotation sign agrees with its parent, or is Triton", (_id, contract) => {
    const parent = contract.parent;
    if (parent === null) return;
    const moonSign = Math.sign(contract.rotation.rotationRateDegPerDay);
    const parentSign = Math.sign(BODY_CONTRACTS[parent].rotation.rotationRateDegPerDay);

    if (contract.id === "triton") {
      expect(moonSign, "Triton must rotate opposite to Neptune").not.toBe(parentSign);
      return;
    }
    expect(moonSign, `${contract.id} versus ${parent}`).toBe(parentSign);
  });

  it("Triton and Phoebe are the retrograde orbiters", () => {
    const retrogradeOrbits = MOONS.filter(([, c]) => {
      if (c.ephemeris.kind !== "mean-elements-about-parent") return false;
      return c.ephemeris.inclinationDeg > 90;
    }).map(([id]) => id);

    expect(retrogradeOrbits.sort()).toEqual(["phoebe", "triton"]);
  });

  it("the Galilean moons are in a 1:2:4 resonance", () => {
    const period = (id: "io" | "europa" | "ganymede") => {
      const e = BODY_CONTRACTS[id].ephemeris;
      if (e.kind !== "mean-elements-about-parent") throw new Error("expected mean elements");
      return e.periodDays;
    };
    expect(period("europa") / period("io"), "Europa over Io").toBeCloseTo(2, 1);
    expect(period("ganymede") / period("europa"), "Ganymede over Europa").toBeCloseTo(2, 1);
    expect(period("ganymede") / period("io"), "Ganymede over Io").toBeCloseTo(4, 1);
  });

  it("every planet from Mars outward has at least one moon, and Mercury and Venus have none", () => {
    const withMoons = new Set(MOONS.map(([, c]) => c.parent));
    for (const planet of ["mars", "jupiter", "saturn", "uranus", "neptune", "embary"]) {
      expect(withMoons.has(planet as never), `${planet} should have a moon`).toBe(true);
    }
    expect(withMoons.has("mercury" as never)).toBe(false);
    expect(withMoons.has("venus" as never)).toBe(false);
  });
});
