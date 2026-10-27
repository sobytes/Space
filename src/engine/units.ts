/**
 * Unit discipline for the engine.
 *
 * Source data arrives in whatever unit its publisher chose. JPL gives semi-major axes in
 * au and rates per Julian century, the IAU gives pole directions in degrees and spin rates
 * in degrees per day, and the NASA fact sheets give radii in km. Mixing those silently is
 * the most likely way to be wrong by a factor of 1000 while still rendering a pretty orbit.
 *
 * The rule: branded units at the data boundary, bare SI inside the engine. Every table in
 * `data/` declares its units in the type, the `to*` functions below are the only way across,
 * and past that line every number is metres, seconds, radians or kilograms.
 */

declare const UNIT: unique symbol;

type Tagged<T extends string> = number & { readonly [UNIT]: T };

export type Metres = Tagged<"m">;
export type Kilometres = Tagged<"km">;
export type Au = Tagged<"au">;
export type Radians = Tagged<"rad">;
export type Degrees = Tagged<"deg">;
export type Arcseconds = Tagged<"arcsec">;
export type Seconds = Tagged<"s">;
export type Days = Tagged<"d">;
export type JulianCenturies = Tagged<"cy">;
export type Kilograms = Tagged<"kg">;

export const km = (v: number) => v as Kilometres;
export const au = (v: number) => v as Au;
export const deg = (v: number) => v as Degrees;
export const arcsec = (v: number) => v as Arcseconds;
export const days = (v: number) => v as Days;
export const centuries = (v: number) => v as JulianCenturies;
export const kg = (v: number) => v as Kilograms;

/** IAU 2012 Resolution B2 defines the astronomical unit as exactly this many metres. */
export const AU_IN_METRES = 149_597_870_700;
export const SECONDS_PER_DAY = 86_400;
export const DAYS_PER_JULIAN_CENTURY = 36_525;
export const SPEED_OF_LIGHT_M_S = 299_792_458;

/** IAU 2009 heliocentric gravitational constant, m^3 s^-2. */
export const GM_SUN = 1.327_124_400_41e20;

export const toMetresFromAu = (v: Au): number => v * AU_IN_METRES;
export const toMetresFromKm = (v: Kilometres): number => v * 1000;
export const toRadians = (v: Degrees): number => (v * Math.PI) / 180;
export const toRadiansFromArcsec = (v: Arcseconds): number => (v * Math.PI) / 648_000;
export const toSecondsFromDays = (v: Days): number => v * SECONDS_PER_DAY;

export const metresToAu = (v: number): Au => (v / AU_IN_METRES) as Au;
export const metresToKm = (v: number): Kilometres => (v / 1000) as Kilometres;
export const radiansToDeg = (v: number): Degrees => ((v * 180) / Math.PI) as Degrees;

/** Wrap to [0, 2pi). Mean longitudes accumulate thousands of turns over a century. */
export function normalizeAngle(radians: number): number {
  const wrapped = radians % (2 * Math.PI);
  return wrapped < 0 ? wrapped + 2 * Math.PI : wrapped;
}

/** Wrap to [-pi, pi), which is what you want for a difference between two angles. */
export function normalizeAngleSigned(radians: number): number {
  const wrapped = normalizeAngle(radians);
  return wrapped > Math.PI ? wrapped - 2 * Math.PI : wrapped;
}
