/**
 * Light travel time, which is the reason you never see the solar system as it is now.
 *
 * Worth a demonstration because it reframes the whole view. When the app shows Neptune, it is
 * showing where Neptune was four hours ago. Romer worked this out in 1676 from Jupiter's moons
 * running early and late, and in doing so made the first measurement of the speed of light.
 */

import { AU_IN_METRES, SPEED_OF_LIGHT_M_S } from "../units";
import { PLANET_IDS } from "../data/planets";
import { PHYSICAL } from "../data/physical";
import { semiMajorAxisMetres } from "./keplers-third-law";
import type { Demonstration, DemonstrationResult, ResultRow } from "./types";

/** The IAU's defining value: light crosses one astronomical unit in this many seconds. */
export const LIGHT_TIME_FOR_ONE_AU_SECONDS = 499.004_783_836;

export function lightTravelSecondsFromSun(metres: number): number {
  return metres / SPEED_OF_LIGHT_M_S;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} m ${(seconds % 60).toFixed(0)} s`;
  return `${Math.floor(seconds / 3_600)} h ${Math.floor((seconds % 3_600) / 60)} m`;
}

function run(): DemonstrationResult {
  const rows: ResultRow[] = PLANET_IDS.map((planet) => {
    const seconds = lightTravelSecondsFromSun(semiMajorAxisMetres(planet));
    return {
      label: PHYSICAL[planet].displayName,
      value: `${formatDuration(seconds)} from the Sun at mean distance`,
    };
  });

  const measured = lightTravelSecondsFromSun(AU_IN_METRES);
  rows.push({
    label: "light time for exactly one astronomical unit",
    value: `${measured.toFixed(6)} s`,
  });

  return {
    measured,
    rows,
    caveats: [
      "These use each planet's mean distance from the Sun. The live view uses the true " +
        "instantaneous distance, which for Mars swings between about 3 and 22 light minutes " +
        "from Earth depending on where both planets are.",
    ],
  };
}

export const LIGHT_TRAVEL_TIME: Demonstration = {
  id: "light-travel-time",
  title: "Everything you are looking at is the past",
  question: "If light takes time to arrive, what am I actually seeing?",
  attribution: "Ole Romer, 1676",
  history:
    "Romer noticed that eclipses of Jupiter's moon Io ran early when Earth was near Jupiter " +
    "and late when it was far, and realised the difference was the time light needed to cross " +
    "the extra distance. It was the first evidence that light has a finite speed, and the first " +
    "measurement of it, seventy years before anyone measured it in a laboratory.",
  published: {
    value: LIGHT_TIME_FOR_ONE_AU_SECONDS,
    unit: "s",
    tolerance: 1e-9,
    source: "IAU 2009 System of Astronomical Constants; au defined exactly by IAU 2012 Resolution B2",
  },
  run,
};
