import { describe, expect, it } from "vitest";
import {
  assessHabitability,
  atmosphereMassFor,
  buoyantLift,
  columnDensityGPerCm2,
  jeansParameter,
  solarConstantAt,
  spinChangeEnergy,
  surfaceGravity,
  formatQuantity,
  retentionVerdict,
  HABITABLE_ZONE_AU,
  MOLAR_MASS_G_PER_MOL,
  EARTH_AIR_MOLAR_MASS,
  GRAVITATIONAL_CONSTANT,
} from "./habitability";
import { solarDayDays } from "./time-sense";
import { AU_IN_METRES } from "./units";
import { BODY_IDS, contractFor } from "./bodies/registry";
import { ENVIRONMENT } from "./data/habitability-environment";

/**
 * The habitability panel's arithmetic, against values published independently of it.
 *
 * The temperatures are the point. Equilibrium temperature is the one number in this module
 * that every planetary science textbook also prints, so it is the only place the whole chain
 * of luminosity, distance, Bond albedo and the Stefan-Boltzmann constant can be checked end to
 * end against something that was not derived here. If those five bodies agree, the energy
 * balance is right, and every forcing, mirror area and cooling time downstream of it inherits
 * that.
 */
describe("energy balance", () => {
  it("reproduces the solar constant at one au", () => {
    expect(solarConstantAt(AU_IN_METRES)).toBeCloseTo(1361, 0);
  });

  /**
   * Published equilibrium temperatures, NASA planetary fact sheets.
   *
   * The giants are deliberately absent. Their published figures fold in internal heat, which
   * this function does not model: Jupiter radiates 1.67 times what it absorbs, so the fact
   * sheet's 110 K is not comparable with the 102 K that sunlight alone gives. Including them
   * here would mean either a wrong expectation or a tolerance loose enough to hide a real
   * error in the terrestrial planets. The assessment reports that gap as a caveat instead.
   */
  it.each([
    ["mercury", 440],
    ["venus", 227],
    ["embary", 254],
    ["mars", 210],
    ["titan", 82],
  ] as const)("puts %s within 3 K of its published equilibrium temperature", (id, published) => {
    const { equilibriumTemperatureK } = assessHabitability(id).state;
    expect(Math.abs(equilibriumTemperatureK - published)).toBeLessThan(3);
  });

  it("gives Earth 33 K of greenhouse warming", () => {
    const { greenhouseRiseK } = assessHabitability("embary").state;
    expect(greenhouseRiseK).toBeGreaterThan(32);
    expect(greenhouseRiseK).toBeLessThan(35);
  });

  /**
   * Venus's own paradox, as a test.
   *
   * It absorbs LESS sunlight than Earth, because it reflects 77 per cent of a flux that is
   * only 1.9 times Earth's. Every popular account that explains Venus by its distance from
   * the Sun fails this comparison, and so would this module if it used the geometric albedo
   * the body contracts carry instead of the Bond albedo.
   */
  it("has Venus absorbing less sunlight than Earth despite being closer", () => {
    const venus = assessHabitability("venus").state;
    const earth = assessHabitability("embary").state;
    const absorbed = (s: typeof venus) => s.solarConstantWPerM2 * (1 - s.bondAlbedo);
    expect(absorbed(venus)).toBeLessThan(absorbed(earth));
    expect(venus.greenhouseRiseK).toBeGreaterThan(500);
  });
});

describe("gravity and escape", () => {
  it("gives Earth one g, not the Earth-Moon barycentre's", () => {
    // 9.919 if the contract's system GM leaks through, which reads as 1.012 g.
    expect(assessHabitability("embary").state.surfaceGravityMS2).toBeCloseTo(9.80, 1);
    expect(assessHabitability("embary").state.gravityRelativeToEarth).toBeCloseTo(1.0, 2);
  });

  it.each([
    ["embary", 11_186],
    ["mars", 5027],
    ["moon", 2380],
    ["jupiter", 59_500],
  ] as const)("reproduces %s's published escape velocity", (id, published) => {
    const v = assessHabitability(id).state.escapeVelocityMS;
    expect(Math.abs(v - published) / published).toBeLessThan(0.01);
  });

  /**
   * The Jeans parameter against the pattern it is supposed to explain.
   *
   * Earth keeps nitrogen and loses hydrogen. If the function reproduces that split with the
   * same constants and no special-casing, it is measuring what it claims to.
   */
  it("explains why Earth has nitrogen and no hydrogen envelope", () => {
    const gm = 3.986_004_418e14;
    const r = 6.378e6 + 5e5;
    const T = 1000;
    const n2 = jeansParameter(gm, r, T, MOLAR_MASS_G_PER_MOL.N2);
    const h2 = jeansParameter(gm, r, T, MOLAR_MASS_G_PER_MOL.H2);
    expect(retentionVerdict(n2)).toBe("retained");
    expect(retentionVerdict(h2)).not.toBe("retained");
    expect(n2 / h2).toBeCloseTo(MOLAR_MASS_G_PER_MOL.N2 / MOLAR_MASS_G_PER_MOL.H2, 5);
  });
});

describe("atmospheres", () => {
  /**
   * Earth's atmospheric mass, and the 2.3 per cent that explains itself.
   *
   * Fed the standard sea-level pressure this gives 5.27e18 kg against a published 5.148e18,
   * and the gap is not an error in the hydrostatic relation. It is that 101,325 Pa is the
   * pressure at sea level, while a quarter of Earth's surface stands above sea level and
   * carries a shorter column. The area-weighted mean surface pressure is about 985 hPa, and
   * with that the same function lands inside half a per cent.
   *
   * Both are asserted rather than the tolerance being widened to swallow the difference,
   * because the discrepancy is the interesting part: it is exactly the correction that does
   * not arise on Mars or Venus, where the panel's figures are quoted at a datum radius with
   * no oceans to define a sea level against.
   */
  it("reproduces Earth's atmospheric mass, and shows why sea-level pressure overstates it", () => {
    const published = 5.148e18;

    const atSeaLevel = atmosphereMassFor(101_325, 6.371e6, 9.80665);
    expect(atSeaLevel / published - 1).toBeGreaterThan(0.02);
    expect(atSeaLevel / published - 1).toBeLessThan(0.03);

    const atMeanSurfacePressure = atmosphereMassFor(98_500, 6.371e6, 9.80665);
    expect(Math.abs(atMeanSurfacePressure - published) / published).toBeLessThan(0.005);
  });

  it("reproduces Earth's 1033 g/cm2 of shielding", () => {
    expect(columnDensityGPerCm2(101_325, 9.80665)).toBeCloseTo(1033, 0);
  });

  it("reproduces Venus's 92 bar atmosphere mass", () => {
    const venus = contractFor("venus");
    const g = surfaceGravity(venus.gm, venus.equatorialRadiusM);
    const mass = atmosphereMassFor(venus.atmosphere!.surfacePressurePa!, venus.equatorialRadiusM, g);
    // Published 4.8e20 kg.
    expect(Math.abs(mass - 4.8e20) / 4.8e20).toBeLessThan(0.02);
  });

  /**
   * Breathable air is a lifting gas on Venus, and is not on Jupiter.
   *
   * The sign of this number is the entire difference between the two aerostat cases, so it is
   * worth a test rather than a comment: 29 g/mol floats in 44 and sinks in 2.3.
   */
  it("floats breathing air on Venus and sinks it on Jupiter", () => {
    const venus = buoyantLift(101_325, 348, MOLAR_MASS_G_PER_MOL.CO2, EARTH_AIR_MOLAR_MASS);
    expect(venus.liftFraction).toBeCloseTo(0.342, 3);
    expect(venus.liftKgPerM3).toBeGreaterThan(0.4);

    const jupiter = buoyantLift(101_325, 165, 2.3, EARTH_AIR_MOLAR_MASS);
    expect(jupiter.liftKgPerM3).toBeLessThan(0);
  });
});

describe("rotation", () => {
  it("gives Venus a 117 day solar day from a 243 day retrograde spin", () => {
    expect(Math.abs(solarDayDays(-243.018, 224.701))).toBeCloseTo(116.75, 1);
  });

  it("gives Mars a solar day just over 24 hours", () => {
    expect(solarDayDays(1.02595676, 686.98)).toBeCloseTo(1.0275, 3);
  });

  /**
   * Earth's own rotational energy, as the yardstick every spin-up figure is quoted against.
   *
   * 2.1e29 J is the published value. Deriving it here from the same function that prices
   * spinning Venus up means the comparison on the panel is between two numbers produced the
   * same way rather than between a computation and a remembered constant.
   */
  it("reproduces Earth's rotational energy", () => {
    const mass = 3.986_004_418e14 / GRAVITATIONAL_CONSTANT;
    const energy = spinChangeEnergy(mass, 6.371e6, 0.3307, 0.997_270, Infinity);
    expect(energy).toBeGreaterThan(2.0e29);
    expect(energy).toBeLessThan(2.3e29);
  });
});

describe("habitable zone", () => {
  /**
   * The result worth stating plainly: Mars is inside it.
   *
   * Mars is not too far from the Sun. Kopparapu's conservative outer edge is 1.676 au and
   * Mars orbits at 1.524. Whatever is wrong with Mars, distance is not it, and a panel that
   * implied otherwise would be teaching the wrong lesson with correct-looking numbers.
   */
  it("places Mars inside the conservative habitable zone and Venus outside it", () => {
    expect(assessHabitability("mars").state.insideHabitableZone).toBe(true);
    expect(assessHabitability("venus").state.insideHabitableZone).toBe(false);
    expect(assessHabitability("embary").state.insideHabitableZone).toBe(true);
    expect(HABITABLE_ZONE_AU.maximumGreenhouse).toBeGreaterThan(1.524);
    expect(HABITABLE_ZONE_AU.runawayGreenhouse).toBeGreaterThan(0.723);
  });
});

describe("the assessment as a whole", () => {
  it("produces a complete assessment for every body in the registry", () => {
    for (const id of BODY_IDS) {
      const a = assessHabitability(id);
      expect(a.ladder.length, `${id} has no ladder`).toBeGreaterThan(0);
      expect(a.headline.length, `${id} has no headline`).toBeGreaterThan(20);
      for (const step of a.ladder) {
        expect(step.mechanism.length, `${id} step ${step.order} has no mechanism`).toBeGreaterThan(100);
        expect(step.source.length, `${id} step ${step.order} is unsourced`).toBeGreaterThan(5);
        for (const q of step.quantities) {
          expect(Number.isNaN(q.value), `${id}: ${q.label} is NaN`).toBe(false);
        }
      }
      for (const barrier of a.barriers) {
        for (const q of barrier.quantities) {
          expect(Number.isNaN(q.value), `${id}: ${q.label} is NaN`).toBe(false);
        }
      }
    }
  });

  /**
   * A body with no measured environment must say so.
   *
   * Half the registry has no published Bond albedo and no radiation measurement. The failure
   * to guard against is not a missing panel but a confident one, where a substituted albedo
   * is printed in the same typeface as a measured one.
   */
  it("declares its substitutions for bodies with no measured environment", () => {
    for (const id of BODY_IDS) {
      if (id === "sun" || ENVIRONMENT[id]) continue;
      expect(assessHabitability(id).caveats.length, `${id} substitutes silently`).toBeGreaterThan(0);
    }
  });

  it("routes each body to the strategy its physics implies", () => {
    // The Sun ran through the generic path and reported itself as receiving Earth's sunlight,
    // because a star has no orbit for the distance lookup to find.
    expect(assessHabitability("sun").strategy).toBe("star");
    expect(assessHabitability("embary").strategy).toBe("home");
    expect(assessHabitability("mars").strategy).toBe("greenhouse-terraform");
    expect(assessHabitability("venus").strategy).toBe("shade-and-condense");
    expect(assessHabitability("jupiter").strategy).toBe("aerostat");
    expect(assessHabitability("moon").strategy).toBe("pressurised-habitat");
    expect(assessHabitability("titan").strategy).toBe("cryo-paraterraform");
    // Europa has an ocean under the ice, so down is the destination. Io has the same
    // radiation and no water at all, so it is not the same answer.
    expect(assessHabitability("europa").strategy).toBe("ice-shell-subsurface");
    expect(assessHabitability("io").strategy).toBe("pressurised-habitat");
  });

  it("formats quantities the same way on both sides of the crossover", () => {
    expect(formatQuantity({ label: "", value: 0.342, unit: "" })).toBe("0.342");
    // Three significant figures, not three decimals: this read "0.002" next to prose saying
    // "2.40e-3" on Earth's own radiation card.
    expect(formatQuantity({ label: "", value: 0.0024, unit: "Sv/yr" })).toBe("0.0024 Sv/yr");
    expect(formatQuantity({ label: "", value: 1033, unit: "g/cm2" })).toBe("1033 g/cm2");
    expect(formatQuantity({ label: "", value: 3.93e18, unit: "kg" })).toBe("3.93e18 kg");
    expect(formatQuantity({ label: "", value: Infinity, unit: "years" })).toBe("unbounded");
  });
});
