/**
 * Kepler's third law, and the fact that it is not exactly true.
 *
 * Kepler published T^2 proportional to a^3 in Harmonices Mundi (1619) as an empirical
 * regularity with no mechanism. Newton later derived it, and the derivation shows the
 * constant is not quite constant:
 *
 *   T^2 / a^3 = 4 pi^2 / (G (M_sun + m_planet))
 *
 * So the small deviation from a perfect constant is the planet's own mass pulling the Sun.
 * Kepler's law is a very good approximation precisely because the planets are light. The
 * demonstration measures both halves: that the constant holds, and that where it fails it
 * fails by an amount that weighs the planet.
 */

import { GM_SUN, toMetresFromAu } from "../units";
import { PLANET_IDS, SHORT_SPAN, type PlanetId } from "../data/planets";
import { PHYSICAL } from "../data/physical";
import type { Demonstration, DemonstrationResult, ResultRow } from "./types";

const SECONDS_PER_DAY = 86_400;
const DAYS_PER_CENTURY = 36_525;
const FOUR_PI_SQUARED = 4 * Math.PI * Math.PI;

/**
 * A planet can only be weighed this way if its share of the system mass exceeds the error in
 * the mean elements, which sits near a few parts in 100,000. Jupiter clears it comfortably,
 * Saturn marginally, and nothing else does.
 */
const ELEMENT_PRECISION_FLOOR = 2e-4;

/**
 * Orbital period from the mean-longitude rate. The element table gives degrees per Julian
 * century, so one revolution takes 360 divided by that rate, in centuries.
 */
export function orbitalPeriodSeconds(planet: PlanetId): number {
  const degPerCentury = SHORT_SPAN.elements[planet].ratePerCentury.meanLongitudeDeg;
  return (360 / degPerCentury) * DAYS_PER_CENTURY * SECONDS_PER_DAY;
}

export function semiMajorAxisMetres(planet: PlanetId): number {
  return toMetresFromAu(SHORT_SPAN.elements[planet].atJ2000.semiMajorAxisAu);
}

/** T^2 / a^3, in s^2 m^-3. Constant across the system if Kepler was exactly right. */
export function keplerConstant(planet: PlanetId): number {
  const t = orbitalPeriodSeconds(planet);
  const a = semiMajorAxisMetres(planet);
  return (t * t) / (a * a * a);
}

/** Inverting the law gives the total mass of Sun plus planet, which is the interesting part. */
export function inferredSystemGm(planet: PlanetId): number {
  return FOUR_PI_SQUARED / keplerConstant(planet);
}

function run(): DemonstrationResult {
  const rows: ResultRow[] = [];
  const constants: number[] = [];

  for (const planet of PLANET_IDS) {
    const k = keplerConstant(planet);
    constants.push(k);

    const knownPlanetGm = PHYSICAL[planet].gm;
    const massFraction = knownPlanetGm / GM_SUN;
    const massRatio = (inferredSystemGm(planet) - GM_SUN) / knownPlanetGm;

    // Only Jupiter and Saturn tug the Sun hard enough to show up above the noise in these
    // mean elements. Printing a recovered mass for Mars would be presenting noise as a result.
    const massColumn =
      massFraction >= ELEMENT_PRECISION_FLOOR
        ? `weighs in at ${(massRatio * 100).toFixed(0)}% of its known mass`
        : `too light to weigh this way (${(massFraction * 100).toFixed(4)}% of the Sun)`;

    rows.push({
      label: PHYSICAL[planet].displayName,
      value:
        `T^2/a^3 = ${k.toExponential(6)} s^2/m^3` +
        `  |  period ${(orbitalPeriodSeconds(planet) / SECONDS_PER_DAY).toFixed(2)} d` +
        `  |  ${massColumn}`,
    });
  }

  const mean = constants.reduce((a, b) => a + b, 0) / constants.length;
  const worstFractionalSpread = Math.max(...constants.map((k) => Math.abs(k - mean) / mean));

  const newtonPrediction = FOUR_PI_SQUARED / GM_SUN;
  rows.push({
    label: "mean T^2/a^3 across all eight",
    value: `${mean.toExponential(6)} s^2/m^3`,
  });
  rows.push({
    label: "Newton's 4*pi^2/GM_sun",
    value: `${newtonPrediction.toExponential(6)} s^2/m^3`,
  });
  rows.push({
    label: "worst spread from the mean",
    value: `${(worstFractionalSpread * 100).toFixed(4)}%`,
  });

  return {
    measured: mean / newtonPrediction,
    rows,
    caveats: [
      "Only Jupiter and Saturn can be weighed this way. For every other planet the pull on " +
        "the Sun is smaller than the error in these mean elements, so no figure is quoted " +
        "rather than quoting one that would be noise.",
      "Jupiter comes out around 94% and Saturn around 77% of their known masses. That is a " +
        "rough result, and honestly so: it is what two numbers from a mean-element table can " +
        "tell you about a planet's mass without ever observing the planet itself.",
    ],
  };
}

export const KEPLERS_THIRD_LAW: Demonstration = {
  id: "keplers-third-law",
  title: "Kepler's third law, and where it breaks",
  question: "Why do outer planets take so much longer to go round, and is the rule exact?",
  attribution: "Johannes Kepler, 1619; derived by Isaac Newton, 1687",
  history:
    "Kepler found that the square of a planet's year is proportional to the cube of its " +
    "distance, purely from Tycho Brahe's observations, with no idea why. Newton derived it " +
    "from the inverse-square law seventy years later, and the derivation revealed something " +
    "Kepler could not have seen: the constant depends on the mass of the Sun plus the planet. " +
    "So the law's tiny imperfection is not sloppiness in the data. It is the planet pulling back.",
  published: {
    value: 1,
    unit: "ratio of measured constant to Newton's 4*pi^2/GM_sun",
    tolerance: 0.002,
    source: "Newton, Principia (1687), Book I Prop. XV; GM_sun from https://ssd.jpl.nasa.gov/astro_par.html",
  },
  run,
};
