/**
 * What would it actually take to make this body habitable?
 *
 * Not a verdict and not a mood. Every claim on the panel is a number with a derivation, and
 * the derivations are the ordinary physics of planetary atmospheres: an energy balance for
 * how cold it is, a hydrostatic column for how much gas it would take to pressurise, a Jeans
 * parameter for whether it could hold that gas, an occultation area for how much sunlight
 * could be added or removed, and a moment of inertia for what it would cost to change the
 * length of the day.
 *
 * The honest results are the interesting ones, and several of them contradict the folklore:
 *
 *  - Mars sits inside the conservative habitable zone. It is not too far from the Sun. It is
 *    too thin, and that is a different and much more tractable problem.
 *  - "Mars has no magnetic field, so an atmosphere would just blow away" is true and
 *    irrelevant. At MAVEN's measured 2.5 kg/s a full bar takes tens of billions of years,
 *    which is longer than the Sun has left on the main sequence.
 *  - Mars cannot be terraformed with the volatiles it has. Jakosky and Edwards inventoried
 *    every accessible reservoir and reached about 20 mbar against the roughly 1000 needed.
 *    The gas has to be imported, and that is the actual blocker.
 *  - Venus is not hot because it is close to the Sun. It absorbs less sunlight than Earth
 *    does, because it reflects 77 per cent of it. It is hot entirely because of 92 bar of CO2.
 *  - The most comfortable place off Earth is 50 km above the surface of Venus, where it is
 *    one bar, 75 degrees Celsius, 0.9 g, and breathable air is a lifting gas.
 *
 * None of those are assertions here. They each fall out of a function below, and
 * `habitability.test.ts` checks them against the published values.
 *
 * Principal sources are cited per step. The survey backbone is Fogg, "Terraforming:
 * Engineering Planetary Environments" (SAE 1995) and Pierrehumbert, "Principles of Planetary
 * Climate" (CUP 2010) for the radiative physics.
 */

import { AU_IN_METRES, SECONDS_PER_JULIAN_YEAR, SECONDS_PER_DAY } from "./units";
import { heliocentricPeriodDays, solarDayDays } from "./time-sense";
import { BODY_CONTRACTS, contractFor } from "./bodies/registry";
import type { BodyContract, BodyId } from "./bodies/contract";
import { PLANET_IDS, SHORT_SPAN, type PlanetId } from "./data/planets";
import { ENVIRONMENT, type EnvironmentMeasurements } from "./data/habitability-environment";

// MARK: constants

/** Stefan-Boltzmann, W m^-2 K^-4. CODATA 2018, exact by the SI redefinition. */
export const STEFAN_BOLTZMANN = 5.670_374_419e-8;
/** Solar luminosity, W. IAU 2015 Resolution B3 nominal value. */
export const SOLAR_LUMINOSITY_W = 3.828e26;
/** Boltzmann, J/K. Exact by the 2019 SI redefinition. */
export const BOLTZMANN = 1.380_649e-23;
/** Unified atomic mass unit, kg. CODATA 2018. */
export const ATOMIC_MASS_UNIT = 1.660_539_066_60e-27;
/** Molar gas constant, J mol^-1 K^-1. Exact. */
export const MOLAR_GAS_CONSTANT = 8.314_462_618;
/** Newtonian constant, m^3 kg^-1 s^-2. CODATA 2018; the least precise constant here. */
export const GRAVITATIONAL_CONSTANT = 6.674_30e-11;

/**
 * What a person needs, and where each number comes from.
 *
 * Partial pressure, not percentage. The distinction is the whole of high-altitude physiology:
 * air is 21 per cent oxygen on the summit of Everest too, and it is 21 per cent oxygen in a
 * vacuum chamber at 10 kPa, where it kills you in a minute. What a lung responds to is the
 * partial pressure, so that is what the target is expressed in.
 */
export const HUMAN_REQUIREMENTS = {
  /** Earth's global mean surface temperature. */
  targetSurfaceTemperatureK: 288,
  targetSurfacePressurePa: 101_325,
  /** Sea-level oxygen partial pressure. */
  targetOxygenPartialPressurePa: 21_200,
  /** Below this, unacclimatised people lose consciousness. Roughly 3,000 m of altitude. */
  minimumOxygenPartialPressurePa: 14_000,
  /** Above this, CO2 impairs judgement regardless of how much oxygen is present. */
  maximumCo2PartialPressurePa: 1_000,
  /** Global mean natural background, UNSCEAR 2008. */
  earthBackgroundDoseSvPerYear: 0.0024,
  /** ICRP 103 occupational limit, averaged. NASA's career limits are of the same order. */
  occupationalDoseLimitSvPerYear: 0.02,
  earthSurfaceGravityMS2: 9.806_65,
} as const;

/** Molar masses, g/mol, for the gases that decide whether an atmosphere stays put. */
export const MOLAR_MASS_G_PER_MOL = {
  H2: 2.016,
  He: 4.003,
  CH4: 16.043,
  H2O: 18.015,
  N2: 28.014,
  O2: 31.998,
  Ar: 39.948,
  CO2: 44.010,
} as const;

export type SpeciesName = keyof typeof MOLAR_MASS_G_PER_MOL;

/** Mean molar mass of dry Earth air, g/mol. The reference for every buoyancy figure. */
export const EARTH_AIR_MOLAR_MASS = 28.9647;

// MARK: primitive physics

/** Total solar irradiance at a distance, W/m^2. Inverse square from the IAU luminosity. */
export function solarConstantAt(distanceM: number): number {
  return SOLAR_LUMINOSITY_W / (4 * Math.PI * distanceM * distanceM);
}

/**
 * Equilibrium temperature: what the body would sit at with no atmosphere, K.
 *
 * Absorbed power over the cross-section pi R^2 balanced against emission from the whole
 * sphere 4 pi R^2, so the factor of four appears and the radius cancels. The gap between this
 * and the measured surface temperature IS the greenhouse effect, which is why the function
 * is worth having separately rather than folded into a lookup: Earth's gap is 33 K, Venus's
 * is 510 K, and nothing else explains Venus.
 */
export function equilibriumTemperature(solarConstantWPerM2: number, bondAlbedo: number): number {
  return ((solarConstantWPerM2 * (1 - bondAlbedo)) / (4 * STEFAN_BOLTZMANN)) ** 0.25;
}

export function surfaceGravity(gm: number, radiusM: number): number {
  return gm / (radiusM * radiusM);
}

export function escapeVelocity(gm: number, radiusM: number): number {
  return Math.sqrt((2 * gm) / radiusM);
}

/**
 * Jeans escape parameter: gravitational binding energy over thermal energy at the exobase.
 *
 * lambda = GMm / (k T r). It is the ratio that decides whether a planet keeps a gas, and the
 * thresholds are sharp because the escape flux carries exp(-lambda). Catling and Zahnle's
 * working numbers: above about 30 a gas is held for the age of the solar system, below about
 * 6 the atmosphere is in hydrodynamic blowoff and leaves bodily rather than molecule by
 * molecule.
 *
 * It explains the pattern of the solar system in one line. Earth at lambda 14 for hydrogen
 * loses hydrogen and at 195 for nitrogen keeps nitrogen, which is why Earth has an ocean and
 * no hydrogen envelope.
 */
export function jeansParameter(
  gm: number,
  exobaseRadiusM: number,
  exobaseTemperatureK: number,
  molarMassGPerMol: number,
): number {
  // Molar mass to the mass of one molecule. Avogadro is exact by the 2019 SI redefinition.
  const moleculeMassKg = (molarMassGPerMol * 1e-3) / 6.022_140_76e23;
  return (gm * moleculeMassKg) / (BOLTZMANN * exobaseTemperatureK * exobaseRadiusM);
}

export type RetentionVerdict = "retained" | "slowly-lost" | "blows-off";

export function retentionVerdict(lambda: number): RetentionVerdict {
  if (lambda >= 30) return "retained";
  if (lambda >= 6) return "slowly-lost";
  return "blows-off";
}

/**
 * Mass of gas needed to hold a given surface pressure, kg.
 *
 * Hydrostatic: the pressure at the bottom of a column is the weight of the column over its
 * area, so P = M g / (4 pi R^2). Independent of composition and of temperature, which is why
 * it is the one terraforming number that cannot be argued with.
 */
export function atmosphereMassFor(
  surfacePressurePa: number,
  radiusM: number,
  gravityMS2: number,
): number {
  return (4 * Math.PI * radiusM * radiusM * surfacePressurePa) / gravityMS2;
}

/**
 * Shielding provided by an atmosphere, g/cm^2 of column density.
 *
 * The unit is the one radiation physics uses, because what stops a cosmic ray is grams of
 * material in the way and not what the grams are made of. Earth's atmosphere is 1033 g/cm^2
 * and that, not the magnetic field, is what does most of the stopping at the surface.
 */
export function columnDensityGPerCm2(surfacePressurePa: number, gravityMS2: number): number {
  return (surfacePressurePa / gravityMS2) * 0.1;
}

/**
 * Area of orbiting reflector or shade needed to change a body's insolation, m^2.
 *
 * A body intercepts S pi R^2. A mirror of area A placed near it and aimed at it adds A S; a
 * shade of area A removes A S. So the area is pi R^2 times the fractional change wanted,
 * which makes a full doubling cost an area equal to the planet's own cross-section. Negative
 * means a shade. First order: it ignores the penumbra, which `fullUmbraRadius` covers.
 */
export function collectorAreaFor(
  radiusM: number,
  currentSolarConstant: number,
  targetSolarConstant: number,
): number {
  return (
    Math.PI * radiusM * radiusM * ((targetSolarConstant - currentSolarConstant) / currentSolarConstant)
  );
}

/**
 * Radius a shade at the L1 point must have to cast full shadow, m.
 *
 * The Sun is not a point, so a shade at distance L casts an umbra that shrinks by L times the
 * Sun's angular radius. The shade must be larger than the planet by exactly that much. For
 * Venus the L1 point is a million kilometres out and the Sun subtends 0.74 degrees there, so
 * the shade has to be roughly twice the radius of the planet it is shading.
 */
export function fullUmbraRadius(
  bodyRadiusM: number,
  l1DistanceM: number,
  heliocentricDistanceM: number,
): number {
  const SOLAR_RADIUS_M = 6.957e8;
  return bodyRadiusM + l1DistanceM * (SOLAR_RADIUS_M / heliocentricDistanceM);
}

/** Distance from a body to its sunward L1 point, m. The usual (mu/3)^(1/3) Hill expansion. */
export function l1Distance(gmBody: number, gmSun: number, heliocentricDistanceM: number): number {
  return heliocentricDistanceM * Math.cbrt(gmBody / (3 * gmSun));
}

/**
 * Energy to change a body's spin to a target day length, J.
 *
 * Half I delta-omega-squared with I = f M R^2, f the measured moment of inertia factor. The
 * sign of the current rate matters: Venus turns backwards, so reaching a 24-hour prograde day
 * means stopping it first and then spinning it the other way.
 */
export function spinChangeEnergy(
  massKg: number,
  radiusM: number,
  momentOfInertiaFactor: number,
  currentSiderealDays: number,
  targetSiderealDays: number,
): number {
  const inertia = momentOfInertiaFactor * massKg * radiusM * radiusM;
  const omegaNow = (2 * Math.PI) / (currentSiderealDays * SECONDS_PER_DAY);
  const omegaTarget = (2 * Math.PI) / (targetSiderealDays * SECONDS_PER_DAY);
  return 0.5 * inertia * Math.abs(omegaTarget * omegaTarget - omegaNow * omegaNow);
}

/**
 * Lift of one gas floating in another at the same pressure and temperature, kg/m^3.
 *
 * Archimedes with the ideal gas law: at matched P and T, density goes as molar mass, so the
 * lift per unit volume is rho_outside times (1 - M_inside / M_outside). The reason to have it
 * as a function is Venus. Ordinary breathing air inside an envelope, in a CO2 atmosphere,
 * lifts 34 per cent of its own displaced mass, so on Venus the habitat's atmosphere is its
 * own lifting gas and a leak makes it sink rather than explode.
 */
export function buoyantLift(
  ambientPressurePa: number,
  ambientTemperatureK: number,
  ambientMolarMassGPerMol: number,
  envelopeMolarMassGPerMol: number,
): { ambientDensityKgPerM3: number; liftFraction: number; liftKgPerM3: number } {
  const ambientDensityKgPerM3 =
    (ambientPressurePa * (ambientMolarMassGPerMol / 1000)) /
    (MOLAR_GAS_CONSTANT * ambientTemperatureK);
  const liftFraction = 1 - envelopeMolarMassGPerMol / ambientMolarMassGPerMol;
  return {
    ambientDensityKgPerM3,
    liftFraction,
    liftKgPerM3: ambientDensityKgPerM3 * liftFraction,
  };
}

/**
 * The conservative habitable zone for a Sun-like star, in au.
 *
 * Kopparapu et al. 2013 (ApJ 765, 131) with the 2014 erratum coefficients, evaluated for the
 * Sun. The inner edge is where a water world goes into runaway greenhouse and the outer is
 * where no amount of CO2 can keep it warm, because past that point CO2 starts condensing and
 * scattering more light than it traps.
 *
 * Worth stating plainly because of what it implies: Mars at 1.524 au is inside the outer
 * edge. Mars is not too cold for its distance. It is too thin for its distance.
 */
export const HABITABLE_ZONE_AU = {
  recentVenus: 1 / Math.sqrt(1.776),
  runawayGreenhouse: 1 / Math.sqrt(1.107),
  moistGreenhouse: 1 / Math.sqrt(1.038),
  maximumGreenhouse: 1 / Math.sqrt(0.356),
  earlyMars: 1 / Math.sqrt(0.32),
} as const;

// MARK: assembled assessment

export interface Quantity {
  readonly label: string;
  readonly value: number;
  readonly unit: string;
  /** What the number means, when the number alone would mislead. */
  readonly note?: string;
}

export type Severity = "none" | "manageable" | "severe" | "fatal";

export interface Barrier {
  readonly id: string;
  readonly title: string;
  readonly severity: Severity;
  /** What is physically wrong, in one sentence that a number could falsify. */
  readonly statement: string;
  readonly quantities: readonly Quantity[];
}

export type Maturity = "demonstrated" | "engineering-extrapolation" | "speculative";

export interface Step {
  readonly order: number;
  readonly title: string;
  /** The physics or chemistry of how, not a wish. */
  readonly mechanism: string;
  readonly quantities: readonly Quantity[];
  readonly timescale: string;
  readonly maturity: Maturity;
  readonly source: string;
}

export type Strategy =
  | "star"
  | "home"
  | "greenhouse-terraform"
  | "shade-and-condense"
  | "aerostat"
  | "pressurised-habitat"
  | "ice-shell-subsurface"
  | "cryo-paraterraform";

export interface CurrentState {
  readonly heliocentricDistanceAu: number;
  readonly solarConstantWPerM2: number;
  readonly solarConstantRelativeToEarth: number;
  readonly bondAlbedo: number;
  readonly equilibriumTemperatureK: number;
  readonly measuredSurfaceTemperatureK: number;
  readonly greenhouseRiseK: number;
  /**
   * The greenhouse comparison as a sentence, because the signed number alone misleads.
   *
   * Mars measures 208 K against an equilibrium of 210, so the rise is minus two, and a panel
   * that renders that literally says Mars is "colder by 2 K" than sunlight alone allows, which
   * sounds like a broken energy balance. It is not: Mars's greenhouse effect really is only a
   * few kelvin, and both figures carry more uncertainty than the gap between them. Saying so
   * once here is better than each client inventing its own wording for the same number.
   */
  readonly greenhouseSummary: string;
  readonly surfaceGravityMS2: number;
  readonly gravityRelativeToEarth: number;
  readonly escapeVelocityMS: number;
  readonly surfacePressurePa: number;
  readonly surfaceDoseSvPerYear: number | null;
  readonly doseRelativeToEarth: number | null;
  readonly solarDayDays: number;
  readonly hasIntrinsicMagneticField: boolean;
  readonly hasSolidSurface: boolean;
  readonly insideHabitableZone: boolean;
}

export interface Retention {
  readonly species: SpeciesName;
  readonly jeansParameter: number;
  readonly verdict: RetentionVerdict;
}

export interface Assessment {
  readonly body: BodyId;
  readonly displayName: string;
  readonly strategy: Strategy;
  readonly headline: string;
  readonly state: CurrentState;
  readonly retention: readonly Retention[];
  readonly barriers: readonly Barrier[];
  readonly ladder: readonly Step[];
  /** What is still a guess in this assessment, named rather than hidden. */
  readonly caveats: readonly string[];
}

// MARK: helpers

function planetAncestor(id: BodyId): PlanetId | null {
  let cursor: BodyId | null = id;
  while (cursor) {
    if ((PLANET_IDS as readonly string[]).includes(cursor)) return cursor as PlanetId;
    cursor = BODY_CONTRACTS[cursor].parent;
  }
  return null;
}

/** Heliocentric semi-major axis in metres. A moon uses its planet's. */
export function heliocentricDistanceM(id: BodyId): number {
  const planet = planetAncestor(id);
  if (!planet) return AU_IN_METRES;
  return SHORT_SPAN.elements[planet].atJ2000.semiMajorAxisAu * AU_IN_METRES;
}

/**
 * Delegated rather than duplicated.
 *
 * This module and `time-sense` both need "how long does this body take to go round the Sun",
 * and they had the same six lines twice until the duplicate `solarDayDays` collided on the
 * barrel export and made it obvious. One definition, in the module whose subject it is.
 */
function orbitalPeriodDays(id: BodyId): number {
  return heliocentricPeriodDays(id);
}

/**
 * Environment for a body, with every substitution declared.
 *
 * Half the registry has no published Bond albedo and no radiation measurement. Rather than
 * refuse to assess those bodies or quietly invent numbers for them, the gaps are filled from
 * documented fallbacks and the substitutions are returned alongside, so they can be printed
 * on the panel instead of being indistinguishable from measurements.
 */
export function environmentFor(id: BodyId): {
  environment: EnvironmentMeasurements;
  substitutions: readonly string[];
} {
  const measured = ENVIRONMENT[id];
  if (measured) return { environment: measured, substitutions: [] };

  const contract = contractFor(id);
  return {
    environment: {
      // Phase integral of 0.9, the usual value for a dark, rough, airless surface. It is a
      // substitution and is reported as one.
      bondAlbedo: Math.min(0.95, contract.geometricAlbedo * 0.9),
      bondAlbedoSource: "substituted: 0.9 x geometric albedo",
      exobaseTemperatureK: contract.meanTemperatureK,
      exobaseSource: "substituted: mean surface temperature, surface-bounded exosphere",
      surfaceDoseSvPerYear: null,
      doseSource: "no published measurement",
      momentOfInertiaFactor: 0.33,
      momentSource: "substituted: uniform-ish differentiated body",
      surfaceMagneticFieldT: 0,
      magneticSource: "substituted: no dipole detected or expected",
      hasSolidSurface: true,
      crust: contract.meanTemperatureK < 180 ? "ice" : "rock",
      atmosphericLossKgPerS: null,
      lossSource: null,
    },
    substitutions: [
      `No published Bond albedo for ${contract.displayName}; using 0.9 x the geometric albedo.`,
      "No surface radiation measurement exists for this body.",
      "Moment of inertia assumed, not determined by a spacecraft.",
    ],
  };
}

function greenhouseSummaryFor(
  equilibriumK: number,
  measuredK: number,
  isEarth = false,
): string {
  const rise = measuredK - equilibriumK;
  const preamble =
    `Sunlight alone would put the surface at ${equilibriumK.toFixed(0)} K, and it measures `
    + `${measuredK.toFixed(0)} K. `;
  if (Math.abs(rise) < 5) {
    return (
      preamble
      + "Those agree to within a few kelvin, so whatever atmosphere is here traps almost nothing. "
      + "Earth's greenhouse effect is 33 K."
    );
  }
  if (rise < 0) {
    return (
      preamble
      + `It is ${Math.abs(rise).toFixed(0)} K colder than the energy balance alone allows, which `
      + "means something is removing heat or reflecting more than the albedo used here implies."
    );
  }
  if (isEarth) {
    // Comparing Earth to Earth produced "the 34 K difference is greenhouse warming, Earth's
    // is 33 K", which reads as a contradiction and is really just the same quantity twice,
    // once derived and once quoted.
    return preamble + `That ${rise.toFixed(0)} K difference is the greenhouse effect, and it is `
      + "the reason the oceans are liquid rather than ice.";
  }
  return (
    preamble
    + `The ${rise.toFixed(0)} K difference is greenhouse warming. Earth's is 33 K`
    + (rise > 100 ? `, so this is ${(rise / 33).toFixed(0)} times Earth's.` : ".")
  );
}

function currentState(contract: BodyContract, env: EnvironmentMeasurements): CurrentState {
  const distance = heliocentricDistanceM(contract.id);
  const solar = solarConstantAt(distance);
  const earthSolar = solarConstantAt(AU_IN_METRES);
  const gm = env.gmBodyOnly ?? contract.gm;
  const gravity = surfaceGravity(gm, contract.equatorialRadiusM);
  const equilibrium = equilibriumTemperature(solar, env.bondAlbedo);
  const au = distance / AU_IN_METRES;
  return {
    heliocentricDistanceAu: au,
    solarConstantWPerM2: solar,
    solarConstantRelativeToEarth: solar / earthSolar,
    bondAlbedo: env.bondAlbedo,
    equilibriumTemperatureK: equilibrium,
    measuredSurfaceTemperatureK: contract.meanTemperatureK,
    greenhouseRiseK: contract.meanTemperatureK - equilibrium,
    greenhouseSummary: greenhouseSummaryFor(
      equilibrium,
      contract.meanTemperatureK,
      contract.id === "embary",
    ),
    surfaceGravityMS2: gravity,
    gravityRelativeToEarth: gravity / HUMAN_REQUIREMENTS.earthSurfaceGravityMS2,
    escapeVelocityMS: escapeVelocity(gm, contract.equatorialRadiusM),
    surfacePressurePa: contract.atmosphere?.surfacePressurePa ?? 0,
    surfaceDoseSvPerYear: env.surfaceDoseSvPerYear,
    doseRelativeToEarth:
      env.surfaceDoseSvPerYear === null
        ? null
        : env.surfaceDoseSvPerYear / HUMAN_REQUIREMENTS.earthBackgroundDoseSvPerYear,
    solarDayDays: Math.abs(
      solarDayDays(contract.siderealRotationDays, orbitalPeriodDays(contract.id)),
    ),
    hasIntrinsicMagneticField: env.surfaceMagneticFieldT > 1e-8,
    hasSolidSurface: env.hasSolidSurface,
    insideHabitableZone:
      au >= HABITABLE_ZONE_AU.runawayGreenhouse && au <= HABITABLE_ZONE_AU.maximumGreenhouse,
  };
}

function retentionFor(contract: BodyContract, env: EnvironmentMeasurements): Retention[] {
  const gm = env.gmBodyOnly ?? contract.gm;
  // Exobase a scale height or so above the surface, where one exists. The sensitivity is
  // mild: it enters linearly while temperature and molar mass dominate.
  const exobaseRadius = contract.equatorialRadiusM + (contract.atmosphere?.scaleHeightM ?? 0) * 5;
  return (Object.keys(MOLAR_MASS_G_PER_MOL) as SpeciesName[]).map((species) => {
    const lambda = jeansParameter(
      gm,
      exobaseRadius,
      env.exobaseTemperatureK,
      MOLAR_MASS_G_PER_MOL[species],
    );
    return { species, jeansParameter: lambda, verdict: retentionVerdict(lambda) };
  });
}

function chooseStrategy(id: BodyId, state: CurrentState, env: EnvironmentMeasurements): Strategy {
  if (contractFor(id).kind === "star") return "star";
  if (id === "embary") return "home";
  if (!env.hasSolidSurface) return "aerostat";
  // Radiation first, but only where going down actually helps. No amount of atmosphere
  // engineering matters on Europa's surface, where an unshielded person receives a lethal dose
  // in about ten minutes, and there the ice shell is both the shielding and the destination.
  // Io has the same radiation problem and no ice at all, so it gets the sealed-volume answer
  // and lets its own radiation barrier say how bad it is.
  if ((state.surfaceDoseSvPerYear ?? 0) > 50) {
    return env.crust === "ice-over-ocean" ? "ice-shell-subsurface" : "pressurised-habitat";
  }
  // A shell over a liquid ocean is the habitat even without a radiation problem forcing it.
  if (env.crust === "ice-over-ocean" && (state.surfaceDoseSvPerYear ?? 0) > 0.05) {
    return "ice-shell-subsurface";
  }
  // Too much sunlight to fix with chemistry: past the runaway greenhouse limit a water-rich
  // atmosphere cannot be stable at any composition, so the light has to go before anything
  // else can be done.
  if (state.heliocentricDistanceAu < HABITABLE_ZONE_AU.runawayGreenhouse) {
    return state.surfacePressurePa > 1e6 ? "shade-and-condense" : "pressurised-habitat";
  }
  const holdsNitrogen =
    jeansParameter(
      env.gmBodyOnly ?? contractFor(id).gm,
      contractFor(id).equatorialRadiusM,
      env.exobaseTemperatureK,
      MOLAR_MASS_G_PER_MOL.N2,
    ) >= 30;
  if (!holdsNitrogen) return "pressurised-habitat";
  if (state.insideHabitableZone) return "greenhouse-terraform";
  return state.surfacePressurePa > 1e4 ? "cryo-paraterraform" : "pressurised-habitat";
}

export { chooseStrategy as strategyFor };

// MARK: barriers

/**
 * What is wrong, ranked by how wrong.
 *
 * Severity is assigned from the physics rather than by hand, so a body cannot be flattered by
 * whoever wrote its entry. "Fatal" means no engineering changes it: a gas the body cannot
 * hold for more than a geological eyeblink, a radiation flux that kills before shielding can
 * be built, a surface that does not exist. "Severe" means it needs planetary-scale work.
 * "Manageable" means it needs a building.
 */
function barriersFor(
  contract: BodyContract,
  state: CurrentState,
  env: EnvironmentMeasurements,
  retention: readonly Retention[],
): Barrier[] {
  const out: Barrier[] = [];
  const g = state.surfaceGravityMS2;
  const needed = HUMAN_REQUIREMENTS.targetSurfacePressurePa;

  const temperatureGap = HUMAN_REQUIREMENTS.targetSurfaceTemperatureK - state.measuredSurfaceTemperatureK;
  if (Math.abs(temperatureGap) > 10) {
    out.push({
      id: "temperature",
      title: temperatureGap > 0 ? "Too cold" : "Too hot",
      severity: Math.abs(temperatureGap) > 200 ? "severe" : "manageable",
      statement:
        temperatureGap > 0
          ? `Mean surface temperature is ${state.measuredSurfaceTemperatureK.toFixed(0)} K, which is `
            + `${temperatureGap.toFixed(0)} K below the 288 K Earth sits at. Without an atmosphere at all `
            + `it would be ${state.equilibriumTemperatureK.toFixed(0)} K, so the gap that has to be `
            + `closed by greenhouse forcing is ${(HUMAN_REQUIREMENTS.targetSurfaceTemperatureK - state.equilibriumTemperatureK).toFixed(0)} K.`
          : `Mean surface temperature is ${state.measuredSurfaceTemperatureK.toFixed(0)} K. Sunlight alone `
            + `would give ${state.equilibriumTemperatureK.toFixed(0)} K, so `
            + `${state.greenhouseRiseK.toFixed(0)} K of it is greenhouse and has to be removed rather than shaded.`,
      quantities: [
        { label: "Measured surface", value: state.measuredSurfaceTemperatureK, unit: "K" },
        { label: "Sunlight alone", value: state.equilibriumTemperatureK, unit: "K" },
        {
          label: "Greenhouse effect now",
          value: state.greenhouseRiseK,
          unit: "K",
          note: "Earth's is 33 K",
        },
        {
          label: "Greenhouse needed for 288 K",
          value: HUMAN_REQUIREMENTS.targetSurfaceTemperatureK - state.equilibriumTemperatureK,
          unit: "K",
        },
      ],
    });
  }

  if (env.hasSolidSurface && Math.abs(state.surfacePressurePa - needed) / needed > 0.5) {
    const thin = state.surfacePressurePa < needed;
    const deficit = Math.abs(atmosphereMassFor(needed - state.surfacePressurePa, contract.equatorialRadiusM, g));
    out.push({
      id: "pressure",
      title: thin ? "No atmosphere to breathe" : "Crushing pressure",
      severity: thin && state.surfacePressurePa < 1000 ? "severe" : "manageable",
      statement: thin
        ? `Surface pressure is ${state.surfacePressurePa.toExponential(2)} Pa against the 101,325 Pa `
          + `a person needs. Holding one bar over this body takes a column of `
          + `${(needed / g).toFixed(0)} kg of gas above every square metre, so the whole planet needs `
          + `${deficit.toExponential(2)} kg of it.`
        : `Surface pressure is ${(state.surfacePressurePa / 1e5).toFixed(0)} bar. A person needs about one. `
          + `The excess is ${deficit.toExponential(2)} kg of gas that has to go somewhere.`,
      quantities: [
        { label: "Surface pressure now", value: state.surfacePressurePa, unit: "Pa" },
        { label: "Needed", value: needed, unit: "Pa" },
        {
          label: thin ? "Gas to import" : "Gas to remove",
          value: deficit,
          unit: "kg",
          note: `Earth's whole atmosphere is 5.15e18 kg`,
        },
      ],
    });
  }

  const nitrogen = retention.find((r) => r.species === "N2")!;
  const water = retention.find((r) => r.species === "H2O")!;
  if (nitrogen.verdict !== "retained") {
    out.push({
      id: "escape",
      title: "Cannot hold an atmosphere",
      severity: nitrogen.verdict === "blows-off" ? "fatal" : "severe",
      statement:
        `The Jeans parameter for nitrogen is ${nitrogen.jeansParameter.toFixed(1)}. Above about 30 a gas `
        + `stays for the age of the solar system; below about 6 the atmosphere leaves bodily rather than `
        + `molecule by molecule. Any atmosphere put here has to be treated as consumable and topped up.`,
      quantities: [
        { label: "Jeans parameter, N2", value: nitrogen.jeansParameter, unit: "" },
        { label: "Jeans parameter, water vapour", value: water.jeansParameter, unit: "" },
        { label: "Escape velocity", value: state.escapeVelocityMS, unit: "m/s" },
        { label: "Exobase temperature", value: env.exobaseTemperatureK, unit: "K" },
      ],
    });
  }

  if (state.surfaceDoseSvPerYear !== null && state.doseRelativeToEarth !== null) {
    const dose = state.surfaceDoseSvPerYear;
    const lethalDays = dose > 0 ? (4 / dose) * 365.25 : Infinity;
    out.push({
      id: "radiation",
      title: dose > 1 ? "Lethal radiation" : dose > 0.05 ? "Radiation over the limit" : "Radiation",
      severity: dose > 50 ? "fatal" : dose > 0.05 ? "severe" : dose > 0.01 ? "manageable" : "none",
      statement:
        `Unshielded surface dose is ${dose.toExponential(2)} Sv per year, `
        + `${state.doseRelativeToEarth.toFixed(dose > 1 ? 0 : 1)} times Earth's natural background and `
        + `${(dose / HUMAN_REQUIREMENTS.occupationalDoseLimitSvPerYear).toFixed(1)} times the occupational `
        + `limit. `
        /**
         * The exposure sentence only when exposure is the point.
         *
         * Earth's own panel read "accumulates a 4 Sv half-lethal dose in 608750 days", which
         * is 1,667 years expressed in the least useful available unit and says nothing a
         * reader can act on. The figure earns its place where it is measured in hours, and
         * the unit has to follow the magnitude rather than being fixed.
         */
        + (lethalDays > 25_000
          ? "Nobody has ever been harmed by a dose rate like this; it is the background a "
            + "person already lives in."
          : "An unshielded person accumulates a 4 Sv half-lethal dose in "
            + (lethalDays < 2
              ? `${(lethalDays * 24).toFixed(1)} hours.`
              : lethalDays < 730
                ? `${lethalDays.toFixed(0)} days.`
                : `${(lethalDays / 365.25).toFixed(0)} years.`)),
      quantities: [
        { label: "Surface dose", value: dose, unit: "Sv/yr" },
        { label: "Times Earth background", value: state.doseRelativeToEarth, unit: "x" },
        {
          label: "Shielding to reach Earth parity",
          value: 1033,
          unit: "g/cm2",
          note: "what Earth's atmosphere provides",
        },
        {
          label: "Shielding one bar would give here",
          value: columnDensityGPerCm2(needed, g),
          unit: "g/cm2",
        },
      ],
    });
  }

  const gRel = state.gravityRelativeToEarth;
  if (Math.abs(gRel - 1) > 0.15) {
    out.push({
      id: "gravity",
      title: gRel < 1 ? "Low gravity" : "High gravity",
      severity: gRel < 0.15 || gRel > 2.5 ? "severe" : "manageable",
      statement:
        `Surface gravity is ${gRel.toFixed(2)} g. This is the one barrier on the list with no engineering `
        + `answer at planetary scale: you cannot change a body's mass. Every other item here is a question `
        + `of how much energy and how long, and this one is a question of whether human physiology adapts, `
        + `which no experiment has yet answered for anything between the Moon's 0.17 g and Earth's 1 g.`,
      quantities: [
        { label: "Surface gravity", value: state.surfaceGravityMS2, unit: "m/s2" },
        { label: "Relative to Earth", value: gRel, unit: "g" },
        { label: "Escape velocity", value: state.escapeVelocityMS, unit: "m/s" },
      ],
    });
  }

  if (state.solarDayDays > 10 && env.hasSolidSurface) {
    out.push({
      id: "daylength",
      title: "The day is far too long",
      severity: state.solarDayDays > 100 ? "severe" : "manageable",
      statement:
        `A solar day lasts ${state.solarDayDays.toFixed(1)} Earth days, so each side bakes and then freezes `
        + `for weeks at a time. Crops and climate both run on a 24-hour cycle, and the gap between the two `
        + `is not something a greenhouse fixes.`,
      quantities: [
        { label: "Solar day", value: state.solarDayDays, unit: "days" },
        { label: "Sidereal rotation", value: contract.siderealRotationDays, unit: "days" },
        {
          label: "Energy to spin to a 24-hour day",
          value: spinChangeEnergy(
            (env.gmBodyOnly ?? contract.gm) / GRAVITATIONAL_CONSTANT,
            contract.equatorialRadiusM,
            env.momentOfInertiaFactor,
            contract.siderealRotationDays,
            1,
          ),
          unit: "J",
          note: "Earth's entire rotational energy is 2.1e29 J",
        },
      ],
    });
  }

  if (!env.hasSolidSurface) {
    out.push({
      id: "surface",
      title: "There is no surface",
      severity: "fatal",
      statement:
        "Pressure and temperature rise continuously with depth until the hydrogen becomes a supercritical "
        + "fluid and then a metal. There is no level at which anything could be built on, at any depth, so "
        + "the only habitable structure is one that floats.",
      quantities: [
        { label: "Gravity at the one-bar level", value: state.surfaceGravityMS2, unit: "m/s2" },
        { label: "Relative to Earth", value: state.gravityRelativeToEarth, unit: "g" },
        { label: "Temperature at one bar", value: env.oneBarLevel?.temperatureK ?? contract.meanTemperatureK, unit: "K" },
      ],
    });
  }

  const order: Record<Severity, number> = { fatal: 0, severe: 1, manageable: 2, none: 3 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

// MARK: the ladder

/** A 5 km comet at 600 kg/m^3, the unit volatile delivery in the outer-system import literature. */
export const COMET_MASS_KG = (4 / 3) * Math.PI * 5000 ** 3 * 600;
/** Aluminised polymer film at 4 microns, the usual solar-sail areal density. */
export const SAIL_AREAL_DENSITY_KG_PER_M2 = 1e-3;
/** Gibbs free energy to split one mole of CO2 into CO and half a mole of O2, J. */
export const CO2_SPLIT_ENERGY_J_PER_MOL = 257_200;
/** Earth's net primary production expressed as oxygen, kg/yr. Field et al. 1998, Science 281. */
export const EARTH_OXYGEN_PRODUCTION_KG_PER_YEAR = 3.0e14;

function sunlightSteps(
  contract: BodyContract,
  state: CurrentState,
  env: EnvironmentMeasurements,
  order: number,
): Step[] {
  const earthSolar = solarConstantAt(AU_IN_METRES);
  const area = collectorAreaFor(contract.equatorialRadiusM, state.solarConstantWPerM2, earthSolar);
  const adding = area > 0;
  const discRadius = Math.sqrt(Math.abs(area) / Math.PI);
  const distance = heliocentricDistanceM(contract.id);
  const l1 = l1Distance(env.gmBodyOnly ?? contract.gm, 1.327_124_400_41e20, distance);
  const umbra = fullUmbraRadius(contract.equatorialRadiusM, l1, distance);

  return [
    {
      order,
      title: adding ? "Add sunlight with orbital mirrors" : "Subtract sunlight with an orbital shade",
      mechanism: adding
        ? "A thin-film reflector station-kept near the sunward L1 point intercepts sunlight that would "
          + "otherwise miss the planet and redirects it onto the disc. The body already intercepts its "
          + "solar constant across pi R squared, so raising the insolation by a given fraction costs a "
          + "mirror of that fraction of the planet's own cross-section. Film thickness, not area, is the "
          + "cost driver: the structure has no load to carry, only light pressure to balance, which is "
          + "what a solar sail already does. Unlike greenhouse gases this works on day one and is "
          + "reversible by turning the mirror edge-on."
        : "A thin-film occulter station-kept near the sunward L1 point removes sunlight before it arrives. "
          + "Because the Sun is a disc and not a point, a shade at L1 casts an umbra that narrows with "
          + "distance, so a full eclipse needs a shade meaningfully wider than the planet. Birch's "
          + "proposal for Venus is exactly this, and its virtue is that it needs no chemistry at all: it "
          + "changes one number in the energy balance and lets the planet's own radiative cooling do "
          + "everything else.",
      quantities: [
        { label: "Sunlight here now", value: state.solarConstantWPerM2, unit: "W/m2" },
        { label: "Relative to Earth", value: state.solarConstantRelativeToEarth, unit: "x" },
        {
          label: adding ? "Mirror area for Earth-level sunlight" : "Shade area for Earth-level sunlight",
          value: Math.abs(area),
          unit: "m2",
        },
        { label: "As a single disc, radius", value: discRadius, unit: "m" },
        {
          label: "Film mass at 4 microns",
          value: Math.abs(area) * SAIL_AREAL_DENSITY_KG_PER_M2,
          unit: "kg",
          note: "world steel production is 2e12 kg a year",
        },
        { label: "Distance to the L1 point", value: l1, unit: "m" },
        {
          label: "Shade radius for a total eclipse",
          value: umbra,
          unit: "m",
          note: `the planet's own radius is ${(contract.equatorialRadiusM / 1000).toFixed(0)} km`,
        },
      ],
      timescale: "decades to build, immediate in effect once deployed",
      maturity: "engineering-extrapolation",
      source: adding
        ? "Zubrin & McKay 1997, JBIS 50, 83; Fogg 1995, ch. 8"
        : "Birch 1991, JBIS 44, 157, 'Terraforming Venus Quickly'",
    },
  ];
}

function greenhouseTerraformLadder(
  contract: BodyContract,
  state: CurrentState,
  env: EnvironmentMeasurements,
): Step[] {
  const g = state.surfaceGravityMS2;
  const R = contract.equatorialRadiusM;
  const target = HUMAN_REQUIREMENTS.targetSurfacePressurePa;
  const pfcMass = atmosphereMassFor(0.2, R, g);
  const fullBar = atmosphereMassFor(target, R, g);
  const deficit = fullBar - atmosphereMassFor(state.surfacePressurePa, R, g);
  const nitrogenMass = atmosphereMassFor(target - HUMAN_REQUIREMENTS.targetOxygenPartialPressurePa, R, g);
  const oxygenMass = atmosphereMassFor(HUMAN_REQUIREMENTS.targetOxygenPartialPressurePa, R, g);
  const oxygenMoles = oxygenMass / (MOLAR_MASS_G_PER_MOL.O2 / 1000);
  const oxygenEnergy = oxygenMoles * 2 * CO2_SPLIT_ENERGY_J_PER_MOL;
  const interceptedPower = state.solarConstantWPerM2 * Math.PI * R * R;
  const loss = env.atmosphericLossKgPerS;

  return [
    {
      order: 1,
      title: "Start the warming with super-greenhouse gases",
      mechanism:
        "CO2 is a poor greenhouse gas in the 8 to 12 micron window where a cold surface does most of its "
        + "radiating, which is why a thin CO2 atmosphere warms a planet so little. Perfluorocarbons absorb "
        + "precisely there, and they do it with no ozone chemistry, no rainout and atmospheric lifetimes of "
        + "thousands of years. A fraction of a pascal is enough to matter, because the absorption is "
        + "saturated nowhere. The point is not the warming itself but the feedback it starts: a few degrees "
        + "sublimes the polar CO2 caps and desorbs CO2 from the regolith, that CO2 warms it further, and "
        + "the process runs on its own. Marinova's optimised C-F mixture reaches about 8 K from 0.2 Pa.",
      quantities: [
        { label: "Super-greenhouse gas for 0.2 Pa", value: pfcMass, unit: "kg" },
        { label: "Warming that buys", value: 8, unit: "K", note: "Marinova et al. 2005" },
        {
          label: "Still needed after that",
          value: HUMAN_REQUIREMENTS.targetSurfaceTemperatureK - state.equilibriumTemperatureK - 8,
          unit: "K",
        },
      ],
      timescale: "decades to manufacture and release, then centuries of feedback",
      maturity: "engineering-extrapolation",
      source: "Marinova, McKay & Hashimoto 2005, JGR Planets 110, E03002; McKay, Toon & Kasting 1991, Nature 352, 489",
    },
    {
      order: 2,
      title: "Release every volatile the planet already has",
      mechanism:
        "Warming the poles returns the seasonal and permanent CO2 caps to the air, and warming the regolith "
        + "desorbs the CO2 held on grain surfaces. This is the free part of the process and it is also where "
        + "the plan runs into its real wall. Jakosky and Edwards inventoried every accessible reservoir on "
        + "Mars, caps, regolith, and carbonates reachable by any plausible means, and found enough for about "
        + "20 millibar. That is roughly one fiftieth of what is needed, so no amount of cleverness with "
        + "indigenous material closes the gap. Everything beyond this step has to be imported.",
      quantities: [
        { label: "Accessible CO2 on Mars", value: 2000, unit: "Pa", note: "Jakosky & Edwards 2018" },
        { label: "Target", value: target, unit: "Pa" },
        { label: "Fraction of the way there", value: 2000 / target, unit: "x" },
      ],
      timescale: "centuries, limited by how fast the regolith warms",
      maturity: "engineering-extrapolation",
      source: "Jakosky & Edwards 2018, Nature Astronomy 2, 634",
    },
    {
      order: 3,
      title: "Import the rest from the outer solar system",
      mechanism:
        "Comets and the ice-rich small bodies past the frost line carry exactly what is missing: water, CO2, "
        + "and ammonia, which is both a strong greenhouse gas and the nitrogen source needed later. Delivery "
        + "is gravity assists rather than propulsion, because a small nudge at the right point in an orbit "
        + "converts into an enormous change over decades of free flight. Each impact also deposits its "
        + "kinetic energy as heat, so the delivery and the warming are the same event. The cost is measured "
        + "in objects rather than in joules, and the number of objects is the honest headline.",
      quantities: [
        { label: "Gas still needed", value: deficit, unit: "kg" },
        { label: "Mass of one 5 km comet", value: COMET_MASS_KG, unit: "kg" },
        { label: "Comets required", value: deficit / COMET_MASS_KG, unit: "" },
        {
          label: "One a week would take",
          value: deficit / COMET_MASS_KG / 52,
          unit: "years",
        },
      ],
      timescale: "centuries to millennia",
      maturity: "speculative",
      source: "Zubrin & McKay 1997, JBIS 50, 83; Fogg 1995, ch. 9",
    },
    {
      order: 4,
      title: "Build the nitrogen buffer before the oxygen",
      mechanism:
        "A breathable atmosphere is mostly the gas you do not breathe. Oxygen at its sea-level partial "
        + "pressure in a pure-oxygen atmosphere is chemically the same for a lung and catastrophically "
        + "different for everything else: flame spread rates rise by orders of magnitude, which is what "
        + "killed the Apollo 1 crew. An inert buffer at roughly four fifths of the total is not a luxury. "
        + "Nitrogen is the only candidate available in quantity, and the outer system supplies it as "
        + "ammonia, which doubles as greenhouse forcing on the way in.",
      quantities: [
        { label: "Nitrogen for a 0.8 bar buffer", value: nitrogenMass, unit: "kg" },
        { label: "Earth's nitrogen inventory", value: 3.9e18, unit: "kg" },
        { label: "Relative to Earth's", value: nitrogenMass / 3.9e18, unit: "x" },
      ],
      timescale: "concurrent with import",
      maturity: "speculative",
      source: "Fogg 1995, ch. 9; Zubrin, 'The Case for Mars', ch. 8",
    },
    {
      order: 5,
      title: "Oxygenate it, which is the slow step",
      mechanism:
        "Oxygen has to be prised out of CO2 or out of metal oxides, and both are strongly uphill: splitting "
        + "a mole of CO2 costs 257 kilojoules, and no catalyst changes a thermodynamic floor. Doing it "
        + "industrially means finding that energy. Doing it biologically means photosynthesis, which is the "
        + "same reaction powered by sunlight at about one per cent efficiency, and which is how Earth did "
        + "it. Earth's own Great Oxidation took hundreds of millions of years, and the only reason a "
        + "terraformed planet would be faster is that it starts with an engineered biosphere rather than "
        + "with cyanobacteria inventing the chemistry from scratch.",
      quantities: [
        { label: "Oxygen needed", value: oxygenMass, unit: "kg" },
        { label: "Energy to split it from CO2", value: oxygenEnergy, unit: "J" },
        {
          label: "Sunlight the whole planet intercepts",
          value: interceptedPower,
          unit: "W",
        },
        {
          label: "At 100% of all incident sunlight",
          value: oxygenEnergy / interceptedPower / SECONDS_PER_JULIAN_YEAR,
          unit: "years",
          note: "a floor, not an estimate",
        },
        {
          label: "At Earth's biosphere's rate, scaled by area",
          value:
            oxygenMass /
            (EARTH_OXYGEN_PRODUCTION_KG_PER_YEAR *
              ((4 * Math.PI * R * R) / (4 * Math.PI * 6.371e6 ** 2))),
          unit: "years",
        },
      ],
      timescale: "tens of thousands of years at best",
      maturity: "speculative",
      source: "McKay, Toon & Kasting 1991, Nature 352, 489; Field et al. 1998, Science 281, 237",
    },
    {
      order: 6,
      title: "Decide whether the magnetic field is worth building",
      mechanism:
        "This is the step most often assumed to be first and is in fact optional, which the measured "
        + "numbers settle rather than argue. MAVEN measured the present loss of the Martian atmosphere to "
        + "the solar wind directly. At that rate, stripping a full bar takes longer than the Sun has left "
        + "on the main sequence. The lack of a magnetic field explains why Mars is thin today, after four "
        + "billion years; it does not threaten an atmosphere placed there on any timescale a civilisation "
        + "cares about. If one is wanted anyway, a 1 to 2 tesla dipole at the sunward L1 point puts the "
        + "whole planet inside an artificial magnetotail, which is far easier than magnetising a core.",
      quantities: [
        { label: "Measured loss rate", value: loss ?? 0, unit: "kg/s", note: "MAVEN" },
        {
          label: "Time to strip a full bar at that rate",
          value: loss ? fullBar / loss / SECONDS_PER_JULIAN_YEAR : Infinity,
          unit: "years",
        },
        { label: "Remaining main-sequence lifetime of the Sun", value: 5e9, unit: "years" },
      ],
      timescale: "optional; the atmosphere outlives the question",
      maturity: "engineering-extrapolation",
      source: "Jakosky et al. 2018, Icarus 315, 146; Green et al. 2017, Planetary Science Vision 2050",
    },
  ];
}

function shadeAndCondenseLadder(
  contract: BodyContract,
  state: CurrentState,
  env: EnvironmentMeasurements,
): Step[] {
  const g = state.surfaceGravityMS2;
  const R = contract.equatorialRadiusM;
  const atmosphereMass = atmosphereMassFor(state.surfacePressurePa, R, g);
  const co2MassFraction = 0.965 * 44.01 / (0.965 * 44.01 + 0.035 * 28.014);
  const co2Mass = atmosphereMass * co2MassFraction;
  const n2Mass = atmosphereMass * (1 - co2MassFraction);
  const n2Pressure = (n2Mass * g) / (4 * Math.PI * R * R);
  // Sensible heat only; the latent heat of condensing it is the same order again.
  const coolingEnergy = co2Mass * 850 * (state.measuredSurfaceTemperatureK - 217);
  const initialRadiatedPower =
    STEFAN_BOLTZMANN * state.measuredSurfaceTemperatureK ** 4 * 4 * Math.PI * R * R;
  const cloud = env.oneBarLevel;
  const lift = cloud
    ? buoyantLift(HUMAN_REQUIREMENTS.targetSurfacePressurePa, cloud.temperatureK, MOLAR_MASS_G_PER_MOL.CO2, EARTH_AIR_MOLAR_MASS)
    : null;

  const steps: Step[] = [];
  if (cloud && lift) {
    steps.push({
      order: 1,
      title: "Live in the clouds first, because that part needs no terraforming at all",
      mechanism:
        "Fifty kilometres above the surface of Venus the pressure is one bar, the temperature is about 75 "
        + "degrees Celsius, gravity is 0.9 g, and the CO2 column overhead is thicker shielding than Earth's "
        + "whole atmosphere. It is, by a distance, the most Earth-like environment in the solar system "
        + "outside Earth. The reason it works is a coincidence of molar masses: ordinary breathing air is "
        + "lighter than CO2, so a habitat filled with air at ambient pressure floats in the Venusian "
        + "atmosphere the way a helium balloon floats in Earth's. The envelope carries no pressure "
        + "differential, a tear leaks slowly instead of exploding, and the failure mode of losing lift gas "
        + "is losing the air you were breathing anyway. Sulphuric acid is the real engineering problem, and "
        + "it is a materials problem rather than a physics one.",
      quantities: [
        { label: "Altitude of the one-bar level", value: cloud.altitudeM, unit: "m" },
        { label: "Temperature there", value: cloud.temperatureK, unit: "K" },
        { label: "Gravity there", value: state.gravityRelativeToEarth, unit: "g" },
        { label: "Lift of breathing air in CO2", value: lift.liftFraction, unit: "fraction" },
        { label: "Lift per cubic metre", value: lift.liftKgPerM3, unit: "kg/m3" },
        {
          label: "Lift of a 100 m sphere",
          value: lift.liftKgPerM3 * (4 / 3) * Math.PI * 50 ** 3,
          unit: "kg",
        },
      ],
      timescale: "no planetary engineering required",
      maturity: "engineering-extrapolation",
      source: "Landis 2003, AIP Conf. Proc. 654, 1193, 'Colonization of Venus'",
    });
  }

  steps.push(
    ...sunlightSteps(contract, state, env, steps.length + 1).map((s) => ({
      ...s,
      title: "Shade the whole planet",
    })),
    {
      order: steps.length + 2,
      title: "Let it cool, and watch the CO2 condense",
      mechanism:
        "With the sunlight gone the planet radiates into space and nothing replaces the heat. The first "
        + "threshold is not freezing but the critical point: below 304 K and above 74 bar, CO2 is no longer "
        + "a gas at all, and 92 bar of atmosphere becomes an ocean of liquid carbon dioxide several hundred "
        + "metres deep. Keep going to the triple point at 217 K and 5.2 bar and it snows dry ice. This is "
        + "the elegance of the shade approach: it does not remove the CO2, it changes its phase, and the "
        + "planet's own gravity then stacks it on the ground where it can be buried. Cooling rate is set by "
        + "the Stefan-Boltzmann law, so it is fast at first and slows as the fourth power.",
      quantities: [
        { label: "Atmosphere to cool", value: co2Mass, unit: "kg" },
        { label: "Heat to remove to reach the triple point", value: coolingEnergy, unit: "J" },
        { label: "Radiated power at the start", value: initialRadiatedPower, unit: "W" },
        {
          label: "Cooling time if the rate held",
          value: coolingEnergy / initialRadiatedPower / SECONDS_PER_JULIAN_YEAR,
          unit: "years",
          note: "a lower bound; the rate falls as T to the fourth",
        },
        { label: "CO2 critical temperature", value: 304.1, unit: "K" },
        { label: "CO2 triple point", value: 216.6, unit: "K" },
      ],
      timescale: "decades to a couple of centuries",
      maturity: "speculative",
      source: "Birch 1991, JBIS 44, 157",
    },
    {
      order: steps.length + 3,
      title: "Keep the nitrogen, which turns out to be the prize",
      mechanism:
        "Venus's atmosphere is 3.5 per cent nitrogen by volume, and 3.5 per cent of 92 bar is a great deal "
        + "of nitrogen. Once the CO2 is on the ground, what is left standing is a nitrogen atmosphere of "
        + "about two bar, which is more nitrogen than Earth has and exactly the inert buffer gas that Mars "
        + "has to import from Saturn. The remaining work is adding oxygen and removing the surplus, which "
        + "is a far smaller task than the one just completed. Water remains the hard gap: Venus's deuterium "
        + "to hydrogen ratio is 150 times Earth's, the signature of an ocean that boiled off and whose "
        + "hydrogen escaped, so hydrogen has to be imported to make water.",
      quantities: [
        { label: "Nitrogen already present", value: n2Mass, unit: "kg" },
        { label: "Pressure it would exert alone", value: n2Pressure, unit: "Pa" },
        { label: "Earth's nitrogen inventory", value: 3.9e18, unit: "kg" },
        { label: "Relative to Earth's", value: n2Mass / 3.9e18, unit: "x" },
        {
          label: "Hydrogen for a 10 m global ocean",
          value: (4 * Math.PI * R * R * 10 * 1000 * 2.016) / 18.015,
          unit: "kg",
        },
      ],
      timescale: "centuries",
      maturity: "speculative",
      source: "Birch 1991, JBIS 44, 157; Donahue et al. 1982, Science 216, 630 (D/H ratio)",
    },
    {
      order: steps.length + 4,
      title: "Do not try to spin it up",
      mechanism:
        "Venus turns backwards once every 243 days, giving a solar day of 117 days. The instinct is to "
        + "change that, and the moment of inertia says what it costs. The answer is comparable to the "
        + "planet's entire rotational energy budget and is not reachable by any means that does not also "
        + "destroy the surface. The alternative is cheap by comparison: the same orbital mirrors used for "
        + "shading can be steered to deliver a 24-hour light cycle to the ground. Day length is a lighting "
        + "problem, not a mechanical one, and solving it as lighting costs a rounding error of the energy.",
      quantities: [
        {
          label: "Energy to reach a 24-hour prograde day",
          value: spinChangeEnergy(
            (env.gmBodyOnly ?? contract.gm) / GRAVITATIONAL_CONSTANT,
            R,
            env.momentOfInertiaFactor,
            contract.siderealRotationDays,
            1,
          ),
          unit: "J",
        },
        { label: "Earth's entire rotational energy", value: 2.1e29, unit: "J" },
        { label: "World energy use in a year", value: 6.3e20, unit: "J" },
        { label: "Solar day now", value: state.solarDayDays, unit: "days" },
      ],
      timescale: "not worth attempting",
      maturity: "speculative",
      source: "Birch 1991, JBIS 44, 157; Fogg 1995, ch. 10",
    },
  );
  return steps.map((s, i) => ({ ...s, order: i + 1 }));
}

function aerostatLadder(
  contract: BodyContract,
  state: CurrentState,
  env: EnvironmentMeasurements,
): Step[] {
  const level = env.oneBarLevel;
  const temperature = level?.temperatureK ?? contract.meanTemperatureK;
  // The giants are hydrogen and helium, so breathing air is heavier than the ambient gas and
  // the sign of the buoyancy flips. That is the whole difference between Venus and Jupiter.
  const ambientMolarMass = contract.id === "venus" ? MOLAR_MASS_G_PER_MOL.CO2 : 2.3;
  const lift = buoyantLift(
    HUMAN_REQUIREMENTS.targetSurfacePressurePa,
    temperature,
    ambientMolarMass,
    EARTH_AIR_MOLAR_MASS,
  );
  const heliumLift = buoyantLift(
    HUMAN_REQUIREMENTS.targetSurfacePressurePa,
    temperature,
    ambientMolarMass,
    MOLAR_MASS_G_PER_MOL.He,
  );
  const R = contract.equatorialRadiusM;

  return [
    {
      order: 1,
      title: "Find the one-bar level and stay there",
      mechanism:
        "A gas giant has no surface, so the only fixed reference is a pressure level, and the one that "
        + "matters is one bar. Above it the atmosphere is too thin to breathe and too cold; below it the "
        + "pressure and temperature climb without limit until hydrogen turns metallic. The one-bar level is "
        + "therefore not a compromise but the only habitable altitude, and everything else follows from "
        + "what is true there.",
      quantities: [
        { label: "Temperature at one bar", value: temperature, unit: "K" },
        { label: "Gravity at one bar", value: state.surfaceGravityMS2, unit: "m/s2" },
        { label: "Relative to Earth", value: state.gravityRelativeToEarth, unit: "g" },
        { label: "Sunlight there", value: state.solarConstantWPerM2, unit: "W/m2" },
        { label: "Relative to Earth", value: state.solarConstantRelativeToEarth, unit: "x" },
      ],
      timescale: "immediate",
      maturity: "engineering-extrapolation",
      source: "NASA fact sheets; Seiff et al. 1998, JGR 103, 22857 (Galileo probe)",
    },
    {
      order: 2,
      title: "Float, and check which way the buoyancy points",
      mechanism:
        "A habitat at ambient pressure floats or sinks purely on the ratio of molar masses, because at "
        + "equal pressure and temperature density goes as molar mass and nothing else. This is where the "
        + "giants and Venus part company, and the sign of one number decides it. Venus's atmosphere is CO2 "
        + "at 44 g per mole, so breathing air at 29 floats in it and a habitat is a balloon full of air. A "
        + "gas giant's atmosphere is hydrogen and helium at about 2.3, so breathing air is more than ten "
        + "times denser than its surroundings and sinks like a stone. A habitat here must be a hot-air "
        + "balloon of the ambient hydrogen, heated by its own waste power, or it must be held up "
        + "aerodynamically, and both are far harder than floating.",
      quantities: [
        { label: "Ambient molar mass", value: ambientMolarMass, unit: "g/mol" },
        { label: "Breathing air molar mass", value: EARTH_AIR_MOLAR_MASS, unit: "g/mol" },
        {
          label: "Lift of breathing air",
          value: lift.liftKgPerM3,
          unit: "kg/m3",
          note: lift.liftKgPerM3 > 0 ? "it floats" : "negative: it sinks",
        },
        { label: "Lift of helium for comparison", value: heliumLift.liftKgPerM3, unit: "kg/m3" },
        { label: "Ambient density at one bar", value: lift.ambientDensityKgPerM3, unit: "kg/m3" },
      ],
      timescale: "immediate",
      maturity: "engineering-extrapolation",
      source: "Landis 2003, AIP Conf. Proc. 654, 1193",
    },
    {
      order: 3,
      title: "Survive the magnetosphere",
      mechanism:
        "A giant's magnetic field is not protection here, it is the hazard. Jupiter's field is twenty "
        + "thousand times Earth's and it accelerates trapped particles to energies where ordinary shielding "
        + "makes things worse, because stopping a relativistic electron in aluminium produces a shower of "
        + "bremsstrahlung X-rays. Shielding has to be low atomic number and thick, which is mass, which a "
        + "floating habitat cannot spare. The practical answer is to float deep enough that the atmosphere "
        + "above provides the column density, which the one-bar level already does.",
      quantities: [
        { label: "Equatorial surface field", value: env.surfaceMagneticFieldT, unit: "T" },
        { label: "Relative to Earth's", value: env.surfaceMagneticFieldT / 3.1e-5, unit: "x" },
        {
          label: "Shielding above the one-bar level",
          value: columnDensityGPerCm2(HUMAN_REQUIREMENTS.targetSurfacePressurePa, state.surfaceGravityMS2),
          unit: "g/cm2",
          note: "Earth's atmosphere is 1033",
        },
      ],
      timescale: "design constraint, not a project",
      maturity: "engineering-extrapolation",
      source:
        "Connerney et al. 2018, Geophysical Research Letters 45, 2590 (Juno JRM09); "
        + "Bolton et al. 2017, Science 356, 821",
    },
    {
      order: 4,
      title: "Take the resources, which are the actual reason to be here",
      mechanism:
        "A gas giant is a chemical plant that needs no mining. Hydrogen and helium can be scooped directly "
        + "from the airstream at the habitat's own altitude, and helium-3, which is almost absent on Earth "
        + "and is the cleanest fusion fuel known, is present at parts per million of a very large number. "
        + "Water clouds sit a few scale heights below and ammonia above. Nothing has to be landed on, "
        + "launched from, or dug out, and the escape velocity that makes export expensive is the same "
        + "gravity that keeps the habitat's altitude stable.",
      quantities: [
        { label: "Escape velocity", value: state.escapeVelocityMS, unit: "m/s" },
        { label: "Relative to Earth's", value: state.escapeVelocityMS / 11_186, unit: "x" },
        { label: "Surface area of the one-bar level", value: 4 * Math.PI * R * R, unit: "m2" },
        {
          label: "Relative to Earth's whole surface",
          value: (R * R) / 6.371e6 ** 2,
          unit: "x",
        },
      ],
      timescale: "ongoing",
      maturity: "speculative",
      source: "Palaszewski 2006, NASA/TM-2006-214122 (atmospheric mining of the outer planets)",
    },
  ];
}

function pressurisedHabitatLadder(
  contract: BodyContract,
  state: CurrentState,
  env: EnvironmentMeasurements,
): Step[] {
  const R = contract.equatorialRadiusM;
  const g = state.surfaceGravityMS2;
  const dose = state.surfaceDoseSvPerYear ?? 0.1;
  // Regolith at 1500 kg/m^3. 100 g/cm^2 is the usual working figure for bringing a GCR dose
  // down to roughly terrestrial, beyond which secondary production stops paying.
  const shieldingDepthM = (100 * 10) / 1500;
  const worldhouseArea = 4 * Math.PI * R * R;
  const roofMass = (HUMAN_REQUIREMENTS.targetSurfacePressurePa / g) * worldhouseArea;
  const nitrogen = jeansParameter(
    env.gmBodyOnly ?? contract.gm,
    R,
    env.exobaseTemperatureK,
    MOLAR_MASS_G_PER_MOL.N2,
  );

  return [
    {
      order: 1,
      title: "Accept that an open-air surface is off the table, and say why",
      mechanism:
        "This is the step that decides the whole approach, and it is decided by one number. The Jeans "
        + "parameter for nitrogen says how tightly this body could hold an atmosphere if one were given to "
        + "it, and where it falls short, an atmosphere is not a thing you build once but a thing you "
        + "continuously replace. Where the body is also airless today, there is a second and more immediate "
        + "problem: no atmosphere means no shielding, and no shielding means the dose at the surface is set "
        + "by the unattenuated cosmic-ray flux. Both point the same way. The habitat is a sealed volume, "
        + "and the planet is a place to put it and a source of material, not an environment.",
      quantities: [
        { label: "Jeans parameter for nitrogen", value: nitrogen, unit: "", note: "30 or more holds it" },
        { label: "Escape velocity", value: state.escapeVelocityMS, unit: "m/s" },
        { label: "Surface pressure now", value: state.surfacePressurePa, unit: "Pa" },
        { label: "Surface dose", value: dose, unit: "Sv/yr" },
      ],
      timescale: "a conclusion, not a task",
      maturity: "demonstrated",
      source: "Catling & Kasting 2017, 'Atmospheric Evolution on Inhabited and Lifeless Worlds', ch. 5",
    },
    {
      order: 2,
      title: "Put mass between yourself and the sky",
      mechanism:
        "What stops a cosmic ray is grams of material per square centimetre in the way, and broadly not "
        + "what the grams are made of, which means the regolith underfoot is the shielding and it is free. "
        + "Roughly 100 g per square centimetre brings a galactic-cosmic-ray dose down towards terrestrial; "
        + "past that, secondary particles produced in the shield start to offset what the shield stops, so "
        + "more depth buys progressively less. Lava tubes do this for nothing: the Moon and Mars both have "
        + "intact ones hundreds of metres across, already roofed by tens of metres of basalt.",
      quantities: [
        { label: "Dose at the surface", value: dose, unit: "Sv/yr" },
        { label: "Times Earth background", value: dose / HUMAN_REQUIREMENTS.earthBackgroundDoseSvPerYear, unit: "x" },
        { label: "Shielding needed", value: 100, unit: "g/cm2" },
        { label: "Depth of regolith that is", value: shieldingDepthM, unit: "m" },
        {
          label: "Mass over a 100 m dome",
          value: 100 * 10 * Math.PI * 50 ** 2,
          unit: "kg",
        },
      ],
      timescale: "immediate with local material",
      maturity: "engineering-extrapolation",
      source: "Hassler et al. 2014, Science 343, 1244797; Simonsen & Nealy 1991, NASA TP-3079",
    },
    {
      order: 3,
      title: "Mine the volatiles out of the cold traps",
      mechanism:
        "An airless body with a small axial tilt has craters at its poles whose floors have not seen "
        + "sunlight in billions of years, sitting at 40 K or below. Anything volatile that ever arrived is "
        + "still there. Both the Moon and Mercury have confirmed water ice in exactly these places, "
        + "Mercury's by radar and neutron spectroscopy despite a dayside hot enough to melt lead a few "
        + "hundred kilometres away. That water is hydrogen, oxygen, propellant, radiation shielding and "
        + "drinking water, and it is why the poles rather than the equator are where a base goes.",
      quantities: [
        { label: "Obliquity", value: contract.obliquityToOrbitDeg, unit: "deg" },
        { label: "Solar day", value: state.solarDayDays, unit: "days" },
        { label: "Sunlight here", value: state.solarConstantWPerM2, unit: "W/m2" },
        { label: "Relative to Earth", value: state.solarConstantRelativeToEarth, unit: "x" },
      ],
      timescale: "first decade of any serious presence",
      maturity: "demonstrated",
      source: "Lawrence et al. 2013, Science 339, 292 (MESSENGER); Colaprete et al. 2010, Science 330, 463 (LCROSS)",
    },
    {
      order: 4,
      title: "If you want open air, roof the planet rather than wrapping it",
      mechanism:
        "Paraterraforming, the worldhouse: rather than give the body an atmosphere it cannot hold, build a "
        + "transparent canopy over the surface and pressurise underneath it. The structural requirement "
        + "inverts the usual intuition. The roof is not holding pressure down, it is holding it in against "
        + "the vacuum above, so what it needs is tensile strength and mass, and the mass needed per square "
        + "metre is exactly the mass of atmosphere it replaces. Low gravity, which is a problem everywhere "
        + "else on this list, is here the thing that makes it cheap. It also scales: it works at one "
        + "hectare and at one hemisphere, and there is no threshold to cross before any of it is useful.",
      quantities: [
        { label: "Whole-body roof area", value: worldhouseArea, unit: "m2" },
        { label: "Mass of roof per square metre", value: HUMAN_REQUIREMENTS.targetSurfacePressurePa / g, unit: "kg/m2" },
        { label: "On Earth the same figure would be", value: HUMAN_REQUIREMENTS.targetSurfacePressurePa / 9.80665, unit: "kg/m2" },
        { label: "Total if taken to whole-body scale", value: roofMass, unit: "kg" },
      ],
      timescale: "incremental; useful from the first hectare",
      maturity: "speculative",
      source: "Taylor 1992, JBIS 45, 341; Fogg 1995, ch. 11 (paraterraforming)",
    },
  ];
}

function iceShellLadder(contract: BodyContract, state: CurrentState): Step[] {
  const R = contract.equatorialRadiusM;
  const dose = state.surfaceDoseSvPerYear ?? 0;
  const hoursToLethal = dose > 0 ? (4 / dose) * 365.25 * 24 : Infinity;
  // Ice at 920 kg/m^3; the same 100 g/cm^2 working figure as regolith, since what matters is
  // column density and water is a better shield per gram than rock, not worse.
  const iceDepthM = (100 * 10) / 920;

  return [
    {
      order: 1,
      title: "Understand that the surface is not survivable for any length of time",
      mechanism:
        "This body orbits inside a giant planet's radiation belts, and the flux there is not a background "
        + "to be managed but a beam. The quantity worth holding onto is the time to a half-lethal dose, "
        + "because it converts an abstract figure in sieverts into a decision about engineering. Where that "
        + "time is measured in minutes, a pressure suit is irrelevant, an airlock cycle is irrelevant, and "
        + "surface operations are robotic by physics rather than by preference.",
      quantities: [
        { label: "Surface dose", value: dose, unit: "Sv/yr" },
        { label: "Times Earth background", value: dose / HUMAN_REQUIREMENTS.earthBackgroundDoseSvPerYear, unit: "x" },
        {
          label: "Time to a 4 Sv half-lethal dose",
          value: hoursToLethal,
          unit: "hours",
        },
      ],
      timescale: "a constraint, permanent",
      maturity: "demonstrated",
      source: "Paranicas et al. 2009, in Europa (Univ. Arizona Press), ch. 20",
    },
    {
      order: 2,
      title: "Go under the ice, which is already the best shield available",
      mechanism:
        "The ice shell is the answer to the problem the ice shell's surface creates. Water is a better "
        + "radiation shield per gram than rock, because it is rich in hydrogen and hydrogen is what actually "
        + "stops the secondary neutrons that heavier shielding produces. A metre or so brings the dose down "
        + "to terrestrial, and the shell is kilometres thick. Everything below that depth is shielded for "
        + "free, permanently, with no structure and no maintenance.",
      quantities: [
        { label: "Shielding needed", value: 100, unit: "g/cm2" },
        { label: "Depth of water ice that is", value: iceDepthM, unit: "m" },
        { label: "Shell thickness", value: 15_000, unit: "m", note: "Europa, 15 to 25 km, seismically unconstrained" },
        { label: "Surface gravity", value: state.surfaceGravityMS2, unit: "m/s2" },
      ],
      timescale: "immediate",
      maturity: "engineering-extrapolation",
      source: "Billings & Kattenhorn 2005, Icarus 177, 397; Pappalardo et al. 1999, JGR 104, 24015",
    },
    {
      order: 3,
      title: "The ocean is the habitat, and it is larger than Earth's",
      mechanism:
        "Beneath the shell is liquid water kept liquid by tidal flexing rather than by sunlight, which is "
        + "why it exists five times further from the Sun than the habitable zone's outer edge. Europa's "
        + "ocean holds more liquid water than every ocean on Earth combined, in a body a quarter of Earth's "
        + "diameter, because it is global and roughly a hundred kilometres deep. It is in contact with a "
        + "silicate floor, so it has the mineral chemistry that hydrothermal systems run on. Habitability "
        + "here is not something to be engineered; it is something that may already be occupied, which is "
        + "also the strongest argument for not contaminating it.",
      quantities: [
        { label: "Estimated ocean depth", value: 100_000, unit: "m" },
        {
          label: "Ocean volume",
          value: (4 / 3) * Math.PI * (R ** 3 - (R - 100_000) ** 3),
          unit: "m3",
        },
        { label: "Every ocean on Earth", value: 1.335e18, unit: "m3" },
        {
          label: "Relative to Earth's oceans",
          value: ((4 / 3) * Math.PI * (R ** 3 - (R - 100_000) ** 3)) / 1.335e18,
          unit: "x",
        },
        { label: "Sunlight here", value: state.solarConstantWPerM2, unit: "W/m2" },
      ],
      timescale: "it is already there",
      maturity: "demonstrated",
      source: "Carr et al. 1998, Nature 391, 363; Khurana et al. 1998, Nature 395, 777 (induced field)",
    },
    {
      order: 4,
      title: "Run on tides, not on sunlight",
      mechanism:
        "At this distance sunlight is a few per cent of what reaches Earth, and solar power is not a "
        + "serious option. The energy that keeps the ocean liquid comes instead from orbital eccentricity "
        + "forced by the Laplace resonance with Io and Ganymede: the moon is flexed on every orbit and the "
        + "flexing dissipates as heat in the interior. That is a steady planetary-scale power source with "
        + "no fuel and no day-night cycle, and the same mechanism, concentrated, is what makes Io the most "
        + "volcanically active body in the solar system.",
      quantities: [
        { label: "Sunlight here", value: state.solarConstantWPerM2, unit: "W/m2" },
        { label: "Relative to Earth", value: state.solarConstantRelativeToEarth, unit: "x" },
        { label: "Estimated tidal dissipation", value: 1e12, unit: "W", note: "Europa; Io's is about 1e14" },
        { label: "Human civilisation's power draw", value: 2e13, unit: "W" },
      ],
      timescale: "continuous",
      maturity: "demonstrated",
      source: "Peale et al. 1979, Science 203, 892; Spencer et al. 2000, Science 288, 1198",
    },
  ];
}

function cryoLadder(contract: BodyContract, state: CurrentState): Step[] {
  const R = contract.equatorialRadiusM;
  const g = state.surfaceGravityMS2;
  const atmosphereMass = atmosphereMassFor(state.surfacePressurePa, R, g);
  const warming = HUMAN_REQUIREMENTS.targetSurfaceTemperatureK - state.measuredSurfaceTemperatureK;
  const heat = atmosphereMass * 1040 * warming;
  const intercepted = state.solarConstantWPerM2 * Math.PI * R * R;
  const oxygenMass = atmosphereMassFor(HUMAN_REQUIREMENTS.targetOxygenPartialPressurePa, R, g);

  return [
    {
      order: 1,
      title: "Start from the two things that are already solved",
      mechanism:
        "Almost everywhere else on this list, pressure and radiation are the hard problems, and here both "
        + "are already done. The surface pressure is higher than Earth's, which means a person outside "
        + "needs warmth and oxygen but not a pressure suit, and a tear in a garment is an inconvenience "
        + "rather than an emergency. The atmosphere is mostly nitrogen, the same inert buffer that Mars has "
        + "to import across the solar system. And the column density overhead, together with orbiting "
        + "inside Saturn's magnetosphere, makes the surface radiation environment mild. Nothing else beyond "
        + "Mars starts from here.",
      quantities: [
        { label: "Surface pressure", value: state.surfacePressurePa, unit: "Pa" },
        { label: "Relative to Earth", value: state.surfacePressurePa / 101_325, unit: "x" },
        { label: "Nitrogen fraction", value: contract.atmosphere?.composition.N2 ?? 0, unit: "mole fraction" },
        { label: "Shielding overhead", value: columnDensityGPerCm2(state.surfacePressurePa, g), unit: "g/cm2" },
        { label: "Surface dose", value: state.surfaceDoseSvPerYear ?? 0, unit: "Sv/yr" },
      ],
      timescale: "already true",
      maturity: "demonstrated",
      source: "Fulchignoni et al. 2005, Nature 438, 785 (Huygens HASI); Niemann et al. 2005, Nature 438, 779",
    },
    {
      order: 2,
      title: "The entire problem is heat, and the quantity is brutal",
      mechanism:
        "The surface sits far below the freezing point of water and the sunlight arriving is a hundredth "
        + "of Earth's, so there is no version of this that does not involve importing energy on a planetary "
        + "scale. Greenhouse forcing alone cannot bridge it: the gap is not tens of degrees but nearly two "
        + "hundred, and there is not enough sunlight here to trap. The honest framing is that this body "
        + "needs a second sun, in the form of mirrors or fusion, and the number below is what that means "
        + "even before any of it is lost.",
      quantities: [
        { label: "Surface temperature now", value: state.measuredSurfaceTemperatureK, unit: "K" },
        { label: "Warming required", value: warming, unit: "K" },
        { label: "Heat to warm the atmosphere alone", value: heat, unit: "J" },
        { label: "Sunlight the whole body intercepts", value: intercepted, unit: "W" },
        {
          label: "Years of all incident sunlight",
          value: heat / intercepted / SECONDS_PER_JULIAN_YEAR,
          unit: "years",
          note: "the atmosphere only; the crust is the same again many times over",
        },
      ],
      timescale: "millennia",
      maturity: "speculative",
      source: "Lorenz, Lunine & McKay 1997, GRL 24, 2905; Fogg 1995, ch. 12",
    },
    {
      order: 3,
      title: "Make oxygen from the water ice, which is the bedrock",
      mechanism:
        "The crust here is water ice, hard as granite at this temperature, and it is the oxygen supply. "
        + "Electrolysis gives oxygen and hydrogen in the usual ratio, and the energy cost is the same "
        + "thermodynamic floor as everywhere else. What makes this body unusual is the other half of the "
        + "equation: the hydrocarbons are already lying on the ground, in lakes.",
      quantities: [
        { label: "Oxygen for a sea-level partial pressure", value: oxygenMass, unit: "kg" },
        { label: "Water ice to supply it", value: oxygenMass * (18.015 / 31.998), unit: "kg" },
        { label: "Energy to electrolyse it", value: (oxygenMass / 0.031998) * 2 * 237_100, unit: "J" },
      ],
      timescale: "concurrent with warming",
      maturity: "engineering-extrapolation",
      source: "Lunine 2010, Faraday Discussions 147, 405",
    },
    {
      order: 4,
      title: "Remember that the whole surface becomes fuel the moment you add oxygen",
      mechanism:
        "Everywhere else, the hard part is finding energy. Here the hard part is that the ground is already "
        + "an energy source and the only reason it has not burned is that there is no oxidiser. Methane "
        + "lakes, ethane rain and solid organic dunes are chemically a fuel depot the size of a continent. "
        + "Introduce a breathable oxygen partial pressure across that and the planet becomes flammable in a "
        + "way no terrestrial environment is. This is a genuine argument for sealed habitats here rather "
        + "than an open atmosphere, and it is the opposite of the usual reason.",
      quantities: [
        { label: "Methane mole fraction", value: contract.atmosphere?.composition.CH4 ?? 0, unit: "mole fraction" },
        { label: "Combustion energy of methane", value: 55.5e6, unit: "J/kg" },
        { label: "Oxygen that would be introduced", value: oxygenMass, unit: "kg" },
        {
          label: "Methane that could burn with it",
          value: oxygenMass * (16.043 / (2 * 31.998)),
          unit: "kg",
        },
      ],
      timescale: "a design constraint",
      maturity: "engineering-extrapolation",
      source: "Niemann et al. 2005, Nature 438, 779; Stofan et al. 2007, Nature 445, 61 (the lakes)",
    },
  ];
}

/**
 * The Sun gets an answer rather than an empty panel.
 *
 * Running the ordinary assessment on a star produces confident nonsense: it has no orbit of
 * its own, so the distance lookup falls back to one au and reports the Sun as receiving
 * Earth's sunlight. Rather than hide the control for one body, the question is reframed into
 * the one that actually applies to a star, which is how much of its output can be used.
 */
function starLadder(): Step[] {
  const output = SOLAR_LUMINOSITY_W;
  const earthShare = output / (4 * Math.PI * AU_IN_METRES ** 2) * Math.PI * 6.371e6 ** 2;
  return [
    {
      order: 1,
      title: "The surface is not a destination at any depth",
      mechanism:
        "The photosphere is 5,772 K, which is above the boiling point of every element, and it is not a "
        + "surface in any case but the depth at which the plasma stops being opaque. Below it the "
        + "temperature and pressure rise without limit to 15.7 million K at the core. There is nothing to "
        + "stand on, nothing that stays solid, and no shielding strategy, because the problem is not "
        + "radiation passing through a habitat but the habitat itself being plasma.",
      quantities: [
        { label: "Photosphere temperature", value: 5772, unit: "K" },
        { label: "Core temperature", value: 1.57e7, unit: "K" },
        { label: "Surface gravity", value: 274, unit: "m/s2", note: "28 g" },
        { label: "Escape velocity", value: 617_700, unit: "m/s" },
      ],
      timescale: "permanent",
      maturity: "demonstrated",
      source: "IAU 2015 Resolution B3 nominal solar values",
    },
    {
      order: 2,
      title: "The real question is how much of the output you can intercept",
      mechanism:
        "Everything else in this simulation runs on sunlight, and almost none of it is used. Earth "
        + "intercepts the fraction of the Sun's output that happens to fall on a disc 12,742 km across at "
        + "one astronomical unit, which is about two parts in ten billion. The rest crosses the solar "
        + "system and leaves. Every mirror, shade and terraforming energy budget on the other panels is "
        + "an argument about how to redirect a slightly larger slice of that, which is why the fraction "
        + "is the number worth seeing.",
      quantities: [
        { label: "Total output", value: output, unit: "W" },
        { label: "Intercepted by Earth", value: earthShare, unit: "W" },
        { label: "Fraction Earth intercepts", value: earthShare / output, unit: "" },
        { label: "Human civilisation's power draw", value: 2e13, unit: "W" },
        {
          label: "Fraction of Earth's share that is",
          value: 2e13 / earthShare,
          unit: "",
        },
      ],
      timescale: "available now",
      maturity: "demonstrated",
      source: "IAU 2015 Resolution B3; Field et al. 1998, Science 281, 237",
    },
    {
      order: 3,
      title: "Mass loss sets the clock on all of it",
      mechanism:
        "The Sun converts about 4.3 million tonnes of mass into energy every second, and it has around "
        + "five billion years left before it leaves the main sequence and expands past Earth's orbit. "
        + "That is the outer bound on every project on every other panel. It also puts the Martian "
        + "atmospheric loss rate in context: stripping a terraformed Mars takes an order of magnitude "
        + "longer than the Sun has left, which is why that particular objection does not bite.",
      quantities: [
        { label: "Mass converted to energy", value: 4.26e9, unit: "kg/s" },
        { label: "Remaining main-sequence lifetime", value: 5e9, unit: "years" },
        { label: "Hydrogen fused per second", value: 6.2e11, unit: "kg/s" },
      ],
      timescale: "five billion years",
      maturity: "demonstrated",
      source: "Bahcall, Pinsonneault & Basu 2001, ApJ 555, 990 (standard solar model)",
    },
  ];
}

function homeLadder(state: CurrentState): Step[] {
  return [
    {
      order: 1,
      title: "You are here",
      mechanism:
        "Every number on every other body's panel is measured against these. Earth is not habitable because "
        + "of its distance from the Sun, which only sets the 254 K it would sit at with no atmosphere. It is "
        + "habitable because of the 33 K of greenhouse warming on top of that, the 1033 grams per square "
        + "centimetre of air overhead stopping cosmic rays, the partial pressure of oxygen that a lung "
        + "evolved against, and an inert buffer making up the other four fifths so that the oxygen does not "
        + "turn every fire into an explosion. Each of those is a separate accident, and each one is a "
        + "separate line item on every terraforming ladder in this simulation.",
      quantities: [
        { label: "Sunlight alone would give", value: state.equilibriumTemperatureK, unit: "K" },
        { label: "Greenhouse warming adds", value: state.greenhouseRiseK, unit: "K" },
        { label: "Surface temperature", value: state.measuredSurfaceTemperatureK, unit: "K" },
        { label: "Atmospheric shielding", value: columnDensityGPerCm2(101_325, 9.80665), unit: "g/cm2" },
        { label: "Oxygen partial pressure", value: HUMAN_REQUIREMENTS.targetOxygenPartialPressurePa, unit: "Pa" },
        { label: "Natural background dose", value: HUMAN_REQUIREMENTS.earthBackgroundDoseSvPerYear, unit: "Sv/yr" },
      ],
      timescale: "4.5 billion years so far",
      maturity: "demonstrated",
      source: "the only worked example",
    },
  ];
}

// MARK: entry point

function headlineFor(contract: BodyContract, strategy: Strategy, state: CurrentState): string {
  switch (strategy) {
    case "star":
      return (
        "A star is not a place with a hostile environment. It is the energy source every other "
        + "entry on this list is spending, and the one object here whose habitability question "
        + "has a different shape: not how to survive it, but how much of it you can capture."
      );
    case "home":
      return "The reference case, and the only worked example.";
    case "greenhouse-terraform":
      return (
        `Inside the habitable zone at ${state.heliocentricDistanceAu.toFixed(2)} au, so the sunlight is `
        + `workable. The problem is that there is almost no atmosphere and not enough volatiles on the `
        + `planet to make one. The gas has to come from somewhere else.`
      );
    case "shade-and-condense":
      return (
        `Absorbs less sunlight than Earth and is still ${state.measuredSurfaceTemperatureK.toFixed(0)} K, `
        + `because ${state.greenhouseRiseK.toFixed(0)} K of that is greenhouse. Block the sunlight, let the `
        + `atmosphere condense onto the ground, and what is left standing is breathable-adjacent nitrogen.`
      );
    case "aerostat":
      return (
        "No surface exists at any depth, so nothing can be built on it. The only habitable structure is "
        + "one that floats at the level where the pressure happens to be one bar."
      );
    case "pressurised-habitat":
      return (
        "Too small or too hot to hold an atmosphere for geological time, so an open-air surface is not "
        + "reachable. The body is a source of material and a place to put sealed volumes."
      );
    case "ice-shell-subsurface":
      return (
        `The surface is swept by ${(state.surfaceDoseSvPerYear ?? 0).toExponential(1)} Sv a year and is not `
        + `survivable for an afternoon. Everything habitable here is under the ice, which is also the best `
        + `radiation shield available anywhere.`
      );
    case "cryo-paraterraform":
      return (
        "Already has the two hardest things: more than a bar of nitrogen, and enough column density to "
        + "stop cosmic rays. It needs roughly 200 K of warming, and there is no sunlight here to trap."
      );
  }
}

function ladderFor(
  strategy: Strategy,
  contract: BodyContract,
  state: CurrentState,
  env: EnvironmentMeasurements,
): Step[] {
  switch (strategy) {
    case "star":
      return starLadder();
    case "home":
      return homeLadder(state);
    case "greenhouse-terraform":
      return greenhouseTerraformLadder(contract, state, env);
    case "shade-and-condense":
      return shadeAndCondenseLadder(contract, state, env);
    case "aerostat":
      return aerostatLadder(contract, state, env);
    case "pressurised-habitat":
      return pressurisedHabitatLadder(contract, state, env);
    case "ice-shell-subsurface":
      return iceShellLadder(contract, state);
    case "cryo-paraterraform":
      return cryoLadder(contract, state);
  }
}

/**
 * The whole assessment for one body.
 *
 * Deterministic and pure: the same body gives the same answer every time, with no epoch and no
 * state, which is what lets the conformance suite check the iOS port against it case by case.
 */
export function assessHabitability(id: BodyId): Assessment {
  const contract = contractFor(id);
  const { environment, substitutions } = environmentFor(id);
  const state = currentState(contract, environment);
  const retention = retentionFor(contract, environment);
  const strategy = chooseStrategy(id, state, environment);

  const caveats = contract.kind === "star" ? [] : [...substitutions];
  if (environment.hasInternalHeat) {
    caveats.push(
      "This body emits more heat than it absorbs from the Sun, because it is still contracting. "
      + `The ${state.equilibriumTemperatureK.toFixed(0)} K here is what sunlight alone would give; `
      + "published equilibrium temperatures for the giants are higher because they fold that "
      + "internal flux in, and Jupiter's is 1.67 times its absorbed sunlight.",
    );
  }
  if (environment.exobaseSource.startsWith("substituted")) {
    caveats.push("Exobase temperature is substituted, so the escape figures are indicative only.");
  }
  if (strategy !== "home") {
    caveats.push(
      "Every step past the first is an extrapolation from physics that is itself well established. "
      + "The physics is not in doubt; the engineering has never been attempted at any scale.",
    );
  }

  return {
    body: id,
    displayName: contract.displayName,
    strategy,
    headline: headlineFor(contract, strategy, state),
    state,
    retention,
    barriers: barriersFor(contract, state, environment, retention),
    ladder: ladderFor(strategy, contract, state, environment),
    caveats,
  };
}

/**
 * One formatter, shared, because the panels must not disagree about what a number says.
 *
 * Quantities here span from 0.17 to 1e25 and the right presentation changes across that range.
 * Leaving each client to decide produced "4.8e+20 kg" on one and "480000000000000000000 kg" on
 * another for the same field, which reads as two different measurements. The rule is: anything
 * a person can hold in their head gets digits, anything else gets an exponent, and the
 * crossover is fixed rather than per-call.
 */
export function formatQuantity(q: Quantity): string {
  const v = q.value;
  if (!Number.isFinite(v)) return "unbounded";
  const magnitude = Math.abs(v);
  let text: string;
  if (magnitude === 0) text = "0";
  else if (magnitude >= 1e6 || magnitude < 1e-3) {
    const exponent = Math.floor(Math.log10(magnitude));
    const mantissa = v / 10 ** exponent;
    text = `${mantissa.toFixed(2)}e${exponent}`;
  } else if (magnitude >= 100) text = v.toFixed(0);
  else if (magnitude >= 1) text = v.toFixed(2);
  /**
   * Three significant figures below one, not three decimal places.
   *
   * Earth's radiation card read "0.002 Sv/yr" directly under prose saying "2.40e-3 Sv per
   * year": the same number, rounded to one significant figure in one place and three in the
   * other, which reads as two measurements rather than one.
   */
  else text = Number(v.toPrecision(3)).toString();
  return q.unit ? `${text} ${q.unit}` : text;
}
