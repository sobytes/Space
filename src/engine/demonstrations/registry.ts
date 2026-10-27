/**
 * The one list of demonstrations.
 *
 * The gate in `demonstrations.test.ts` and any UI that offers a demonstration both read from
 * here, so there is no second list to fall out of sync. Adding an entry below adds its gate.
 */

import { KEPLERS_THIRD_LAW } from "./keplers-third-law";
import { LIGHT_TRAVEL_TIME } from "./light-travel-time";
import { MERCURY_PRECESSION } from "./mercury-precession";
import { SOLAR_IRRADIANCE } from "./solar-irradiance";
import type { Demonstration } from "./types";

export const DEMONSTRATIONS: readonly Demonstration[] = [
  MERCURY_PRECESSION,
  KEPLERS_THIRD_LAW,
  LIGHT_TRAVEL_TIME,
  SOLAR_IRRADIANCE,
];

export function demonstrationById(id: string): Demonstration | undefined {
  return DEMONSTRATIONS.find((d) => d.id === id);
}

export type { Demonstration, DemonstrationResult, PublishedValue, ResultRow } from "./types";
