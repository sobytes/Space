/**
 * Is the Standish residual our bug, or the table's limit?
 *
 * `ephemeris-accuracy.ts` widens JPL's nominal error for Uranus and Neptune, and a widened
 * tolerance is worthless unless the reason for it can be checked. The justification written
 * there claims the 1992 Standish fit simply cannot do better against modern DE440 data. That
 * claim needs evidence sitting in this repository, not a report from a previous session.
 *
 * This is that evidence. It runs a completely independent theory over the same fixtures:
 * `astronomy-engine`, which derives positions from VSOP87 series rather than from mean
 * elements, and which its own documentation tests against JPL Horizons.
 *
 * The logic is a differential diagnosis. If our code or our comparison were wrong, both
 * implementations would be wrong together, because both are compared the same way against the
 * same fixtures. If instead VSOP87 lands close to Horizons while Standish does not, the fault
 * is in the Standish table, and the widened envelope is honest.
 */

import { readFileSync } from "node:fs";
import * as Astronomy from "astronomy-engine";
import { describe, expect, it } from "vitest";
import { PLANET_IDS, SHORT_SPAN, type PlanetId } from "./planets";
import { ACCURACY } from "./ephemeris-accuracy";
import { heliocentricPosition } from "../kepler";
import { equatorialToEcliptic } from "../rotation";
import { jdTdb } from "../time";
import { AU_IN_METRES } from "../units";

const ARCSEC_PER_RADIAN = 648_000 / Math.PI;

/** astronomy-engine names the Earth-Moon barycentre EMB, which is what our table models. */
const VSOP_BODY: Readonly<Record<PlanetId, Astronomy.Body>> = {
  mercury: Astronomy.Body.Mercury,
  venus: Astronomy.Body.Venus,
  embary: Astronomy.Body.EMB,
  mars: Astronomy.Body.Mars,
  jupiter: Astronomy.Body.Jupiter,
  saturn: Astronomy.Body.Saturn,
  uranus: Astronomy.Body.Uranus,
  neptune: Astronomy.Body.Neptune,
};

interface Sample {
  readonly epoch: string;
  readonly jdTdb: number;
  readonly positionKm: readonly [number, number, number];
}

function fixtures(body: PlanetId): Sample[] {
  const parsed = JSON.parse(readFileSync(`fixtures/horizons/${body}.json`, "utf8")) as {
    samples: Sample[];
  };
  return parsed.samples;
}

function longitudeOf(x: number, y: number): number {
  return Math.atan2(y, x);
}

function signedAngle(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
}

function rms(values: readonly number[]): number {
  return Math.sqrt(values.reduce((sum, v) => sum + v * v, 0) / values.length);
}

/** Julian Date to the UTC instant astronomy-engine takes. Fixture epochs are TDB; the two
 *  differ by about 70 s, which is under a thousandth of an arcsecond for the outer planets
 *  and well below anything this test resolves. */
function dateFromJd(jd: number): Date {
  return new Date((jd - 2_440_587.5) * 86_400_000);
}

describe("Standish residuals versus an independent theory", () => {
  const rows: Record<string, string>[] = [];
  const results = new Map<PlanetId, { standish: number; vsop: number }>();

  for (const body of PLANET_IDS) {
    const samples = fixtures(body);
    const standishErrors: number[] = [];
    const vsopErrors: number[] = [];

    for (const sample of samples) {
      const truth = longitudeOf(sample.positionKm[0], sample.positionKm[1]);

      const ours = heliocentricPosition(body, jdTdb(sample.jdTdb), SHORT_SPAN);
      standishErrors.push(signedAngle(longitudeOf(ours.x, ours.y), truth) * ARCSEC_PER_RADIAN);

      // HelioVector returns equatorial J2000. The library's own Ecliptic() helper converts to
      // the ecliptic OF DATE, which is a different frame from the J2000 ecliptic the Horizons
      // fixtures are in; using it put a near-constant 1.4 degree precession offset on every
      // body and briefly made VSOP87 look worse than everything. Rotating by the J2000
      // obliquity here keeps both sides in the one frame.
      const helio = Astronomy.HelioVector(VSOP_BODY[body], dateFromJd(sample.jdTdb));
      const ecliptic = equatorialToEcliptic({ x: helio.x, y: helio.y, z: helio.z });
      vsopErrors.push(signedAngle(longitudeOf(ecliptic.x, ecliptic.y), truth) * ARCSEC_PER_RADIAN);
      void AU_IN_METRES;
    }

    const standish = rms(standishErrors);
    const vsop = rms(vsopErrors);
    results.set(body, { standish, vsop });

    rows.push({
      body,
      "JPL nominal": `${SHORT_SPAN.quotedError[body].longitude}"`,
      "Standish RMS": `${standish.toFixed(2)}"`,
      "VSOP87 RMS": `${vsop.toFixed(3)}"`,
      "envelope widened": ACCURACY[body].rmsFactor > 1 ? `${ACCURACY[body].rmsFactor}x` : "no",
      "ratio": `${(standish / Math.max(vsop, 1e-6)).toFixed(0)}x worse`,
    });
  }

  it("prints the comparison", () => {
    console.table(rows);
    expect(rows).toHaveLength(8);
  });

  /**
   * The control. If the fixtures, the frame, or the comparison maths were wrong, an independent
   * theory would be just as far off as Standish. VSOP87 lands within 12 arcseconds of the
   * Horizons fixtures for every body, so the method is sound and any large Standish residual is
   * a property of the Standish table.
   */
  it("VSOP87 agrees with the Horizons fixtures for every body, validating the method", () => {
    for (const body of PLANET_IDS) {
      const { vsop } = results.get(body)!;
      expect(vsop, `${body} VSOP87 RMS against Horizons`).toBeLessThan(15);
    }
  });

  /**
   * Uranus is the decisive case. Standish is an order of magnitude worse than an independent
   * theory on identical data, which places the error squarely in the 1992 element table rather
   * than in this code, and makes its widened envelope honest.
   */
  it("Uranus: Standish is an order of magnitude worse than VSOP87 on the same fixtures", () => {
    const { standish, vsop } = results.get("uranus")!;
    expect(standish / vsop, "Uranus Standish versus VSOP87").toBeGreaterThan(8);
    expect(standish, "Uranus Standish RMS exceeds JPL's nominal").toBeGreaterThan(
      SHORT_SPAN.quotedError.uranus.longitude,
    );
  });

  /**
   * Neptune is the honest caveat, and this test exists to keep it honest.
   *
   * Standish is about three times worse than VSOP87 here, which points the same way as Uranus
   * but far less strongly. And VSOP87's own residual, around 10 arcseconds, is itself at JPL's
   * quoted nominal for Neptune, so this reference is not precise enough to settle a 10
   * arcsecond question. astronomy-engine claims about one arcminute, which is comfortably
   * above the level being argued about.
   *
   * So the conclusion stands as: the Standish table is clearly the larger error source, and
   * the widened envelope is not covering a bug in this code. Whether JPL's 10 arcsecond
   * nominal is itself optimistic cannot be decided from here, and would need a DE440 kernel
   * rather than a series approximation. The assertion below pins what is actually supported.
   */
  it("Neptune: the evidence points at the table but is not precise enough to be decisive", () => {
    const { standish, vsop } = results.get("neptune")!;
    const nominal = SHORT_SPAN.quotedError.neptune.longitude;

    expect(standish, "Standish Neptune RMS exceeds JPL's nominal").toBeGreaterThan(nominal * 2);
    expect(standish / vsop, "Standish is the larger error source").toBeGreaterThan(2);
    expect(
      vsop,
      "the reference itself sits near Neptune's nominal, which is why this is not decisive",
    ).toBeGreaterThan(nominal * 0.5);
  });

  /**
   * Mercury runs the other way and the table should not hide it: Standish beats VSOP87 there.
   * Recorded so nobody reads this suite as "the independent theory always wins".
   */
  it("Mercury: Standish is the better of the two, which the comparison does not hide", () => {
    const { standish, vsop } = results.get("mercury")!;
    expect(standish).toBeLessThan(vsop);
  });
});
