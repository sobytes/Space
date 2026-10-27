/**
 * A body contract is everything the app is allowed to assert about one celestial body, in one
 * place, with the source of each claim attached.
 *
 * The point is enforceability. Each contract declares where its position comes from, how it
 * spins, what it is made of and how it should be drawn, and `contract.test.ts` then checks the
 * contract against itself: that the rotation rate and the published sidereal period agree, that
 * a retrograde spin is retrograde in both places, that a body with rings has a ring texture,
 * that the parent chain resolves. A body cannot be added without satisfying its own physics.
 *
 * Where two authoritative sources genuinely disagree, the contract must say so explicitly via
 * `knownDiscrepancies`. The gate accepts a declared and cited disagreement and rejects an
 * undeclared one, so a conflict surfaces as documentation rather than vanishing into a
 * tolerance.
 */

import type { PlanetId } from "../data/planets";

export type BodyId =
  | "sun"
  | PlanetId
  | "moon"
  | "phobos"
  | "deimos"
  | "io"
  | "europa"
  | "ganymede"
  | "callisto"
  | "enceladus"
  | "titan"
  | "triton";

export type BodyKind = "star" | "planet" | "moon";

/** Where this body's position comes from. A union, so an unsourced body cannot be built. */
export type EphemerisSource =
  | { readonly kind: "fixed-at-barycentre"; readonly note: string }
  | { readonly kind: "standish-elements"; readonly planet: PlanetId }
  | {
      readonly kind: "mean-elements-about-parent";
      readonly semiMajorAxisM: number;
      readonly eccentricity: number;
      readonly inclinationDeg: number;
      readonly periodDays: number;
      readonly referencePlane: "parent-equator" | "laplace" | "ecliptic";
      readonly source: string;
    };

/**
 * IAU rotational elements. Right ascension and declination of the north pole with their rates
 * per Julian century, plus the prime meridian angle and its rate in degrees per day.
 *
 * W1 negative means retrograde rotation. For Jupiter, Saturn and Uranus the IAU value is the
 * System III magnetic-field rotation rather than a visible-surface rate, which is flagged per
 * body because it is a real and easily-missed distinction for a gas giant.
 */
export interface RotationalElements {
  readonly poleRaDeg: number;
  readonly poleRaRateDegPerCentury: number;
  readonly poleDecDeg: number;
  readonly poleDecRateDegPerCentury: number;
  readonly primeMeridianDeg: number;
  readonly rotationRateDegPerDay: number;
  readonly system?: "System III (magnetic)" | "surface";
  readonly source: string;
}

export interface RingSystem {
  readonly innerRadiusM: number;
  readonly outerRadiusM: number;
  readonly textureId: string;
  readonly opacity: number;
  readonly source: string;
}

export interface Atmosphere {
  readonly surfacePressurePa: number | null;
  readonly scaleHeightM: number;
  /** Mole fractions, summing to roughly one. The gate checks that. */
  readonly composition: Readonly<Record<string, number>>;
  readonly source: string;
}

export interface Appearance {
  /**
   * Texture id as it appears in scripts/assets.manifest.json, when one exists.
   *
   * Optional, because for most moons it does not. The only freely licensed imagery is USGS
   * GeoTIFFs running to hundreds of megabytes each, and inventing a surface would be worse
   * than having none. A body without a texture renders at its measured geometric albedo in
   * its measured colour, which is a real property rather than a guess.
   */
  readonly albedoTextureId?: string;
  readonly nightTextureId?: string;
  readonly cloudTextureId?: string;
  readonly normalTextureId?: string;
  readonly ringSystem?: RingSystem;
  /** Fallback colour used before the texture loads, and for the orbit line. */
  readonly tint: string;
  readonly emissive: boolean;
}

export interface KnownDiscrepancy {
  readonly field: string;
  readonly summary: string;
  readonly preferred: string;
  readonly rejected: string;
}

export interface Education {
  readonly oneLine: string;
  readonly whyItMatters: string;
  readonly facts: readonly string[];
}

export interface BodyContract {
  readonly id: BodyId;
  readonly displayName: string;
  readonly kind: BodyKind;
  readonly parent: BodyId | null;

  readonly ephemeris: EphemerisSource;
  readonly rotation: RotationalElements;

  /** System gravitational parameter, m^3 s^-2. */
  readonly gm: number;
  readonly equatorialRadiusM: number;
  readonly polarRadiusM: number;
  /** Sidereal rotation period in days, negative for retrograde, from the published fact sheets. */
  readonly siderealRotationDays: number;
  readonly obliquityToOrbitDeg: number;
  readonly geometricAlbedo: number;
  readonly meanTemperatureK: number;
  readonly confirmedMoons: number;

  readonly atmosphere: Atmosphere | null;
  readonly appearance: Appearance;
  readonly education: Education;
  readonly knownDiscrepancies: readonly KnownDiscrepancy[];
}

/** Sidereal rotation period implied by the IAU prime-meridian rate, in days, signed. */
export function rotationPeriodFromIau(rotation: RotationalElements): number {
  return 360 / rotation.rotationRateDegPerDay;
}

export function flattening(contract: BodyContract): number {
  return (contract.equatorialRadiusM - contract.polarRadiusM) / contract.equatorialRadiusM;
}
