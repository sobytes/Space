/**
 * Validated reference data for the launch and ascent model, with provenance on every figure.
 *
 * This file exists because the launch-performance literature is not self-consistent, and a
 * simulator built from half-remembered numbers will be confidently wrong. Research traced each
 * figure to a primary source and found seventeen direct conflicts between official documents.
 * The notable ones are recorded here rather than silently resolved.
 *
 * Provenance tags used throughout:
 *   VENDOR     published by the manufacturer
 *   GOVERNMENT published by NASA, ESA or equivalent
 *   DERIVED    computed here from tagged inputs, with the computation stated
 *   UNSOURCED  widely repeated, traced to no primary source. Never used as a gate.
 */

/** WGS-84 equatorial radius, metres. */
export const EARTH_EQUATORIAL_RADIUS_M = 6_378_137;
/** IERS Earth rotation rate, rad/s. Reproduces the 86164.1 s sidereal day. */
export const EARTH_ROTATION_RATE_RAD_S = 7.292_115e-5;
/** Geocentric gravitational constant, m^3/s^2. */
export const EARTH_GM = 3.986_004_418e14;
/** Standard gravity used in the rocket equation, m/s^2. */
export const STANDARD_GRAVITY = 9.806_65;

/**
 * Equatorial surface speed from Earth's rotation, m/s. DERIVED from the two constants above.
 *
 * Three different values circulate. 463.8 m/s appears in a Utah State lecture and implies an
 * 86400 s solar day rather than a sidereal one. 483.8 m/s appears in a Stanford lecture and
 * corresponds to a radius of 6635 km, which is not Earth's; it is most likely a typo for 463.8.
 * The derived value below is the one that reproduces the sidereal day, so it is the one used.
 */
export const EARTH_EQUATORIAL_SPEED_M_S =
  EARTH_ROTATION_RATE_RAD_S * EARTH_EQUATORIAL_RADIUS_M;

export interface LaunchSite {
  readonly id: string;
  readonly name: string;
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  readonly minAzimuthDeg: number;
  readonly maxAzimuthDeg: number;
  readonly source: string;
}

export const LAUNCH_SITES: readonly LaunchSite[] = [
  {
    id: "ksc-lc39a",
    name: "Kennedy Space Center LC-39A",
    latitudeDeg: 28.5,
    longitudeDeg: -80.6,
    // Apollo 8's designed azimuth range, which is also the classic range-safety corridor.
    minAzimuthDeg: 72,
    maxAzimuthDeg: 108,
    source: "GOVERNMENT, MSFC-MAN-503 section X p.10-1",
  },
  {
    id: "vandenberg-slc4e",
    name: "Vandenberg SLC-4E",
    latitudeDeg: 34.7,
    longitudeDeg: -120.6,
    minAzimuthDeg: 158,
    maxAzimuthDeg: 281,
    source: "GOVERNMENT, published range-safety corridor",
  },
  {
    id: "kourou-ela4",
    name: "Guiana Space Centre ELA-4",
    latitudeDeg: 5.2,
    longitudeDeg: -52.8,
    minAzimuthDeg: -10.5,
    maxAzimuthDeg: 93.5,
    source: "VENDOR, Ariane 6 user manual",
  },
  {
    id: "mahia-lc1",
    name: "Rocket Lab LC-1, Mahia",
    latitudeDeg: -39.26,
    longitudeDeg: 177.86,
    minAzimuthDeg: 0,
    maxAzimuthDeg: 180,
    source: "VENDOR, Electron payload user guide v8.0, inclination range 39 to 120 degrees",
  },
  {
    id: "starbase",
    name: "Starbase, Boca Chica",
    latitudeDeg: 25.997,
    longitudeDeg: -97.155,
    minAzimuthDeg: 85,
    maxAzimuthDeg: 120,
    source: "GOVERNMENT, FAA licence corridor",
  },
];

/**
 * Loss terms for a launch to low Earth orbit, m/s.
 *
 * The commonly repeated "gravity loss is 1000 to 1500 m/s" could not be traced to any primary
 * source and is refuted by closing the Atlas V 401 budget from ULA's own published masses,
 * which requires 2.0 to 3.0 km/s of total losses. The only properly sourced figure is 2.2 km/s
 * for a 400 km polar ascent, from Karabeyoglu's Stanford AA284a lecture 7.
 */
export const ASCENT_LOSSES = {
  gravityLossMS: { value: 2_200, source: "Karabeyoglu, Stanford AA284a Lecture 7 slide 13", tag: "PEER-REVIEWED" },
  dragLossMS: { value: 100, low: 50, high: 150, source: "Leishman, ERAU Introduction to Aerospace Flight Vehicles", tag: "PEER-REVIEWED" },
  steeringLossMS: {
    value: null,
    source: "No primary source publishes a magnitude. Modelled as the cos(gimbal) factor on each stage instead.",
    tag: "UNSOURCED",
  },
} as const;

export interface AscentFixture {
  readonly vehicle: string;
  readonly payloadKg: number;
  readonly altitudeKm: number;
  readonly inclinationDeg: number;
  readonly site: string;
  readonly source: string;
  readonly tag: "VENDOR" | "GOVERNMENT";
}

/**
 * The gate's fixtures. Atlas V is the primary one because ULA is the only manufacturer that
 * publishes stage inert masses, stage propellant masses, engine thrust, engine specific impulse
 * AND a payload against a fully defined reference orbit. Every other vehicle requires a guess
 * somewhere in the chain, so a gate built on it would test the guess rather than the physics.
 *
 * SpaceX has withdrawn published performance entirely; the 2025 Falcon user guide says
 * capabilities are "available upon request". Its archived 22,800 kg to LEO carries no
 * reference orbit at all, so it cannot be a gate.
 */
export const ASCENT_FIXTURES: readonly AscentFixture[] = [
  {
    vehicle: "Atlas V 401",
    payloadKg: 9_797,
    altitudeKm: 200,
    inclinationDeg: 28.5,
    site: "ksc-lc39a",
    source: "ULA Atlas V Launch Services User's Guide Rev 11, Table 2.6.5-1a p.2-75",
    tag: "VENDOR",
  },
  {
    vehicle: "Atlas V 401 polar",
    payloadKg: 8_080,
    altitudeKm: 200,
    inclinationDeg: 90,
    site: "vandenberg-slc4e",
    source: "ULA Rocket Rundown, LEO-POLAR column",
    tag: "VENDOR",
  },
];

/**
 * Exact closed-form values the model must reproduce to a tenth of a percent. These are where
 * the real regression value lives: unlike a payload figure, they have no modelling ambiguity,
 * so a failure here is unambiguously a bug.
 */
export const EXACT_CHECKS = {
  circularSpeed200kmMS: { value: 7_784.3, source: "Utah State MAE 5540 RS102 slide 30, exact agreement" },
  circularSpeed400kmMS: { value: 7_668.6, source: "Karabeyoglu slide 13, quoted as 7.67 km/s" },
  equatorialRotationSpeedMS: { value: 465.10, source: "DERIVED from WGS-84 radius and IERS rotation rate" },
  rotationBonusKscEastMS: { value: 408.7, source: "Cross-checks against ERAU 0.41 km/s and USU 0.4076 km/s" },
  /**
   * Apollo 8 flew 32.509 degrees inclination and was designed for an azimuth range of 72 to
   * 108 degrees. Research reported "azimuth 72 gives inclination 32.26", which does not
   * survive the arithmetic: cos(28.5) * sin(72) = 0.83578, so azimuth 72 gives 33.300
   * degrees. The check that actually holds is the inverse one. The flown inclination implies
   * an azimuth of 73.66 degrees, which sits inside the designed range, and that validates
   * cos(i) = cos(latitude) * sin(azimuth) against a real flight.
   */
  apollo8InclinationDeg: {
    value: 32.509,
    impliedAzimuthDeg: 73.66,
    designedAzimuthRangeDeg: [72, 108],
    source: "GOVERNMENT, FER AS-503 Table 4-6; MSFC-MAN-503 section X p.10-1",
  },
} as const;

/**
 * Payload mass is an amplified function of delta-v error. Research measured the amplification
 * by solving for the payload that closes the staged rocket equation and perturbing the target.
 *
 * This matters for gate design. A plus or minus 5% payload gate demands plus or minus 160 m/s
 * of delta-v fidelity, which is roughly six times better than the published loss terms
 * themselves are known to. Gating that tightly would fail on the literature's own spread rather
 * than on anything wrong with the model.
 */
export const PAYLOAD_SENSITIVITY = {
  mediumAndHeavyAmplification: 3.0,
  smallLauncherAmplification: 5.0,
  recommendedPayloadToleranceMediumHeavy: 0.10,
  recommendedPayloadToleranceSmall: 0.15,
  recommendedDeltaVToleranceMS: 310,
} as const;

/**
 * US Standard Atmosphere 1976 constants.
 *
 * Table 2 of the official document contains four printed typos, confirmed by NASA's own errata
 * sheet appended to the PDF. Anyone coding from that page gets a wrong atmosphere and no
 * indication why. The corrected values are below, and the typo is recorded next to each.
 */
export const USSA76 = {
  /** Printed as 8.31432e-3 in Table 2. Off by 1e6. The page 3 text is correct. */
  universalGasConstant: 8_314.32,
  /** Printed as 6.356766e6 km in Table 2. Off by 1000. */
  earthRadiusKm: 6_356.766,
  /** Printed as 110 K in Table 2 and in the page 4 text. Correct value is 110.4. */
  sutherlandConstantK: 110.4,
  /** Printed as 3.65e-1 m in Table 2. Off by 1e9. */
  collisionDiameterM: 3.65e-10,
  seaLevelPressurePa: 101_325,
  seaLevelTemperatureK: 288.15,
  seaLevelDensityKgM3: 1.2250,
  meanMolarMassKgKmol: 28.9644,
  validToGeometricKm: 86,
  source: "NASA-TM-X-74335, NTRS 19770009539, with the errata sheet appended to that PDF",
} as const;

/** Defined reference levels of the linearly segmented temperature profile, Table 4 p.3. */
export const USSA76_LAYERS: readonly {
  readonly baseGeopotentialKm: number;
  readonly lapseRateKPerKm: number;
  readonly baseTemperatureK: number;
}[] = [
  { baseGeopotentialKm: 0, lapseRateKPerKm: -6.5, baseTemperatureK: 288.15 },
  { baseGeopotentialKm: 11, lapseRateKPerKm: 0.0, baseTemperatureK: 216.65 },
  { baseGeopotentialKm: 20, lapseRateKPerKm: 1.0, baseTemperatureK: 216.65 },
  { baseGeopotentialKm: 32, lapseRateKPerKm: 2.8, baseTemperatureK: 228.65 },
  { baseGeopotentialKm: 47, lapseRateKPerKm: 0.0, baseTemperatureK: 270.65 },
  { baseGeopotentialKm: 51, lapseRateKPerKm: -2.8, baseTemperatureK: 270.65 },
  { baseGeopotentialKm: 71, lapseRateKPerKm: -2.0, baseTemperatureK: 214.65 },
  { baseGeopotentialKm: 84.852, lapseRateKPerKm: 0.0, baseTemperatureK: 186.946 },
];

/**
 * Measured axial force coefficient for the Apollo/Saturn V launch vehicle, forebody only,
 * from NASA TM X-53770 Figure 28, read from the rendered page at 300 dpi.
 *
 * Forebody rather than total, deliberately. The total includes wind-tunnel base drag measured
 * with no engine plume; in powered flight the plume pressurises the base and the real
 * contribution is far smaller. Using the total roughly doubles the drag loss through max-Q.
 *
 * The widely used generic formula, Cd = 0.11 + 0.82/M^2 - 0.55/M^4 above Mach 0.85, under-predicts
 * this measured curve by 59% at the transonic peak. Treat the formula as a lower bound and this
 * curve as an upper bound. The whole spread is worth about 60 m/s of delta-v, well inside the
 * 310 m/s tolerance, so drag is not where this model's accuracy is decided.
 */
export const SATURN_V_FOREBODY_CD: readonly (readonly [mach: number, cd: number])[] = [
  [0.5, 0.19], [0.7, 0.24], [0.8, 0.27], [0.9, 0.38], [1.0, 0.52],
  [1.1, 0.64], [1.2, 0.66], [1.3, 0.64], [1.5, 0.60], [2.0, 0.54],
  [2.5, 0.47], [3.0, 0.40], [4.0, 0.32], [5.0, 0.27], [6.0, 0.23],
  [7.0, 0.21], [7.8, 0.16],
];

/** Reference area convention: body cross-section, pi*d^2/4, matching NASA TM X-53770. */
export const SATURN_V_REFERENCE_DIAMETER_M = 10.06;
