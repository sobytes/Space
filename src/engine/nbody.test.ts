/**
 * The N-body gate.
 *
 * The mode's claim is that every body pulls every other. Three families of test back it.
 *
 * Free checks. Energy, momentum and angular momentum are conserved by the equation and are
 * never handed to the integrator, so any drift in them is numerical error and nothing else.
 * These cost nothing to assert and they catch almost every class of mistake in a force loop.
 *
 * Cross-checks. `secular.ts` computes apsidal precession by orbit-averaging the disturbing
 * function and applying Lagrange's planetary equation, which shares no code and almost no
 * method with Cartesian integration. Agreement between them is evidence about the physics. One
 * further rung down, the small-alpha closed form is hand-derived algebra, so the chain ends at
 * something no numerical method produced.
 *
 * Consequences. A mass added to the system must move the other planets, and by a sensible
 * amount. That is the feature, so it gets measured rather than asserted to exist.
 */

import { describe, expect, it } from "vitest";
import { EXPECTATIONS } from "./data/nbody-expectations";
import { PLANET_IDS } from "./data/planets";
import { PHYSICAL } from "./data/physical";
import { osculatingElements } from "./elements";
import {
  accelerations,
  advance,
  apsidalPrecession,
  barycentre,
  influenceOf,
  positionOf,
  radPerSecondToArcsecPerCentury,
  solarSystemAt,
  totalAngularMomentum,
  totalEnergy,
  totalMomentum,
  velocityOf,
  zeroMass,
  type MassiveBody,
  type NBodyLimits,
} from "./nbody";
import { leadingOrderPericentreRate, secularPericentreRate } from "./secular";
import { J2000_JD, jdTdb } from "./time";
import { AU_IN_METRES, GM_SUN, SECONDS_PER_DAY } from "./units";
import { length, sub } from "./vec";

const YEAR = 365.25 * SECONDS_PER_DAY;
const SOLAR_RADIUS_M = 6.957e8;
const TIGHT: NBodyLimits = { tolerance: 1e-13, minStepSeconds: 60, maxStepSeconds: SECONDS_PER_DAY };
const COARSE: NBodyLimits = { ...TIGHT, maxStepSeconds: 5 * SECONDS_PER_DAY };

/** A body on a circular orbit at `au`, placed on the +x axis. */
function circular(id: string, gm: number, au: number): MassiveBody {
  const a = au * AU_IN_METRES;
  return {
    id,
    gm,
    position: { x: a, y: 0, z: 0 },
    velocity: { x: 0, y: Math.sqrt((GM_SUN + gm) / a), z: 0 },
  };
}

// ---------------------------------------------------------------------------------------------
// Expensive runs, done once. Module scope keeps them clear of per-test timeouts, the same way
// kepler.test.ts handles its fixture measurements.
// ---------------------------------------------------------------------------------------------

const CONSERVATION = (() => {
  const system = solarSystemAt(jdTdb(J2000_JD));
  const totalGm = system.gm.reduce((sum, value) => sum + value, 0);
  const before = {
    energy: totalEnergy(system),
    angular: totalAngularMomentum(system),
    momentum: totalMomentum(system),
    centre: barycentre(system),
  };
  const { steps } = advance(system, 100 * YEAR, TIGHT);
  const after = {
    energy: totalEnergy(system),
    angular: totalAngularMomentum(system),
    momentum: totalMomentum(system),
    centre: barycentre(system),
  };
  return {
    steps,
    totalGm,
    energyDrift: Math.abs((after.energy - before.energy) / before.energy),
    angularDrift: length(sub(after.angular, before.angular)) / length(before.angular),
    // Momentum has units of gm times speed, so divide by the system's gm to read it as the
    // barycentre's drift speed. The raw sum starts at pure round-off, which makes a ratio of
    // raw magnitudes meaningless; a speed has a scale you can judge.
    driftSpeedBefore: length(before.momentum) / totalGm,
    driftSpeedAfter: length(after.momentum) / totalGm,
    centreDriftM: length(sub(after.centre, before.centre)),
  };
})();

const SUN_WOBBLE = (() => {
  const system = solarSystemAt(jdTdb(J2000_JD));
  let min = Infinity;
  let max = 0;
  for (let i = 0; i < 360; i++) {
    advance(system, YEAR / 12, COARSE);
    const d = length(positionOf(system, "sun"));
    min = Math.min(min, d);
    max = Math.max(max, d);
  }
  return { min, max };
})();

const PRECESSION = {
  all: apsidalPrecession({ body: "mercury", epoch: jdTdb(J2000_JD), spanYears: 300, limits: TIGHT }),
  earthOnly: apsidalPrecession({
    body: "mercury", epoch: jdTdb(J2000_JD), spanYears: 300, limits: TIGHT,
    planets: ["mercury", "embary"],
  }),
  mercuryAlone: apsidalPrecession({
    body: "mercury", epoch: jdTdb(J2000_JD), spanYears: 300, limits: TIGHT,
    planets: ["mercury"],
  }),
};

/**
 * The controlled comparison against secular theory. Both bodies are injected rather than read
 * from the ephemeris, so the configuration is exactly coplanar with an exactly circular
 * perturber, which is the regime the quadrature is derived for. Comparing against the real
 * inclined, eccentric planets would confound the test with the orbits' shape; measured, that
 * confounding is worth 6% for Venus, far larger than the agreement being claimed.
 */
const CONTROLLED = (() => {
  const a1 = 0.38709927 * AU_IN_METRES;
  const e1 = 0.20563593;
  const gmMercury = PHYSICAL.mercury.gm;
  const mercury: MassiveBody = {
    id: "mercury",
    gm: gmMercury,
    position: { x: a1 * (1 - e1), y: 0, z: 0 },
    velocity: { x: 0, y: Math.sqrt(((GM_SUN + gmMercury) * (1 + e1)) / (a1 * (1 - e1))), z: 0 },
  };

  const cases = [
    { name: "Venus mass at 0.7233 au", gm: PHYSICAL.venus.gm, au: 0.72333566 },
    { name: "Earth+Moon at 1.0000 au", gm: PHYSICAL.embary.gm, au: 1.00000261 },
    { name: "Jupiter at 5.2029 au", gm: PHYSICAL.jupiter.gm, au: 5.202887 },
    { name: "Jupiter mass at 60 au", gm: PHYSICAL.jupiter.gm, au: 60 },
  ];

  return cases.map((entry) => {
    const config = {
      semiMajorAxisM: a1,
      eccentricity: e1,
      gm: gmMercury,
      perturberGm: entry.gm,
      perturberSemiMajorAxisM: entry.au * AU_IN_METRES,
    };
    const quadrature = radPerSecondToArcsecPerCentury(secularPericentreRate(config, 600));
    const leading = radPerSecondToArcsecPerCentury(leadingOrderPericentreRate(config));
    const integrated = apsidalPrecession({
      body: "mercury",
      epoch: jdTdb(J2000_JD),
      spanYears: 300,
      planets: [],
      extra: [mercury, circular("perturber", entry.gm, entry.au)],
      limits: TIGHT,
    }).pericentreArcsecPerCentury;
    return {
      ...entry,
      alpha: a1 / (entry.au * AU_IN_METRES),
      quadrature,
      leading,
      integrated,
      agreement: Math.abs(quadrature - integrated) / Math.abs(quadrature),
      leadingRatio: leading / quadrature,
    };
  });
})();

const INFLUENCE = {
  jupiter: influenceOf(jdTdb(J2000_JD), "jupiter", 10 * YEAR, [], COARSE),
  mercury: influenceOf(jdTdb(J2000_JD), "mercury", 10 * YEAR, [], COARSE),
  intruder: influenceOf(
    jdTdb(J2000_JD),
    "intruder",
    10 * YEAR,
    [circular("intruder", PHYSICAL.embary.gm, 3)],
    COARSE,
  ),
};

const find = (list: readonly { id: string; metres: number }[], id: string): number => {
  const hit = list.find((entry) => entry.id === id);
  if (!hit) throw new Error(`${id} missing from the influence result`);
  return hit.metres;
};

// ---------------------------------------------------------------------------------------------

describe("the force law", () => {
  it("reproduces a hand-computed two-body acceleration", () => {
    // A tracer one au from a solar mass falls at GM/r^2. Nothing here is from the engine.
    const gm = new Float64Array([GM_SUN, 0]);
    const state = new Float64Array([0, 0, 0, 0, 0, 0, AU_IN_METRES, 0, 0, 0, 0, 0]);
    const out = new Float64Array(6);
    accelerations(gm, state, out);

    // Worked by hand so the literal is independent of the constants the engine uses:
    // au^2 = (1.495978707e11)^2 = 2.237952291e22, and 1.32712440041e20 / 2.237952291e22
    // = 5.9300835e-3 m/s^2. This is the Sun's gravity at Earth's distance.
    const expected = GM_SUN / (AU_IN_METRES * AU_IN_METRES);
    expect(expected).toBeCloseTo(5.9300835e-3, 9);
    expect(out[3]).toBeCloseTo(-expected, 15);
    expect(out[4]).toBe(0);
    expect(out[5]).toBe(0);
    // A massless tracer pulls nothing.
    expect(out[0]).toBe(0);
  });

  it("obeys Newton's third law exactly, which is why momentum is conserved", () => {
    const gm = new Float64Array([GM_SUN, PHYSICAL.jupiter.gm]);
    const state = new Float64Array([0, 0, 0, 0, 0, 0, 3e11, 4e11, 1e10, 0, 0, 0]);
    const out = new Float64Array(6);
    accelerations(gm, state, out);

    // mu_1 a_1 = -mu_2 a_2, to round-off. The pair loop applies each separation once and gives
    // both bodies equal and opposite impulses, so this is structural rather than incidental.
    for (const axis of [0, 1, 2]) {
      const left = gm[0] * out[axis];
      const right = gm[1] * out[3 + axis];
      expect(Math.abs(left + right) / Math.abs(left)).toBeLessThan(1e-15);
    }
  });

  it("starts at the barycentre with zero net momentum", () => {
    const system = solarSystemAt(jdTdb(J2000_JD));
    expect(length(barycentre(system))).toBeLessThan(1e-6);
    expect(CONSERVATION.driftSpeedBefore).toBeLessThan(1e-12);
  });

  it("refuses a non-finite duration instead of silently doing nothing", () => {
    const system = solarSystemAt(jdTdb(J2000_JD));
    expect(() => advance(system, Number.NaN, TIGHT)).toThrow(/finite duration/);
    expect(system.elapsed).toBe(0);
  });
});

describe("conserved quantities over 100 years", () => {
  it("keeps energy", () => {
    expect(CONSERVATION.steps).toBeGreaterThan(100_000);
    expect(CONSERVATION.energyDrift).toBeLessThan(1e-12);
  });

  it("keeps angular momentum", () => {
    expect(CONSERVATION.angularDrift).toBeLessThan(1e-12);
  });

  it("keeps the barycentre still", () => {
    // Reported as a speed and a distance, both with physical scales: a sub-picometre-per-second
    // drift over a century moves the barycentre well under a millimetre.
    expect(CONSERVATION.driftSpeedAfter).toBeLessThan(1e-10);
    expect(CONSERVATION.centreDriftM).toBeLessThan(1);
  });
});

describe("the Sun moves", () => {
  it("wobbles about the barycentre by close to two solar radii", () => {
    const expectation = EXPECTATIONS.sunBarycentreMaxOverThirtyYears;
    expect(Math.abs(SUN_WOBBLE.max - expectation.value) / expectation.value).toBeLessThan(
      expectation.tolerance,
    );
  });

  it("puts the barycentre outside its own surface, as it is known to do", () => {
    expect(SUN_WOBBLE.max).toBeGreaterThan(SOLAR_RADIUS_M);
    // And comes back inside, so this is a wobble and not a constant offset.
    expect(SUN_WOBBLE.min).toBeLessThan(SOLAR_RADIUS_M);
  });
});

describe("Mercury's perihelion, Newtonian", () => {
  it("advances at the rate the planets imply", () => {
    const expectation = EXPECTATIONS.mercuryPlanetaryPrecession;
    const measured = PRECESSION.all.pericentreArcsecPerCentury;
    expect(
      Math.abs(measured - expectation.value) / expectation.value,
      `measured ${measured.toFixed(2)} against a recalled ${expectation.value}`,
    ).toBeLessThan(expectation.tolerance);
  });

  it("gets the Earth and Moon's share right to a tenth of a percent", () => {
    const expectation = EXPECTATIONS.earthContributionToMercury;
    const measured = PRECESSION.earthOnly.pericentreArcsecPerCentury;
    expect(Math.abs(measured - expectation.value) / expectation.value).toBeLessThan(
      expectation.tolerance,
    );
  });

  /**
   * The null test, and the one that matters most. With no perturber there is no precession, so
   * any nonzero rate here would be the integrator's own error masquerading as physics and every
   * positive result above would be worthless.
   */
  it("does not precess at all with no perturber", () => {
    expect(Math.abs(PRECESSION.mercuryAlone.pericentreArcsecPerCentury)).toBeLessThan(0.01);
  });

  it("distinguishes varpi from the projected longitude, because the orbit is inclined", () => {
    const { pericentreArcsecPerCentury: classical, projectedArcsecPerCentury: projected } =
      PRECESSION.all;
    // Measured at 2.6 arcsec/century, half a percent of the total. Asserting they differ keeps
    // the two conventions from being quietly collapsed into one.
    expect(Math.abs(classical - projected)).toBeGreaterThan(1);
    expect(Math.abs(classical - projected)).toBeLessThan(5);
  });

  it("regresses the node, which is a separate motion from the apse", () => {
    expect(PRECESSION.all.nodeArcsecPerCentury).toBeLessThan(-400);
  });

  it("integrates accurately enough for the fit to mean something", () => {
    expect(PRECESSION.all.energyDrift).toBeLessThan(1e-11);
    expect(PRECESSION.all.samples).toBeGreaterThan(1000);
  });
});

describe("secular theory as an independent opinion", () => {
  it("converges as the quadrature is refined", () => {
    const config = {
      semiMajorAxisM: 0.38709927 * AU_IN_METRES,
      eccentricity: 0.20563593,
      gm: PHYSICAL.mercury.gm,
      perturberGm: PHYSICAL.venus.gm,
      perturberSemiMajorAxisM: 0.72333566 * AU_IN_METRES,
    };
    const coarse = secularPericentreRate(config, 300);
    const fine = secularPericentreRate(config, 900);
    expect(Math.abs(fine - coarse) / Math.abs(fine)).toBeLessThan(1e-4);
  });

  it.each(CONTROLLED.filter((c) => c.alpha > 0.01))(
    "agrees with the integrator for $name",
    (entry) => {
      expect(entry.agreement, `quadrature ${entry.quadrature} vs integrated ${entry.integrated}`)
        .toBeLessThan(1e-3);
    },
  );

  it("converges onto the hand-derived closed form as alpha shrinks", () => {
    const expectation = EXPECTATIONS.leadingOrderCoefficient;
    const distant = CONTROLLED.find((c) => c.au === 60);
    if (!distant) throw new Error("the distant case is missing");
    expect(distant.alpha).toBeLessThan(0.01);
    expect(Math.abs(distant.leadingRatio - expectation.value)).toBeLessThan(expectation.tolerance);
  });

  /**
   * And the closed form must be wrong where it has no right to work. Without this, a quadrature
   * that had silently collapsed to the leading term would pass every test above.
   */
  it("departs from the closed form where alpha is large", () => {
    const venus = CONTROLLED.find((c) => c.au === 0.72333566);
    if (!venus) throw new Error("the Venus case is missing");
    expect(venus.alpha).toBeGreaterThan(0.5);
    expect(venus.leadingRatio).toBeLessThan(0.6);
  });
});

describe("a mass in the system changes the rest of it", () => {
  it("moves every other planet, with no exceptions", () => {
    for (const planet of PLANET_IDS) {
      if (planet === "jupiter") continue;
      expect(find(INFLUENCE.jupiter, planet), `Jupiter's pull on ${planet}`).toBeGreaterThan(0);
    }
    // Including the smallest planet's effect on the largest, which is small but not zero.
    expect(find(INFLUENCE.mercury, "jupiter")).toBeGreaterThan(1e6);
  });

  it("moves Saturn most of all, by millions of kilometres in a decade", () => {
    // True at J2000, which this run pins, and not a general fact: the same measurement from
    // 2026 puts Neptune first and Saturn eleven times lower, because the differential response
    // depends on the phase of the roughly 900-year Jupiter-Saturn great inequality. Do not
    // generalise this ranking to other epochs.
    const saturn = find(INFLUENCE.jupiter, "saturn");
    expect(saturn).toBeGreaterThan(1e10);
    const others = INFLUENCE.jupiter
      .filter((entry) => entry.id !== "saturn" && entry.id !== "sun")
      .map((entry) => entry.metres);
    expect(saturn).toBeGreaterThan(Math.max(...others));
  });

  it("ranks the giants above the terrestrials, as their masses require", () => {
    expect(find(INFLUENCE.jupiter, "uranus")).toBeGreaterThan(find(INFLUENCE.mercury, "uranus"));
  });

  it("makes an added planet perturb the existing ones", () => {
    // An Earth-mass body placed at 3 au. This is the whole point of the mode: a body that is
    // not in any ephemeris still has to pull on everything.
    expect(find(INFLUENCE.intruder, "jupiter")).toBeGreaterThan(1e8);
    expect(find(INFLUENCE.intruder, "embary")).toBeGreaterThan(1e6);
    expect(find(INFLUENCE.intruder, "mercury")).toBeGreaterThan(0);
  });

  it("names a body it cannot find rather than silently measuring nothing", () => {
    const system = solarSystemAt(jdTdb(J2000_JD));
    expect(() => zeroMass(system, "planet-x")).toThrow(/not in this system/);
  });
});

describe("determinism", () => {
  it("gives bit-identical results from identical inputs", () => {
    // There is no randomness anywhere in this system. Asserting bit equality rather than
    // approximate equality is what makes that a claim with teeth: a stray Math.random, an
    // iteration order that depends on object key insertion, or a reused scratch buffer leaking
    // between runs would all break this and none of them would break a tolerance-based check.
    const a = solarSystemAt(jdTdb(J2000_JD));
    const b = solarSystemAt(jdTdb(J2000_JD));
    advance(a, 11 * YEAR, COARSE);
    advance(b, 11 * YEAR, COARSE);
    expect(Array.from(b.state)).toEqual(Array.from(a.state));
    expect(b.elapsed).toBe(a.elapsed);
  });

  it("reaches the same place whether it is advanced in one call or many", () => {
    // Not bit-identical: the adaptive controller restarts on each call, so the step sequence
    // differs. Agreement to the integrator's own tolerance is the right bar.
    const once = solarSystemAt(jdTdb(J2000_JD));
    const split = solarSystemAt(jdTdb(J2000_JD));
    advance(once, 4 * YEAR, COARSE);
    for (let i = 0; i < 8; i++) advance(split, 0.5 * YEAR, COARSE);

    const a = sub(positionOf(once, "embary"), positionOf(once, "sun"));
    const b = sub(positionOf(split, "embary"), positionOf(split, "sun"));
    expect(length(sub(a, b)) / length(a)).toBeLessThan(1e-9);
  });
});

describe("the orbits stay orbits", () => {
  it("holds every planet's semi-major axis over a century", () => {
    // Osculating elements breathe under perturbation, so this is not a tight bound. What it
    // catches is a body being flung or spiralling, which is what a sign error in the force law
    // or a runaway step size produces.
    const system = solarSystemAt(jdTdb(J2000_JD));
    const before = PLANET_IDS.map((planet) =>
      osculatingElements(
        GM_SUN + PHYSICAL[planet].gm,
        sub(positionOf(system, planet), positionOf(system, "sun")),
        sub(velocityOf(system, planet), velocityOf(system, "sun")),
      ),
    );
    advance(system, 100 * YEAR, COARSE);

    PLANET_IDS.forEach((planet, index) => {
      const after = osculatingElements(
        GM_SUN + PHYSICAL[planet].gm,
        sub(positionOf(system, planet), positionOf(system, "sun")),
        sub(velocityOf(system, planet), velocityOf(system, "sun")),
      );
      const change =
        Math.abs(after.semiMajorAxisM - before[index].semiMajorAxisM) /
        before[index].semiMajorAxisM;
      expect(change, `${planet} semi-major axis`).toBeLessThan(0.01);
      expect(after.eccentricity, `${planet} eccentricity`).toBeLessThan(0.3);
    });
  });
});

describe("the declared expectations stay honest", () => {
  it("requires every unverified expectation to say so at length", () => {
    for (const [key, expectation] of Object.entries(EXPECTATIONS)) {
      if (expectation.verified) continue;
      expect(expectation.kind, `${key} is unverified, so it cannot be a derived value`).toBe(
        "external",
      );
      expect(
        expectation.provenance.length,
        `${key} is unverified and must explain what is missing`,
      ).toBeGreaterThan(200);
      // A tolerance tighter than a percent around a recalled figure is false precision.
      expect(expectation.tolerance, `${key} is unverified and claims too much`).toBeGreaterThan(
        0.005,
      );
    }
  });

  it("requires derived expectations to be tight, since another method produced them", () => {
    for (const [key, expectation] of Object.entries(EXPECTATIONS)) {
      if (expectation.kind !== "derived") continue;
      expect(expectation.verified, `${key} is derived in-repo and should be verified`).toBe(true);
      expect(expectation.tolerance, `${key} is derived and should be gated tightly`).toBeLessThan(
        0.06,
      );
    }
  });
});
