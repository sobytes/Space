/**
 * Unit tests for the closed-form relativity results. The integrated measurement lives in
 * `demonstrations/mercury-precession.ts` and is gated by the demonstrations suite, so it is
 * not duplicated here.
 */

import { describe, expect, it } from "vitest";
import {
  MERCURY,
  MERCURY_GR_PRECESSION_ARCSEC_PER_CENTURY,
  perihelionAdvanceArcsecPerCentury,
  perihelionAdvancePerOrbit,
  postNewtonianAcceleration,
} from "./relativity";

describe("closed-form perihelion advance", () => {
  it("gives Einstein's 42.98 arcsec per century for Mercury", () => {
    const arcsec = perihelionAdvanceArcsecPerCentury(
      MERCURY.gmSun,
      MERCURY.semiMajorAxisMetres,
      MERCURY.eccentricity,
      MERCURY.orbitalPeriodDays,
    );
    expect(arcsec).toBeCloseTo(MERCURY_GR_PRECESSION_ARCSEC_PER_CENTURY, 1);
  });

  it("scales as 1/(a(1-e^2)), so a wider or rounder orbit precesses less", () => {
    const base = perihelionAdvancePerOrbit(MERCURY.gmSun, MERCURY.semiMajorAxisMetres, MERCURY.eccentricity);
    const wider = perihelionAdvancePerOrbit(MERCURY.gmSun, MERCURY.semiMajorAxisMetres * 2, MERCURY.eccentricity);
    const rounder = perihelionAdvancePerOrbit(MERCURY.gmSun, MERCURY.semiMajorAxisMetres, 0);

    expect(wider).toBeCloseTo(base / 2, 12);
    expect(rounder).toBeLessThan(base);
  });
});

describe("post-Newtonian acceleration", () => {
  it("is smaller than Newtonian gravity by of order (v/c)^2", () => {
    const a = MERCURY.semiMajorAxisMetres;
    const position = { x: a, y: 0, z: 0 };
    const speed = Math.sqrt(MERCURY.gmSun / a);
    const velocity = { x: 0, y: speed, z: 0 };

    const newtonian = MERCURY.gmSun / (a * a);
    const correction = postNewtonianAcceleration(MERCURY.gmSun, position, velocity);
    const ratio = Math.hypot(correction.x, correction.y, correction.z) / newtonian;

    const vOverCSquared = (speed / 299_792_458) ** 2;
    expect(ratio).toBeGreaterThan(vOverCSquared * 0.1);
    expect(ratio).toBeLessThan(vOverCSquared * 10);
  });
});
