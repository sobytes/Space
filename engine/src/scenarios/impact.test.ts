import { describe, expect, it } from "vitest";
import {
  airburstAltitude,
  finalCraterDiameter,
  impactConsequences,
  seismicMagnitude,
  simpleToComplexDiameter,
  transientCraterDiameter,
} from "./impact";

/**
 * The impact model, against impacts that actually happened.
 *
 * Four events span eight orders of magnitude in energy and, more usefully, span the two
 * outcomes the model has to tell apart: Chelyabinsk and Tunguska burst in the air and left no
 * crater, Barringer and Chicxulub reached the ground and left famous ones. Getting the energy
 * right is easy; getting that split right is the whole model.
 *
 * A first version got it exactly backwards for Tunguska, by comparing the impactor's mass per
 * unit area against the atmosphere's. Fifty-five metres of rock is 121,000 kg per square metre
 * against Earth's 10,300, so by that test it punches through, and in 1908 it did not.
 */
describe("impacts that happened", () => {
  const EARTH = { target: "embary", angleDeg: 45 } as const;

  it("reproduces the Chelyabinsk airburst", () => {
    // 19 m, 3300 kg/m3, 19.16 km/s at 18 degrees: Brown et al. 2013, Nature 503, 238.
    const r = impactConsequences({ ...EARTH, diameterM: 19, densityKgM3: 3300, speedMS: 19_160, angleDeg: 18 });
    expect(r.energyMegatonsTnt).toBeGreaterThan(0.4);
    expect(r.energyMegatonsTnt).toBeLessThan(0.7);
    expect(r.airburst, "Chelyabinsk did not reach the ground").toBe(true);
    expect(r.craterDiameterM).toBeNull();
    // Measured burst altitude 23.3 km. The inputs carry more uncertainty than the model.
    expect(r.burstAltitudeM! / 1000).toBeGreaterThan(18);
    expect(r.burstAltitudeM! / 1000).toBeLessThan(30);
  });

  it("reproduces the Tunguska airburst", () => {
    const r = impactConsequences({ ...EARTH, diameterM: 55, densityKgM3: 2200, speedMS: 20_000 });
    expect(r.airburst, "Tunguska left no crater, so it cannot have reached the ground").toBe(true);
    expect(r.craterDiameterM).toBeNull();
    // Published estimates of the burst altitude run from about 5 to 10 km.
    expect(r.burstAltitudeM! / 1000).toBeGreaterThan(4);
    expect(r.burstAltitudeM! / 1000).toBeLessThan(15);
    // The forest was flattened out to roughly 20 to 30 km.
    const housesCollapse = r.blast.find((b) => b.overpressurePa === 20_000)!;
    expect(housesCollapse.radiusM / 1000).toBeGreaterThan(8);
    expect(housesCollapse.radiusM / 1000).toBeLessThan(45);
  });

  /**
   * Barringer Crater, Arizona: 1,186 m across, from about 50 m of iron at 12.8 km/s.
   *
   * The tolerance is wide on purpose. Pi-group scaling is an empirical fit across many orders
   * of magnitude and is usually quoted as good to a few tens of per cent, so demanding better
   * would be demanding the model be more precise than it is.
   */
  it("reproduces Barringer Crater to within the scaling law's accuracy", () => {
    const r = impactConsequences({ ...EARTH, diameterM: 50, densityKgM3: 8000, speedMS: 12_800 });
    expect(r.airburst, "an iron body this size is not stopped by air").toBe(false);
    expect(r.craterDiameterM! / 1186).toBeGreaterThan(0.6);
    expect(r.craterDiameterM! / 1186).toBeLessThan(1.6);
  });

  it("puts Chicxulub on the right side of a hundred kilometres", () => {
    const r = impactConsequences({ ...EARTH, diameterM: 10_000, densityKgM3: 3000, speedMS: 20_000 });
    expect(r.airburst).toBe(false);
    expect(r.craterDiameterM! / 1000).toBeGreaterThan(80);
    expect(r.craterDiameterM! / 1000).toBeLessThan(260);
    expect(r.seismicMagnitude!).toBeGreaterThan(9);
  });
});

describe("the same rock on different worlds", () => {
  const ROCK = { diameterM: 50, densityKgM3: 8000, speedMS: 12_800, angleDeg: 45 } as const;

  /**
   * Gravity is why the Moon's craters are bigger.
   *
   * Crater scaling carries g to the power of minus 0.22, so a sixth of the gravity widens the
   * crater by about 1.45. This is the clearest test that the model is doing physics rather
   * than converting energy into a number: nothing about the impactor changed.
   */
  it("digs a wider crater on the Moon than on Earth, for the same impactor", () => {
    const earth = impactConsequences({ ...ROCK, target: "embary" });
    const moon = impactConsequences({ ...ROCK, target: "moon" });
    expect(moon.craterDiameterM!).toBeGreaterThan(earth.craterDiameterM!);
    expect(moon.craterDiameterM! / earth.craterDiameterM!).toBeCloseTo(1.45, 1);
  });

  it("has no blast wave where there is no atmosphere", () => {
    const moon = impactConsequences({ ...ROCK, target: "moon" });
    expect(moon.blast).toEqual([]);
    expect(moon.breakupAltitudeM).toBeNull();
    expect(moon.caveats.join(" ")).toMatch(/no blast wave/i);
  });

  it("says a gas giant has no surface to crater", () => {
    const jupiter = impactConsequences({ ...ROCK, target: "jupiter" });
    expect(jupiter.caveats.join(" ")).toMatch(/no surface/i);
  });
});

describe("the scaling relations", () => {
  it("moves the simple-to-complex transition with gravity", () => {
    expect(simpleToComplexDiameter(9.80665)).toBeCloseTo(3200, 0);
    // The Moon's transition is near 18 km, which is why its craters terrace so much sooner.
    expect(simpleToComplexDiameter(1.62) / 1000).toBeGreaterThan(15);
    expect(simpleToComplexDiameter(1.62) / 1000).toBeLessThan(22);
  });

  it("widens a simple crater by a quarter and a complex one by more", () => {
    expect(finalCraterDiameter(1000, 9.80665)).toBeCloseTo(1250, 0);
    // Past the transition the collapse is far more dramatic than a quarter.
    expect(finalCraterDiameter(50_000, 9.80665) / 50_000).toBeGreaterThan(1.5);
  });

  it("puts Chicxulub's seismic magnitude near the top of the scale", () => {
    // 1e8 Mt in joules.
    expect(seismicMagnitude(1e8 * 4.184e15)).toBeGreaterThan(9.5);
    expect(seismicMagnitude(1e8 * 4.184e15)).toBeLessThan(11.5);
  });

  /**
   * A bigger body pancakes further and so bursts lower, or not at all.
   *
   * This first asserted that a weaker body bursts higher, which is wrong and was worth
   * finding out. A weak body does break up higher, but it then spreads enormously and falls a
   * long way before depositing its energy; a strong one breaks up low and barely spreads, so
   * it bursts close to where it started. The two effects pull in opposite directions and the
   * strong body can easily end up bursting higher. Only the dependence on size is monotonic,
   * which is why that is what is asserted.
   */
  it("bursts a larger body lower, because it spreads further before it stops", () => {
    const at = (diameter: number) =>
      airburstAltitude(50_000, 8_000, diameter, 2200, 20_000, 1e6, 45);
    expect(at(10)).toBeGreaterThan(at(30));
    expect(at(30)).toBeGreaterThan(at(100));
  });

  /** Energy is always deposited below where the body starts coming apart. */
  it("never bursts above the altitude where breakup begins", () => {
    for (const diameter of [5, 20, 50, 200]) {
      const breakup = 50_000;
      expect(airburstAltitude(breakup, 8_000, diameter, 2200, 20_000, 1e6, 45))
        .toBeLessThan(breakup);
    }
  });

  it("scales the transient crater with the cube root of the density ratio", () => {
    const light = transientCraterDiameter(100, 1000, 2750, 15_000, 9.80665, 45);
    const heavy = transientCraterDiameter(100, 8000, 2750, 15_000, 9.80665, 45);
    expect(heavy / light).toBeCloseTo(8 ** (1 / 3), 3);
  });
});
