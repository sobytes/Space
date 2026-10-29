/**
 * Launch vehicle data, with provenance on every figure.
 *
 * Atlas V is here and Falcon 9 is not, and that is deliberate. ULA is the only manufacturer
 * that publishes stage inert masses, stage propellant masses, engine thrust, engine specific
 * impulse AND a payload against a fully defined reference orbit. Every other vehicle requires
 * a guess somewhere in that chain, so a gate built on one would test the guess rather than the
 * physics. SpaceX has withdrawn published performance entirely; its 2025 user guide says
 * capabilities are available on request, and its archived 22,800 kg to LEO carries no reference
 * orbit at all.
 *
 * Masses from the ULA Atlas V Launch Services User's Guide Rev 11, March 2010, figures 1.4.1-3
 * and 1.4.1-4. Engine figures from the same guide and from NPO Energomash for the RD-180.
 */

export interface Engine {
  readonly name: string;
  readonly thrustSeaLevelN: number;
  readonly thrustVacuumN: number;
  readonly ispSeaLevelS: number;
  readonly ispVacuumS: number;
  readonly source: string;
}

export interface Stage {
  readonly name: string;
  readonly inertMassKg: number;
  readonly propellantMassKg: number;
  readonly engine: Engine;
  readonly engineCount: number;
  /** Fraction of the burn spent near vacuum, used to weight the effective specific impulse. */
  readonly vacuumFraction: number;
}

export interface SolidBooster {
  readonly name: string;
  readonly grossMassKg: number;
  readonly thrustVacuumN: number;
  readonly ispVacuumS: number;
  readonly burnTimeS: number;
  readonly source: string;
}

export interface Vehicle {
  readonly id: string;
  readonly name: string;
  readonly stages: readonly Stage[];
  readonly solidBoosters: { readonly booster: SolidBooster; readonly count: number } | null;
  readonly fairingMassKg: number;
  /** Jettisoned early in the second-stage burn, so it is not carried the whole way. */
  readonly fairingJettisoned: boolean;
  readonly source: string;
}

/**
 * The RD-180's published pair is the only engine data in this project that passes an internal
 * consistency check. Mass flow is altitude-invariant, so thrust over specific impulse must be
 * the same at sea level and in vacuum: 3826.6 kN / 311.9 s gives 1251.0 kg/s and
 * 4152.1 kN / 338.4 s gives 1251.2 kg/s. Agreement to 0.02%. Most vendors publish only one
 * pair, so that check cannot even be run on them.
 */
export const RD_180: Engine = {
  name: "RD-180",
  thrustSeaLevelN: 3_826_600,
  thrustVacuumN: 4_152_100,
  ispSeaLevelS: 311.9,
  ispVacuumS: 338.4,
  source: "NPO Energomash published specification; matches ULA's HLV page exactly",
};

export const RL10A_4_2: Engine = {
  name: "RL10A-4-2",
  // An upper-stage engine never sees sea level, so the pair is the vacuum figure twice rather
  // than an invented sea-level value.
  thrustSeaLevelN: 99_200,
  thrustVacuumN: 99_200,
  ispSeaLevelS: 450.5,
  ispVacuumS: 450.5,
  source: "ULA Atlas V Launch Services User's Guide Rev 11",
};

export const AJ_60A: SolidBooster = {
  name: "AJ-60A",
  grossMassKg: 46_697,
  thrustVacuumN: 1_688_400,
  ispVacuumS: 279.3,
  burnTimeS: 88.3,
  source: "ULA Atlas V Launch Services User's Guide Rev 11, including attach kit and nose fairing",
};

const COMMON_CORE: Stage = {
  name: "Common Core Booster",
  inertMassKg: 21_054,
  propellantMassKg: 284_089,
  engine: RD_180,
  engineCount: 1,
  // The RD-180 burns for about four minutes and spends most of it high up, which is why ULA
  // publishes a 311.9 to 338.4 s range rather than one number.
  vacuumFraction: 0.7,
};

const CENTAUR_SEC: Stage = {
  name: "Centaur, single engine",
  inertMassKg: 2_243,
  propellantMassKg: 20_830,
  engine: RL10A_4_2,
  engineCount: 1,
  vacuumFraction: 1,
};

export const ATLAS_V_401: Vehicle = {
  id: "atlas-v-401",
  name: "Atlas V 401",
  stages: [COMMON_CORE, CENTAUR_SEC],
  solidBoosters: null,
  fairingMassKg: 2_305,
  fairingJettisoned: true,
  source: "ULA Atlas V Launch Services User's Guide Rev 11, Fig 1.4.1-3",
};

export const ATLAS_V_551: Vehicle = {
  id: "atlas-v-551",
  name: "Atlas V 551",
  stages: [{ ...COMMON_CORE, inertMassKg: 21_351 }, CENTAUR_SEC],
  solidBoosters: { booster: AJ_60A, count: 5 },
  fairingMassKg: 3_524,
  fairingJettisoned: true,
  source: "ULA Atlas V Launch Services User's Guide Rev 11, Fig 1.4.1-4",
};

/**
 * Only the 401 is modelled, and that is a finding rather than laziness.
 *
 * The AJ-60A's published figures do not survive an internal check. Thrust 1688.4 kN at a
 * specific impulse of 279.3 s implies a mass flow of 616.4 kg/s, and over the published 88.3 s
 * burn that is 54,431 kg of propellant inside a booster whose published gross mass is 46,697 kg.
 * 117% of the vehicle cannot be propellant.
 *
 * Something in that set means something other than what it appears to: an average versus peak
 * thrust, a nominal burn excluding tail-off, or a gross mass with an exclusion ULA does not
 * state. Without knowing which, any 551 model would be fitted rather than derived, and a fitted
 * model that then "predicts" the 551's published payload proves nothing. So the 551 stays in
 * the data for reference and out of the solver.
 */
export const VEHICLES: readonly Vehicle[] = [ATLAS_V_401];

export const UNMODELLED: readonly { readonly vehicle: Vehicle; readonly reason: string }[] = [
  {
    vehicle: ATLAS_V_551,
    reason:
      "The AJ-60A's published thrust, specific impulse, burn time and gross mass are mutually " +
      "inconsistent: they require 117% of the booster's mass to be propellant.",
  },
];

export function vehicleById(id: string): Vehicle | undefined {
  return VEHICLES.find((v) => v.id === id);
}

/**
 * Specific impulse weighted between sea level and vacuum.
 *
 * Not a fudge. Thrust rises with altitude because the term (p_e - p_a) A_e grows as ambient
 * pressure falls, and the same geometry raises specific impulse. Saturn V's first stage rose
 * from about 7.65 to 9.16 million pounds of thrust on the way up, a 20% change on one stage.
 * Treating the whole burn at sea-level specific impulse under-predicts delta-v by hundreds of
 * metres per second, which is most of the gap between the circulated 9,300 m/s figure for LEO
 * and the 9.7 to 10.2 km/s that closing a real vehicle's budget actually requires.
 */
export function effectiveIsp(stage: Stage): number {
  const { ispSeaLevelS, ispVacuumS } = stage.engine;
  return ispSeaLevelS + (ispVacuumS - ispSeaLevelS) * stage.vacuumFraction;
}
