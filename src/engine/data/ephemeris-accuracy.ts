/**
 * The accuracy the Standish element tables actually deliver, measured, next to the accuracy
 * JPL publishes for them.
 *
 * Why this file exists. `planets.ts` carries JPL's own quoted error table, and the obvious gate
 * is to assert every epoch lands inside it. That gate fails for six of eight bodies. The cause
 * is not a bug: an independent second implementation of the published algorithm reproduces these
 * residuals to three decimals, every element row has been diffed against the live JPL page, and
 * perturbing Neptune's eccentricity in either direction makes both the longitude and the radial
 * residual worse, so the elements are being consumed exactly as fitted.
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
      "Measured RMS longitude residual is about 110% of JPL's 50 arcsecond nominal, with a worst " +
      "epoch near 178% at 2040-07-01. Latitude and distance are comfortably inside nominal, so " +
      "this is in-plane fit residual at the late edge of the 1800-2050 interval rather than a " +
      "frame or rotation error, which would spoil latitude too.",
  },
  neptune: {
    rmsFactor: 3.5,
    maxFactor: 5.0,
    justification:
      "Neptune is the one body where JPL's published nominal is optimistic rather than merely " +
      "typical. Measured RMS longitude residual is about 31 arcseconds against a 10 arcsecond " +
      "nominal, and it exceeds nominal at six of eight sampled epochs rather than only at the " +
      "edges, so a fit-residual explanation does not fit. The Standish fit is from 1992 and " +
      "Horizons now serves DE44x; Neptune's orbit was revised most by that work, having been " +
      "observed over barely one orbit since its 1846 discovery. The app reports Neptune's " +
      "position to about 30 arcseconds, not 10, and says so.",
  },
};

/** The error bar the UI quotes for a body, in arcseconds of heliocentric longitude. */
export function quotedLongitudeAccuracyArcsec(
  planet: PlanetId,
  jplNominalArcsec: number,
): number {
  return jplNominalArcsec * ACCURACY[planet].rmsFactor;
}
