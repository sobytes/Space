/**
 * Measured environmental parameters that the body contracts do not carry, because nothing
 * else in the simulation needed them.
 *
 * Everything here exists to answer one question: what would it take to put a person on this
 * body and keep them alive? That question needs the quantities a planetary scientist reaches
 * for and an orrery does not. How much sunlight the body actually absorbs rather than
 * reflects. How hot the top of its atmosphere is, which decides what gases it can hold on to.
 * How hard the radiation is at the surface. Whether it has a magnetic field. Whether it has a
 * surface at all.
 *
 * Each field carries its source, for the same reason the body contracts do: a terraforming
 * number is only interesting if it is traceable, and a number with no provenance is a guess
 * with a decimal point. Where a value is modelled rather than measured it says so, and the
 * assessment that consumes it reports a lower confidence.
 */

import type { BodyId } from "../bodies/contract";

export interface EnvironmentMeasurements {
  /**
   * Bond albedo: the fraction of all incident sunlight reflected in every direction.
   *
   * Not the geometric albedo the body contracts carry. Geometric albedo is the brightness at
   * zero phase angle relative to a flat disc, which is what a telescope measures and what an
   * energy balance must not use. Venus is the clearest case: geometric 0.65, Bond 0.77. Using
   * the geometric value puts its equilibrium temperature 14 K too high and quietly changes
   * every conclusion downstream of it.
   */
  readonly bondAlbedo: number;
  readonly bondAlbedoSource: string;

  /**
   * Exobase temperature, K: the temperature where the atmosphere becomes collisionless and a
   * fast molecule leaves instead of bumping into another one.
   *
   * This, not the surface temperature, sets thermal escape. Venus is the counter-intuitive
   * one: 737 K at the surface and about 275 K at the exobase, because CO2 radiates heat away
   * efficiently in the upper atmosphere. Earth's is far hotter than its surface, near 1000 K
   * at solar maximum, which is why Earth loses hydrogen and Venus does not lose nitrogen.
   */
  readonly exobaseTemperatureK: number;
  readonly exobaseSource: string;

  /**
   * Unshielded surface dose equivalent, sieverts per year.
   *
   * Dose equivalent rather than absorbed dose, because galactic cosmic rays are heavy ions
   * whose biological damage per unit energy is several times a gamma ray's, and the quality
   * factor is already folded into the published figures. Null where there is no surface.
   */
  readonly surfaceDoseSvPerYear: number | null;
  readonly doseSource: string;

  /** Normalised polar moment of inertia, C/MR^2. Decides the energy cost of changing spin. */
  readonly momentOfInertiaFactor: number;
  readonly momentSource: string;

  /** Intrinsic dipole field strength at the equatorial surface, tesla. Zero means none. */
  readonly surfaceMagneticFieldT: number;
  readonly magneticSource: string;

  /** Can you stand on it? False for the four giants, which have no surface at any depth. */
  readonly hasSolidSurface: boolean;

  /**
   * What the outermost solid layer is made of.
   *
   * Not cosmetic, and not derivable from bulk density, which is why it is stated rather than
   * computed. Io and Europa differ by 15 per cent in density and could not be more different
   * as places to shelter: Europa is a water-ice shell over a global ocean, so going down is
   * both the shielding and the destination, while Io is silicate and sulphur with no water at
   * all, so the same radiation problem has an entirely different answer. Routing those two to
   * the same advice on a density threshold was wrong in exactly that way.
   */
  readonly crust: "rock" | "ice-over-ocean" | "ice" | "none";

  /**
   * Does the body radiate significantly more than it absorbs from the Sun?
   *
   * True for the giants, which are still contracting and releasing gravitational energy:
   * Jupiter emits about 1.67 times what it absorbs. It makes the published equilibrium
   * temperature higher than the one sunlight alone implies, 110 K against 102 K, and without
   * this flag that gap reads as an error in the energy balance rather than as the real
   * physics it is.
   */
  readonly hasInternalHeat?: boolean;

  /**
   * Present-day atmospheric loss to space, kg/s, where a spacecraft has measured it.
   *
   * Only two bodies have this: Mars from MAVEN and Earth from a long record. It matters far
   * more than its obscurity suggests, because "Mars has no magnetic field so an atmosphere
   * would blow away" is the single most repeated objection to terraforming it, and the
   * measured rate says how long that actually takes. The arithmetic is in `habitability.ts`
   * rather than here, so the claim is derived rather than asserted.
   */
  readonly atmosphericLossKgPerS: number | null;
  readonly lossSource: string | null;

  /**
   * Gravitational parameter of the body alone, m^3 s^-2, where the contract's value is a
   * system total.
   *
   * Only Earth needs it. `BODY_CONTRACTS.embary.gm` is Earth plus Moon, because the Standish
   * element tables describe the Earth-Moon barycentre, and using it for surface gravity gives
   * 9.919 m/s^2. That reads as 1.012 g for Earth, which is wrong in the one place every
   * reader can check by instinct.
   */
  readonly gmBodyOnly?: number;

  /**
   * Altitude where the pressure is one bar, metres, and the temperature there.
   *
   * Measured rather than derived from the scale height. The barometric formula assumes an
   * isothermal atmosphere and is only good over about one scale height; run out to Venus's
   * cloud deck it puts the one-bar level at 72 km against a measured 49.5 km, a 45 per cent
   * error that would misplace the one genuinely comfortable spot in the inner solar system.
   * For the giants the one-bar level is the radius datum by definition, so the altitude is
   * zero and the temperature is the published one-bar value.
   */
  readonly oneBarLevel?: {
    readonly altitudeM: number;
    readonly temperatureK: number;
    readonly source: string;
  };
}

const MESSENGER = "Margot et al. 2012, JGR Planets 117, E00L09 (MESSENGER radar spin)";
const FACT_SHEET = "NASA NSSDC planetary fact sheets";
const MALLAMA = "Mallama & Hilton 2018, Astronomy and Computing 25, 10 (bolometric albedos)";
const RAD = "Hassler et al. 2014, Science 343, 1244797 (MSL/RAD, 0.21 mSv/day)";
const CRATER = "Schwadron et al. 2012, JGR Planets 117, E00H13 (LRO/CRaTER)";
const PARANICAS = "Paranicas et al. 2009, in Europa (Univ. Arizona Press), ch. 20";
const MAVEN = "Jakosky et al. 2018, Icarus 315, 146 (MAVEN integrated loss)";
const MODELLED = "modelled, not measured in situ";

/**
 * Only the bodies a reader would plausibly ask about.
 *
 * A partial record on purpose. Half of the moons in the registry have no published Bond
 * albedo and no radiation measurement at all, and inventing one so the table looks complete
 * would be the worst of both worlds: a number with the authority of a table and the content
 * of a guess. `habitability.ts` substitutes documented fallbacks for the missing ones and
 * marks the result as substituted, so the gap is visible instead of papered over.
 */
export const ENVIRONMENT: Partial<Record<BodyId, EnvironmentMeasurements>> = {
  mercury: {
    bondAlbedo: 0.088,
    bondAlbedoSource: MALLAMA,
    exobaseTemperatureK: 600,
    exobaseSource: "surface-bounded exosphere; dayside surface temperature, " + FACT_SHEET,
    surfaceDoseSvPerYear: 0.2,
    doseSource: MODELLED + "; unshielded GCR plus a solar-energetic-particle flux 6.7x Earth's",
    momentOfInertiaFactor: 0.346,
    momentSource: MESSENGER,
    surfaceMagneticFieldT: 3e-7,
    magneticSource: "Anderson et al. 2011, Science 333, 1859 (MESSENGER magnetometer)",
    crust: "rock",
    hasSolidSurface: true,
    atmosphericLossKgPerS: null,
    lossSource: null,
  },
  venus: {
    bondAlbedo: 0.77,
    bondAlbedoSource: FACT_SHEET,
    exobaseTemperatureK: 275,
    exobaseSource: "Fox & Sung 2001, JGR 106, 21305 (CO2 cooling keeps the exobase cold)",
    surfaceDoseSvPerYear: 0.0001,
    doseSource: MODELLED + "; 92 bar of CO2 is 1.1e6 g/cm2 of shielding, a thousand Earths",
    momentOfInertiaFactor: 0.337,
    momentSource: MODELLED + "; no spacecraft determination, assumed Earth-like differentiation",
    surfaceMagneticFieldT: 0,
    magneticSource: "Russell 1980, Rev. Geophys. 18, 77 (no intrinsic dipole detected)",
    crust: "rock",
    hasSolidSurface: true,
    atmosphericLossKgPerS: null,
    lossSource: null,
    oneBarLevel: {
      altitudeM: 49_500,
      temperatureK: 348,
      source: "Seiff et al. 1985, Adv. Space Res. 5, 3 (VIRA reference atmosphere)",
    },
  },
  embary: {
    bondAlbedo: 0.306,
    bondAlbedoSource: FACT_SHEET,
    exobaseTemperatureK: 1000,
    exobaseSource: "solar-maximum thermosphere, NRLMSISE-00",
    surfaceDoseSvPerYear: 0.0024,
    doseSource: "UNSCEAR 2008, global average natural background",
    momentOfInertiaFactor: 0.3307,
    momentSource: "Williams 1994, Astron. J. 108, 711",
    surfaceMagneticFieldT: 3.1e-5,
    magneticSource: "IGRF-13, equatorial surface field",
    crust: "rock",
    hasSolidSurface: true,
    atmosphericLossKgPerS: 3,
    lossSource: "polar wind plus Jeans hydrogen; Catling & Kasting 2017, ch. 5",
    gmBodyOnly: 3.986_004_418e14,
    oneBarLevel: { altitudeM: 0, temperatureK: 288, source: "US Standard Atmosphere 1976" },
  },
  mars: {
    bondAlbedo: 0.25,
    bondAlbedoSource: FACT_SHEET,
    exobaseTemperatureK: 200,
    exobaseSource: "Jakosky et al. 2015, Science 350, aad0210 (MAVEN NGIMS)",
    surfaceDoseSvPerYear: 0.0767,
    doseSource: RAD,
    momentOfInertiaFactor: 0.3644,
    momentSource: "Konopliv et al. 2011, Icarus 211, 401",
    surfaceMagneticFieldT: 0,
    magneticSource: "Acuna et al. 1999, Science 284, 790 (crustal remanence only, no dipole)",
    crust: "rock",
    hasSolidSurface: true,
    atmosphericLossKgPerS: 2.5,
    lossSource: MAVEN,
  },
  jupiter: {
    bondAlbedo: 0.503,
    bondAlbedoSource: FACT_SHEET,
    exobaseTemperatureK: 900,
    exobaseSource: "Seiff et al. 1998, JGR 103, 22857 (Galileo probe thermosphere)",
    surfaceDoseSvPerYear: null,
    doseSource: "no surface; the one-bar level sits inside the radiation belts",
    momentOfInertiaFactor: 0.2756,
    momentSource: "Helled et al. 2011, Icarus 216, 440",
    surfaceMagneticFieldT: 4.28e-4,
    magneticSource:
      "Connerney et al. 2018, Geophysical Research Letters 45, 2590 (Juno JRM09)",
    crust: "none",
    hasInternalHeat: true,
    hasSolidSurface: false,
    atmosphericLossKgPerS: null,
    lossSource: null,
    oneBarLevel: { altitudeM: 0, temperatureK: 165, source: FACT_SHEET },
  },
  saturn: {
    bondAlbedo: 0.342,
    bondAlbedoSource: FACT_SHEET,
    exobaseTemperatureK: 420,
    exobaseSource: "Koskinen et al. 2015, Icarus 260, 174 (Cassini UVIS)",
    surfaceDoseSvPerYear: null,
    doseSource: "no surface",
    momentOfInertiaFactor: 0.22,
    momentSource: "Helled 2011, ApJ 735, L16",
    surfaceMagneticFieldT: 2.1e-5,
    magneticSource: "Dougherty et al. 2018, Science 362, aat5434 (Cassini Grand Finale)",
    crust: "none",
    hasInternalHeat: true,
    hasSolidSurface: false,
    atmosphericLossKgPerS: null,
    lossSource: null,
    oneBarLevel: { altitudeM: 0, temperatureK: 134, source: FACT_SHEET },
  },
  uranus: {
    bondAlbedo: 0.3,
    bondAlbedoSource: FACT_SHEET,
    exobaseTemperatureK: 800,
    exobaseSource: "Herbert et al. 1987, JGR 92, 15093 (Voyager 2 UVS)",
    surfaceDoseSvPerYear: null,
    doseSource: "no surface",
    momentOfInertiaFactor: 0.23,
    momentSource: MODELLED + "; interior models, not measured",
    surfaceMagneticFieldT: 2.3e-5,
    magneticSource: "Ness et al. 1986, Science 233, 85 (Voyager 2)",
    crust: "none",
    hasInternalHeat: true,
    hasSolidSurface: false,
    atmosphericLossKgPerS: null,
    lossSource: null,
    oneBarLevel: { altitudeM: 0, temperatureK: 76, source: FACT_SHEET },
  },
  neptune: {
    bondAlbedo: 0.29,
    bondAlbedoSource: FACT_SHEET,
    exobaseTemperatureK: 750,
    exobaseSource: "Broadfoot et al. 1989, Science 246, 1459 (Voyager 2 UVS)",
    surfaceDoseSvPerYear: null,
    doseSource: "no surface",
    momentOfInertiaFactor: 0.23,
    momentSource: MODELLED + "; interior models, not measured",
    surfaceMagneticFieldT: 1.4e-5,
    magneticSource: "Ness et al. 1989, Science 246, 1473 (Voyager 2)",
    crust: "none",
    hasInternalHeat: true,
    hasSolidSurface: false,
    atmosphericLossKgPerS: null,
    lossSource: null,
    oneBarLevel: { altitudeM: 0, temperatureK: 72, source: FACT_SHEET },
  },
  moon: {
    bondAlbedo: 0.11,
    bondAlbedoSource: FACT_SHEET,
    exobaseTemperatureK: 400,
    exobaseSource: "surface-bounded exosphere; dayside surface temperature, " + FACT_SHEET,
    surfaceDoseSvPerYear: 0.15,
    doseSource: CRATER,
    momentOfInertiaFactor: 0.3929,
    momentSource: "Williams et al. 2014, JGR Planets 119, 1546 (GRAIL plus LLR)",
    surfaceMagneticFieldT: 0,
    magneticSource: "crustal anomalies only; no global dipole",
    crust: "rock",
    hasSolidSurface: true,
    atmosphericLossKgPerS: null,
    lossSource: null,
  },
  io: {
    bondAlbedo: 0.52,
    bondAlbedoSource: "Simonelli & Veverka 1984, Icarus 59, 406",
    exobaseTemperatureK: 200,
    exobaseSource: MODELLED + "; SO2 atmosphere, sublimation-supported",
    surfaceDoseSvPerYear: 13_140,
    doseSource: PARANICAS + "; 36 Sv/day, the harshest surface in the solar system",
    momentOfInertiaFactor: 0.3777,
    momentSource: "Anderson et al. 2001, JGR 106, 32963 (Galileo radio science)",
    surfaceMagneticFieldT: 0,
    magneticSource: "induced only; no intrinsic dipole",
    crust: "rock",
    hasSolidSurface: true,
    atmosphericLossKgPerS: 1000,
    lossSource: "Thomas et al. 2004, in Jupiter (CUP); ~1 tonne/s feeds the Io plasma torus",
  },
  europa: {
    bondAlbedo: 0.68,
    bondAlbedoSource: "Buratti & Veverka 1983, Icarus 55, 93",
    exobaseTemperatureK: 100,
    exobaseSource: MODELLED + "; tenuous radiolytic O2 exosphere",
    surfaceDoseSvPerYear: 1971,
    doseSource: PARANICAS + "; 5.4 Sv/day, lethal in minutes",
    momentOfInertiaFactor: 0.346,
    momentSource: "Anderson et al. 1998, Science 281, 2019 (Galileo)",
    surfaceMagneticFieldT: 0,
    magneticSource: "induced field from the subsurface ocean; no intrinsic dipole",
    crust: "ice-over-ocean",
    hasSolidSurface: true,
    atmosphericLossKgPerS: null,
    lossSource: null,
  },
  ganymede: {
    bondAlbedo: 0.43,
    bondAlbedoSource: "Buratti 1991, Icarus 92, 312",
    exobaseTemperatureK: 150,
    exobaseSource: MODELLED,
    surfaceDoseSvPerYear: 29,
    doseSource: PARANICAS + "; partly shielded by its own magnetosphere",
    momentOfInertiaFactor: 0.3115,
    momentSource: "Anderson et al. 1996, Nature 384, 541 (Galileo)",
    surfaceMagneticFieldT: 7.2e-7,
    magneticSource: "Kivelson et al. 1996, Nature 384, 537 (the only moon with a dipole)",
    crust: "ice-over-ocean",
    hasSolidSurface: true,
    atmosphericLossKgPerS: null,
    lossSource: null,
  },
  callisto: {
    bondAlbedo: 0.19,
    bondAlbedoSource: "Buratti 1991, Icarus 92, 312",
    exobaseTemperatureK: 150,
    exobaseSource: MODELLED,
    surfaceDoseSvPerYear: 0.0365,
    doseSource: PARANICAS + "; outside the worst of the belts, 0.0001 Sv/day",
    momentOfInertiaFactor: 0.3549,
    momentSource: "Anderson et al. 2001, Icarus 153, 157 (Galileo)",
    surfaceMagneticFieldT: 0,
    magneticSource: "induced only",
    crust: "ice-over-ocean",
    hasSolidSurface: true,
    atmosphericLossKgPerS: null,
    lossSource: null,
  },
  titan: {
    bondAlbedo: 0.265,
    bondAlbedoSource: "Neff et al. 1984, Icarus 60, 221",
    exobaseTemperatureK: 170,
    exobaseSource: "Yelle et al. 2008, JGR 113, E10003 (Cassini INMS)",
    surfaceDoseSvPerYear: 0.001,
    doseSource: MODELLED + "; 1.5 bar of N2 plus Saturn's magnetosphere",
    momentOfInertiaFactor: 0.3414,
    momentSource: "Iess et al. 2010, Science 327, 1367 (Cassini radio science)",
    surfaceMagneticFieldT: 0,
    magneticSource: "none; orbits inside Saturn's magnetosphere",
    crust: "ice",
    hasSolidSurface: true,
    atmosphericLossKgPerS: 0.05,
    lossSource: "Strobel 2009, Icarus 202, 632 (hydrodynamic CH4 and H2 escape)",
    oneBarLevel: {
      altitudeM: 7_000,
      temperatureK: 89,
      source: "Fulchignoni et al. 2005, Nature 438, 785 (Huygens HASI descent profile)",
    },
  },
  enceladus: {
    bondAlbedo: 0.81,
    bondAlbedoSource: "Howett et al. 2010, Icarus 206, 573 (the brightest body known)",
    exobaseTemperatureK: 75,
    exobaseSource: MODELLED,
    surfaceDoseSvPerYear: 0.1,
    doseSource: MODELLED + "; inside Saturn's E ring and magnetosphere",
    momentOfInertiaFactor: 0.335,
    momentSource: "Iess et al. 2014, Science 344, 78",
    surfaceMagneticFieldT: 0,
    magneticSource: "none",
    crust: "ice-over-ocean",
    hasSolidSurface: true,
    atmosphericLossKgPerS: null,
    lossSource: null,
  },
  triton: {
    bondAlbedo: 0.65,
    bondAlbedoSource: "Hillier et al. 1990, Science 250, 419 (Voyager 2)",
    exobaseTemperatureK: 95,
    exobaseSource: "Krasnopolsky et al. 1993, JGR 98, 3065",
    surfaceDoseSvPerYear: 0.05,
    doseSource: MODELLED + "; Neptune's magnetosphere is weak and Triton is far out in it",
    momentOfInertiaFactor: 0.33,
    momentSource: MODELLED,
    surfaceMagneticFieldT: 0,
    magneticSource: "none",
    crust: "ice",
    hasSolidSurface: true,
    atmosphericLossKgPerS: null,
    lossSource: null,
  },
};
