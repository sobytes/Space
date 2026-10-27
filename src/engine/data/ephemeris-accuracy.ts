/**
 * The accuracy the Standish element tables actually deliver, measured, next to the accuracy
 * JPL publishes for them.
 *
 * Why this file exists. `planets.ts` carries JPL's own quoted error table, and the obvious gate
 * is to assert every epoch lands inside it. That gate fails for six of eight bodies.
 *
 * The cause is not a bug in this code, and `ephemeris-accuracy.test.ts` is the evidence rather
 * than an assertion. It runs `astronomy-engine`, which derives positions from VSOP87 series and
 * shares nothing with the Standish mean-element approach, over the same Horizons fixtures. That
 * independent theory lands within 12 arcseconds of the fixtures for every body, which validates
 * the fixtures and the comparison, so a large Standish residual is a property of the table.
 *
 * Two things explain it. JPL calls those figures "nominal errors", which is a typical magnitude
 * and not a per-epoch bound, so individual samples exceeding it is expected. And the Standish and
 * Williams fit dates from 1992 against the ephemeris of that era, while Horizons now serves
 * DE44x; for Neptune that revision is large enough that the published 10 arcsecond figure is
 * optimistic by roughly a factor of three against modern data.
 *
 * So rather than widen JPL's numbers until the test passes, which would destroy the only
 * independent reference we have, this file declares the measured envelope per body with the
 * factor over nominal written down. The gate then asserts two things: that the root-mean-square
 * residual across the sampled epochs stays inside the declared envelope, and that no single epoch
 * exceeds the declared maximum. A real regression blows past both. An honest limit of a
 * 1992 fit does not.
 *
 * These factors are also what the UI shows as the error bar on a position. A figure without its
 * error is a guess wearing a lab coat.
 */

import type { PlanetId } from "./planets";

export interface AccuracyEnvelope {
  /** Multiple of JPL's nominal error that the RMS residual across sampled epochs may reach. */
  readonly rmsFactor: number;
  /** Multiple of JPL's nominal error that any single sampled epoch may reach. */
  readonly maxFactor: number;
  /** Required whenever either factor exceeds 1, so no widening happens without a stated reason. */
  readonly justification?: string;
}

const WITHIN_NOMINAL: AccuracyEnvelope = {
  rmsFactor: 1,
  maxFactor: 1.6,
  justification:
    "RMS held at or inside JPL's nominal, which is what a nominal error means. The single-epoch " +
    "ceiling sits at 1.6x because a least-squares fit's residual is largest at the ends of its " +
    "interval, and five of the eight worst samples land on 2040-07-01 or 2050-01-01, the late " +
    "edge of the 1800-2050 window. Latitude and distance stay well inside nominal for these " +
    "bodies, so the excursions are in-plane fit residual and not a frame or rotation error, " +
    "which would spoil latitude as well.",
};

export const ACCURACY: Readonly<Record<PlanetId, AccuracyEnvelope>> = {
  mercury: WITHIN_NOMINAL,
  venus: WITHIN_NOMINAL,
  embary: { rmsFactor: 1, maxFactor: 1 },
  mars: WITHIN_NOMINAL,
  jupiter: { rmsFactor: 1, maxFactor: 1 },
  saturn: WITHIN_NOMINAL,
  uranus: {
    rmsFactor: 1.3,
    maxFactor: 2.0,
    justification:
      "Decisive. Measured RMS longitude residual is 54.9 arcseconds against a 50 arcsecond " +
      "nominal, while VSOP87 manages 4.6 arcseconds on the exact same fixtures. Standish is " +
      "twelve times worse than an independent theory on identical data, which places the error " +
      "in the 1992 element table and not in this code. Latitude and distance stay inside " +
      "nominal, ruling out a frame or rotation error, which would spoil latitude too. " +
      "See ephemeris-accuracy.test.ts.",
  },
  neptune: {
    rmsFactor: 3.5,
    maxFactor: 5.0,
    justification:
      "Supported but not decisive, and the difference is stated rather than glossed. Measured " +
      "RMS longitude residual is 30.7 arcseconds against a 10 arcsecond nominal, exceeded at " +
      "six of eight sampled epochs rather than only at the window edges. VSOP87 does better at " +
      "10.2 arcseconds, so Standish is clearly the larger error source and the widening is not " +
      "covering a bug here. But 10.2 is itself at Neptune's nominal, and astronomy-engine only " +
      "claims about one arcminute, so that reference cannot settle a 10 arcsecond question. " +
      "Whether JPL's nominal is itself optimistic for Neptune would need a DE440 kernel to " +
      "decide, which this project does not ship. The app reports Neptune to about 30 " +
      "arcseconds and says why. See ephemeris-accuracy.test.ts.",
  },
};

/** The error bar the UI quotes for a body, in arcseconds of heliocentric longitude. */
export function quotedLongitudeAccuracyArcsec(
  planet: PlanetId,
  jplNominalArcsec: number,
): number {
  return jplNominalArcsec * ACCURACY[planet].rmsFactor;
}
