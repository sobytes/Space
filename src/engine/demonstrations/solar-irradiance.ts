/**
 * The inverse-square falloff of sunlight, which is why Neptune is dark and cold.
 *
 * Included because it is the same geometry that governs gravity, and seeing the numbers next
 * to each other makes the inverse square concrete rather than abstract. It is also the number
 * that decides whether a solar-powered mission to the outer system is possible at all, which
 * is why Juno needed 60 square metres of panel and Cassini carried plutonium instead.
 */

import { AU_IN_METRES } from "../units";
import { PLANET_IDS } from "../data/planets";
import { PHYSICAL } from "../data/physical";
import { semiMajorAxisMetres } from "./keplers-third-law";
import type { Demonstration, DemonstrationResult, ResultRow } from "./types";

/** IAU 2015 Resolution B3 nominal solar luminosity, watts. */
export const SOLAR_LUMINOSITY_W = 3.828e26;

/** The measured solar constant at one astronomical unit, W/m^2. */
export const SOLAR_CONSTANT_AT_1AU = 1361;

export function irradianceAt(metres: number): number {
  return SOLAR_LUMINOSITY_W / (4 * Math.PI * metres * metres);
}

function run(): DemonstrationResult {
  const earthValue = irradianceAt(AU_IN_METRES);

  const rows: ResultRow[] = PLANET_IDS.map((planet) => {
    const w = irradianceAt(semiMajorAxisMetres(planet));
    return {
      label: PHYSICAL[planet].displayName,
      value:
        `${w.toFixed(1)} W/m^2` +
        `  |  ${((w / earthValue) * 100).toFixed(2)}% of Earth's` +
        `  |  mean surface ${PHYSICAL[planet].meanTemperatureK} K`,
    };
  });

  rows.push({ label: "at exactly one astronomical unit", value: `${earthValue.toFixed(2)} W/m^2` });
  rows.push({ label: "measured solar constant", value: `${SOLAR_CONSTANT_AT_1AU} W/m^2` });

  return {
    measured: earthValue,
    rows,
    caveats: [
      "Irradiance is what arrives at the top of the atmosphere, not what reaches the ground. " +
        "Surface temperature depends on albedo and greenhouse effect too, which is why Venus " +
        "receives roughly twice Earth's sunlight but sits at 737 K rather than twice as warm.",
    ],
  };
}

export const SOLAR_IRRADIANCE: Demonstration = {
  id: "solar-irradiance",
  title: "Why the outer solar system runs on nuclear batteries",
  question: "How much weaker is sunlight out at Neptune?",
  attribution: "Johannes Kepler, 1604, for the inverse square of light",
  history:
    "Kepler argued in Ad Vitellionem Paralipomena that light spreading from a point must thin " +
    "out as the square of the distance, because the same light covers a sphere whose area grows " +
    "that way. The same geometry turns up in Newton's gravity eighty years later. It is also a " +
    "hard engineering constraint: at Neptune sunlight is about a thousandth of Earth's, which is " +
    "why missions past Jupiter have historically carried radioisotope power rather than panels.",
  published: {
    value: SOLAR_CONSTANT_AT_1AU,
    unit: "W/m^2",
    tolerance: 0.005,
    source: "IAU 2015 Resolution B3 nominal solar luminosity; solar constant 1361 W/m^2 (Kopp & Lean 2011)",
  },
  run,
};
