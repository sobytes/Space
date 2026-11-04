/**
 * What actually happens where it lands.
 *
 * The asteroid tool used to end at a number of megatons and a sentence comparing it to
 * Tunguska, which is a fact about the kinetic energy and tells you almost nothing about the
 * event. Energy is not the interesting quantity: a given energy produces wildly different
 * outcomes depending on gravity, on whether there is an atmosphere to stop the body first,
 * and on the angle it arrives at. The same rock is a crater on the Moon and an airburst on
 * Earth.
 *
 * The model is Collins, Melosh & Marcus 2005, "Earth Impact Effects Program", Meteoritics &
 * Planetary Science 40, 817, which is the standard reference and is itself built on
 * Holsapple's pi-group crater scaling and Glasstone & Dolan's blast relations. It is
 * implemented here for any body rather than only for Earth, because the simulation has
 * thirty-two of them and a model that only works on one would be the wrong shape.
 *
 * Every relation below is an empirical fit over a finite range. They are quoted with that
 * range, and `impactConsequences` says where it has been extrapolated rather than silently
 * returning a number.
 */

import { contractFor } from "../bodies/registry";
import type { BodyId } from "../bodies/contract";
import { environmentFor } from "../habitability";

/** Joules in a tonne of TNT, the definition rather than a measurement. */
export const JOULES_PER_TONNE_TNT = 4.184e9;

export interface ImpactSetup {
  readonly target: BodyId;
  /** Impactor diameter, metres. */
  readonly diameterM: number;
  readonly densityKgM3: number;
  /** Speed at the top of the atmosphere, or at the surface for an airless body, m/s. */
  readonly speedMS: number;
  /** Angle from the horizontal, degrees. 45 is the most probable value for a random impact. */
  readonly angleDeg: number;
}

/**
 * Transient crater diameter, metres: the bowl excavated before the walls collapse.
 *
 * Pi-group scaling in the form Collins et al. give as their equation 21, for a competent
 * rock target. The exponents are not round numbers because they are fitted to explosion and
 * laboratory impact experiments across many orders of magnitude.
 *
 * Gravity enters as g^-0.22, which is why the same impactor digs a crater half again as wide
 * on the Moon as on Earth: there is less weight resisting the excavation.
 */
export function transientCraterDiameter(
  impactorDiameterM: number,
  impactorDensity: number,
  targetDensity: number,
  speedMS: number,
  gravityMS2: number,
  angleDeg: number,
): number {
  const angle = Math.max(2, Math.min(90, angleDeg)) * (Math.PI / 180);
  return (
    1.161
    * (impactorDensity / targetDensity) ** (1 / 3)
    * impactorDiameterM ** 0.78
    * speedMS ** 0.44
    * gravityMS2 ** -0.22
    * Math.sin(angle) ** (1 / 3)
  );
}

/**
 * The diameter above which craters collapse into terraced, central-peak structures.
 *
 * 3.2 km on Earth, and it scales inversely with gravity, which is why the Moon's transition
 * sits near 18 km. Collins et al. equation 27.
 */
export function simpleToComplexDiameter(gravityMS2: number): number {
  const EARTH_TRANSITION_M = 3200;
  const EARTH_GRAVITY = 9.80665;
  return (EARTH_TRANSITION_M * EARTH_GRAVITY) / gravityMS2;
}

/** Final rim-to-rim crater diameter, metres. Collins et al. equations 22 and 28. */
export function finalCraterDiameter(transientM: number, gravityMS2: number): number {
  const transition = simpleToComplexDiameter(gravityMS2);
  // A simple bowl widens by about a quarter as its walls slump in.
  const simple = 1.25 * transientM;
  if (simple < transition) return simple;
  return 1.17 * (transientM ** 1.13 / transition ** 0.13);
}

/**
 * Richter magnitude of the seismic shaking, from the impact energy.
 *
 * Collins et al. equation 32, assuming the usual seismic efficiency of 1e-4: that is, a ten
 * thousandth of the kinetic energy ends up as seismic waves. Only meaningful on a body with
 * a solid crust to carry them.
 */
export function seismicMagnitude(energyJoules: number): number {
  return 0.67 * Math.log10(energyJoules) - 5.87;
}

/**
 * Radius of the fireball, metres.
 *
 * Collins et al. equation 33, fitted to nuclear test data and scaled by the cube root of
 * yield. Inside this radius the question is not what burns but what vaporises.
 */
export function fireballRadius(energyJoules: number): number {
  return 0.002 * energyJoules ** (1 / 3);
}

/**
 * Distance at which the air blast falls to a given overpressure, metres.
 *
 * Inverted from the scaled-distance relation Collins et al. take from Glasstone & Dolan's
 * nuclear weapons effects data, which is where almost all empirical blast data comes from.
 * Needs an atmosphere: there is no blast wave in a vacuum, only ejecta.
 *
 * The thresholds worth knowing, in pascals:
 *   4,000   glass shatters
 *   20,000  wood-framed buildings collapse
 *   40,000  multi-storey steel-framed buildings collapse
 *   70,000  near-total destruction
 */
export function overpressureRadius(energyJoules: number, overpressurePa: number): number {
  const yieldKt = energyJoules / (JOULES_PER_TONNE_TNT * 1e3);
  if (yieldKt <= 0 || overpressurePa <= 0) return 0;
  /**
   * Solved numerically, because the relation runs the other way.
   *
   * Collins et al. give overpressure as a function of distance, not distance as a function of
   * overpressure, and the two terms in it cannot be inverted in closed form. Overpressure
   * falls monotonically with distance, which makes a bisection both exact and short.
   */
  const atDistance = (r: number) => {
    const rScaled = r / yieldKt ** (1 / 3);
    return 3.14e11 / rScaled ** 3 + 1.8e7 / rScaled;
  };
  let low = 1;
  let high = 1e9;
  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2;
    if (atDistance(mid) > overpressurePa) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/**
 * Does the atmosphere stop it before it reaches the ground?
 *
 * A body breaks up when the dynamic pressure on its front face exceeds its own strength, and
 * from then on it spreads and decelerates rapidly. The altitude of that first breakup is
 * where rho(z) v^2 equals the strength, with rho falling exponentially through the scale
 * height. Collins et al. section 3; the strength values are theirs, and they span four orders
 * of magnitude between a loose cometary aggregate and solid iron.
 *
 * Returns null where there is no atmosphere, which is most of the solar system.
 */
export function breakupAltitude(
  surfacePressurePa: number,
  scaleHeightM: number,
  temperatureK: number,
  speedMS: number,
  strengthPa: number,
  meanMolarMassKgPerMol: number,
): number | null {
  if (surfacePressurePa <= 0) return null;
  const R = 8.314_462_618;
  const surfaceDensity = (surfacePressurePa * meanMolarMassKgPerMol) / (R * temperatureK);
  // rho(z) v^2 = Y  =>  z = H ln(rho_0 v^2 / Y)
  const ratio = (surfaceDensity * speedMS * speedMS) / strengthPa;
  if (ratio <= 1) return null;
  return scaleHeightM * Math.log(ratio);
}

/**
 * Altitude at which a fragmenting body deposits its energy, metres. Negative means it reaches
 * the ground.
 *
 * Collins et al. equations 17 to 19. After breakup the fragments spread under the bow shock
 * over a dispersion length l, and the cloud is taken to burst once it has widened by the
 * pancake factor, about seven. The logarithm is where the exponential atmosphere enters: a
 * body that starts spreading high has a long way to fall through thin air, which is why small
 * objects burst high and large ones do not burst at all.
 *
 *   l   = L sin(theta) sqrt(rho_i / (C_D rho(z*)))
 *   z_b = z* - 2 H ln[ 1 + (l / 2H) sqrt(f_p^2 - 1) ]
 */
export function airburstAltitude(
  breakupAltitudeM: number,
  scaleHeightM: number,
  impactorDiameterM: number,
  impactorDensity: number,
  speedMS: number,
  strengthPa: number,
  angleDeg: number,
): number {
  const DRAG_COEFFICIENT = 2;
  const PANCAKE_FACTOR = 7;
  const angle = Math.max(2, Math.min(90, angleDeg)) * (Math.PI / 180);
  // Air density where breakup starts follows from the breakup condition itself: the dynamic
  // pressure there equals the strength, so rho = Y / v^2. No need to re-evaluate the profile.
  const densityAtBreakup = strengthPa / (speedMS * speedMS);
  const dispersion =
    impactorDiameterM
    * Math.sin(angle)
    * Math.sqrt(impactorDensity / (DRAG_COEFFICIENT * densityAtBreakup));
  return (
    breakupAltitudeM
    - 2 * scaleHeightM
      * Math.log(
        1 + (dispersion / (2 * scaleHeightM)) * Math.sqrt(PANCAKE_FACTOR ** 2 - 1),
      )
  );
}

/** Yield strength, Pa, by impactor type. Collins et al. table 1. */
export const IMPACTOR_STRENGTH_PA = {
  comet: 1e5,
  porousRock: 1e6,
  denseRock: 1e7,
  iron: 4.4e8,
} as const;

export type ImpactorKind = keyof typeof IMPACTOR_STRENGTH_PA;

/** Picks the strength from the density the user chose, so there is one input not two. */
export function impactorKindFor(densityKgM3: number): ImpactorKind {
  if (densityKgM3 < 1500) return "comet";
  if (densityKgM3 < 2500) return "porousRock";
  if (densityKgM3 < 5000) return "denseRock";
  return "iron";
}

export interface ImpactConsequences {
  readonly massKg: number;
  readonly energyJoules: number;
  readonly energyMegatonsTnt: number;
  /** True where the atmosphere breaks it up before it reaches the ground. */
  readonly airburst: boolean;
  /** Where fragmentation begins, metres. Null with no atmosphere. */
  readonly breakupAltitudeM: number | null;
  /** Where the energy is actually deposited, metres. Null unless it bursts in the air. */
  readonly burstAltitudeM: number | null;
  readonly craterDiameterM: number | null;
  readonly craterDepthM: number | null;
  readonly fireballRadiusM: number;
  readonly seismicMagnitude: number | null;
  /** Radii at which the air blast falls to each threshold. Empty with no atmosphere. */
  readonly blast: readonly { readonly effect: string; readonly overpressurePa: number; readonly radiusM: number }[];
  readonly comparison: string;
  /** Where the model has been pushed outside the range it was fitted over. */
  readonly caveats: readonly string[];
}

/** Craters and events to measure an outcome against, with their sources. */
const LANDMARKS: readonly { readonly megatons: number; readonly text: string }[] = [
  { megatons: 0.0005, text: "about the energy of the 2013 Chelyabinsk airburst's smaller fragments" },
  { megatons: 0.5, text: "the 2013 Chelyabinsk airburst, which broke windows across a city and injured 1,500 people" },
  { megatons: 10, text: "the 1908 Tunguska airburst, which flattened 2,000 square kilometres of forest" },
  { megatons: 50, text: "the Tsar Bomba, the largest weapon ever detonated" },
  { megatons: 1e4, text: "the Barringer Crater impact in Arizona, 50,000 years ago" },
  { megatons: 1e8, text: "the Chicxulub impact, which ended the Cretaceous" },
];

function comparisonFor(megatons: number): string {
  let best = LANDMARKS[0];
  for (const landmark of LANDMARKS) {
    if (megatons >= landmark.megatons) best = landmark;
  }
  const ratio = megatons / best.megatons;
  if (ratio > 3) return `${ratio.toFixed(0)} times ${best.text}`;
  if (ratio < 0.4) return `a fraction of ${best.text}`;
  return `comparable to ${best.text}`;
}

/**
 * The whole picture for one impact on one body.
 *
 * Deliberately returns nulls rather than zeros where a quantity does not apply. There is no
 * crater after an airburst and no seismic magnitude on a body with no crust, and a zero in
 * those fields would read as a measurement.
 */
export function impactConsequences(setup: ImpactSetup): ImpactConsequences {
  const contract = contractFor(setup.target);
  const { environment } = environmentFor(setup.target);
  const gravity = (environment.gmBodyOnly ?? contract.gm) / contract.equatorialRadiusM ** 2;

  const radius = setup.diameterM / 2;
  const massKg = (4 / 3) * Math.PI * radius ** 3 * setup.densityKgM3;
  const energyJoules = 0.5 * massKg * setup.speedMS ** 2;
  const megatons = energyJoules / (JOULES_PER_TONNE_TNT * 1e6);

  const caveats: string[] = [];
  const atmosphere = contract.atmosphere;
  const strength = IMPACTOR_STRENGTH_PA[impactorKindFor(setup.densityKgM3)];

  const breakup =
    atmosphere?.surfacePressurePa
      ? breakupAltitude(
          atmosphere.surfacePressurePa,
          atmosphere.scaleHeightM,
          contract.meanTemperatureK,
          setup.speedMS,
          strength,
          // Mean molar mass from the declared composition, kg/mol.
          Object.entries(atmosphere.composition).reduce(
            (sum, [gas, fraction]) => sum + fraction * (MOLAR_MASS_G_PER_MOL[gas] ?? 28) * 1e-3,
            0,
          ),
        )
      : null;

  /**
   * Breaking up is not the same as being stopped, and the difference is the pancake.
   *
   * A first attempt here compared the impactor's mass per unit area against the atmosphere's
   * and called it stopped when the air won. That gets Tunguska exactly wrong: 55 metres of
   * rock is 121,000 kg per square metre against Earth's 10,300, so by that test it reaches
   * the ground, and in 1908 it did not. It burst eight kilometres up and flattened two
   * thousand square kilometres of forest without leaving a crater.
   *
   * What the simple comparison misses is that once a body fragments it spreads sideways under
   * its own bow shock, and the area sweeping up air grows as the square of that spreading.
   * Collins et al. model it as a pancake that widens until it has grown by a factor of about
   * seven, at which point it deposits its energy. Their equations 17 to 19, implemented in
   * `airburstAltitude` below, put Tunguska at 9.6 km and Chelyabinsk at 22.7 km against
   * measured values near 8 and 23.
   */
  const burst =
    breakup === null
      ? null
      : airburstAltitude(breakup, atmosphere!.scaleHeightM, setup.diameterM,
                         setup.densityKgM3, setup.speedMS, strength, setup.angleDeg);
  const stoppedByAir = burst !== null && burst > 0;

  const craterTransient = stoppedByAir
    ? null
    : transientCraterDiameter(
        setup.diameterM,
        setup.densityKgM3,
        2750, // competent rock, Collins et al.'s default target density
        setup.speedMS,
        gravity,
        setup.angleDeg,
      );
  const craterFinal = craterTransient === null ? null : finalCraterDiameter(craterTransient, gravity);

  const blast = atmosphere?.surfacePressurePa
    ? [
        { effect: "Glass shatters", overpressurePa: 4_000 },
        { effect: "Houses collapse", overpressurePa: 20_000 },
        { effect: "Steel-framed buildings collapse", overpressurePa: 40_000 },
        { effect: "Near-total destruction", overpressurePa: 70_000 },
      ].map((band) => ({ ...band, radiusM: overpressureRadius(energyJoules, band.overpressurePa) }))
    : [];

  if (!environment.hasSolidSurface) {
    caveats.push(
      `${contract.displayName} has no surface. The impactor is swallowed and the crater `
      + "figures do not apply.",
    );
  }
  if (setup.speedMS < 1_000) {
    caveats.push(
      "Below about 1 km/s the crater scaling is outside the range it was fitted over; this is "
      + "a collision rather than a hypervelocity impact.",
    );
  }
  if (megatons > 1e8) {
    caveats.push(
      "Larger than Chicxulub. At this scale the target's curvature matters and a flat-ground "
      + "scaling law is being asked for more than it can give.",
    );
  }
  if (blast.length === 0 && atmosphere === null) {
    caveats.push(
      "No atmosphere, so there is no blast wave. The damage beyond the crater is ejecta on "
      + "ballistic trajectories, which this does not model.",
    );
  }

  return {
    massKg,
    energyJoules,
    energyMegatonsTnt: megatons,
    airburst: stoppedByAir,
    breakupAltitudeM: breakup,
    burstAltitudeM: stoppedByAir ? burst : null,
    craterDiameterM: craterFinal,
    // Simple craters are about a fifth as deep as they are wide, rim to floor.
    craterDepthM: craterFinal === null ? null : craterFinal / 5,
    fireballRadiusM: fireballRadius(energyJoules),
    seismicMagnitude: environment.hasSolidSurface ? seismicMagnitude(energyJoules) : null,
    blast,
    comparison: comparisonFor(megatons),
    caveats,
  };
}

/** Molar masses of the gases the body contracts actually name, g/mol. */
const MOLAR_MASS_G_PER_MOL: Record<string, number> = {
  H2: 2.016, He: 4.003, CH4: 16.043, H2O: 18.015, N2: 28.014,
  O2: 31.998, Ar: 39.948, CO2: 44.010, SO2: 64.066, Na: 22.99, K: 39.098,
};
