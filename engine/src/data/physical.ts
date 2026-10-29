/**
 * Physical parameters for the planetary systems.
 *
 * GM values are system-level (planet plus its moons), taken from
 * https://ssd.jpl.nasa.gov/astro_par.html in km^3/s^2 and converted to m^3/s^2 here.
 * System-level is the correct choice because the Standish element tables in `planets.ts`
 * describe planetary BARYCENTRES, not the planets themselves.
 *
 * Radii and obliquity come from https://ssd.jpl.nasa.gov/planets/phys_par.html and
 * https://nssdc.gsfc.nasa.gov/planetary/factsheet/. Where those two disagree the JPL page
 * wins, because it is tied to the actively maintained DE440 ephemeris while the fact sheet
 * is a hand-maintained snapshot.
 */

import type { PlanetId } from "./planets";

export interface PhysicalParameters {
  readonly displayName: string;
  /** System gravitational parameter, m^3 s^-2. */
  readonly gm: number;
  readonly equatorialRadiusM: number;
  readonly meanRadiusM: number;
  /** Negative means retrograde rotation. Sidereal, in days. */
  readonly siderealRotationDays: number;
  readonly obliquityToOrbitDeg: number;
  readonly geometricAlbedo: number;
  readonly meanTemperatureK: number;
}

const KM3_TO_M3 = 1e9;

export const PHYSICAL: Readonly<Record<PlanetId, PhysicalParameters>> = {
  mercury: {
    displayName: "Mercury",
    gm: 22_031.87 * KM3_TO_M3,
    equatorialRadiusM: 2_440_530,
    meanRadiusM: 2_439_400,
    siderealRotationDays: 58.6462,
    obliquityToOrbitDeg: 0.034,
    geometricAlbedo: 0.106,
    meanTemperatureK: 440,
  },
  venus: {
    displayName: "Venus",
    gm: 324_858.59 * KM3_TO_M3,
    equatorialRadiusM: 6_051_800,
    meanRadiusM: 6_051_800,
    siderealRotationDays: -243.018,
    obliquityToOrbitDeg: 177.4,
    geometricAlbedo: 0.65,
    meanTemperatureK: 737,
  },
  embary: {
    // Earth plus Moon, because the matching element set is the Earth-Moon barycentre.
    displayName: "Earth",
    gm: (398_600.44 + 4_902.8) * KM3_TO_M3,
    equatorialRadiusM: 6_378_140,
    meanRadiusM: 6_371_010,
    siderealRotationDays: 0.997270,
    obliquityToOrbitDeg: 23.44,
    geometricAlbedo: 0.367,
    meanTemperatureK: 288,
  },
  mars: {
    displayName: "Mars",
    gm: 42_828.38 * KM3_TO_M3,
    equatorialRadiusM: 3_396_190,
    meanRadiusM: 3_389_500,
    siderealRotationDays: 1.025957,
    obliquityToOrbitDeg: 25.19,
    geometricAlbedo: 0.150,
    meanTemperatureK: 208,
  },
  jupiter: {
    displayName: "Jupiter",
    gm: 126_712_764.1 * KM3_TO_M3,
    equatorialRadiusM: 71_492_000,
    meanRadiusM: 69_911_000,
    siderealRotationDays: 0.413540,
    obliquityToOrbitDeg: 3.13,
    geometricAlbedo: 0.52,
    meanTemperatureK: 163,
  },
  saturn: {
    displayName: "Saturn",
    gm: 37_940_584.84 * KM3_TO_M3,
    equatorialRadiusM: 60_268_000,
    meanRadiusM: 58_232_000,
    siderealRotationDays: 0.444010,
    obliquityToOrbitDeg: 26.73,
    geometricAlbedo: 0.47,
    meanTemperatureK: 133,
  },
  uranus: {
    displayName: "Uranus",
    gm: 5_794_556.40 * KM3_TO_M3,
    equatorialRadiusM: 25_559_000,
    meanRadiusM: 25_362_000,
    siderealRotationDays: -0.718330,
    obliquityToOrbitDeg: 97.77,
    geometricAlbedo: 0.51,
    meanTemperatureK: 78,
  },
  neptune: {
    displayName: "Neptune",
    gm: 6_836_527.10 * KM3_TO_M3,
    equatorialRadiusM: 24_764_000,
    meanRadiusM: 24_622_000,
    siderealRotationDays: 0.671250,
    obliquityToOrbitDeg: 28.32,
    geometricAlbedo: 0.41,
    meanTemperatureK: 73,
  },
};
