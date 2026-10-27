/**
 * Heliocentric position for any body in the registry, resolved through its contract.
 *
 * One function so the renderer never branches on body kind. The contract's `ephemeris` field is
 * a discriminated union, so adding a body with a new position source makes this switch fail to
 * compile until it is handled, rather than silently returning the origin.
 */

import { heliocentricPosition } from "../kepler";
import type { JdTdb } from "../time";
import { J2000_JD } from "../time";
import { normalizeAngle, toRadians } from "../units";
import { add, rotateX, rotateZ, vec3, ZERO, type Vec3 } from "../vec";
import { BODY_CONTRACTS, type BodyId } from "./registry";
import type { EphemerisSource } from "./contract";

const EARTH_GM_PLUS_MOON = 4.0350324e14;

/**
 * A moon's position relative to its primary, from mean elements.
 *
 * Honest about what this is. Mean elements give a fixed ellipse, while the real Moon's orbit is
 * perturbed hard enough by the Sun that a proper theory such as ELP2000 needs hundreds of terms.
 * This is good to roughly a degree, which is fine for showing the Moon going round the Earth and
 * not fine for predicting an eclipse. Predicate P4 will need the full theory, and the UI says so.
 */
function meanElementsPosition(
  source: Extract<EphemerisSource, { kind: "mean-elements-about-parent" }>,
  epoch: JdTdb,
): Vec3 {
  const daysSinceJ2000 = epoch - J2000_JD;
  const meanAnomaly = normalizeAngle((2 * Math.PI * daysSinceJ2000) / source.periodDays);

  const e = source.eccentricity;
  let eccentric = meanAnomaly;
  for (let i = 0; i < 12; i++) {
    const delta = (eccentric - e * Math.sin(eccentric) - meanAnomaly) / (1 - e * Math.cos(eccentric));
    eccentric -= delta;
    if (Math.abs(delta) < 1e-13) break;
  }

  const a = source.semiMajorAxisM;
  const inPlane = vec3(
    a * (Math.cos(eccentric) - e),
    a * Math.sqrt(1 - e * e) * Math.sin(eccentric),
    0,
  );

  // The ascending node regresses once every 18.6 years, which is the dominant slow term and
  // cheap to include. Everything faster is left to a proper lunar theory.
  const nodeRad = normalizeAngle(-(2 * Math.PI * daysSinceJ2000) / (18.612_958 * 365.25));
  return rotateZ(rotateX(inPlane, toRadians(source.inclinationDeg as never)), nodeRad);
}

export function heliocentricPositionOf(body: BodyId, epoch: JdTdb): Vec3 {
  const contract = BODY_CONTRACTS[body];
  const source = contract.ephemeris;

  switch (source.kind) {
    case "fixed-at-barycentre":
      return ZERO;
    case "standish-elements":
      return heliocentricPosition(source.planet, epoch);
    case "mean-elements-about-parent": {
      const parent = contract.parent;
      if (parent === null) return meanElementsPosition(source, epoch);
      return add(heliocentricPositionOf(parent, epoch), meanElementsPosition(source, epoch));
    }
  }
}

/**
 * Where the Earth itself is, as distinct from the Earth-Moon barycentre the element table
 * actually models. The two differ by about 4,670 km, which is inside the Earth, so it matters
 * for an eclipse and not for a wide shot.
 */
export function earthPosition(epoch: JdTdb): Vec3 {
  const barycentre = heliocentricPositionOf("embary", epoch);
  const moonOffset = meanElementsPosition(
    BODY_CONTRACTS.moon.ephemeris as Extract<EphemerisSource, { kind: "mean-elements-about-parent" }>,
    epoch,
  );
  const moonMassFraction = 4.902800e12 / EARTH_GM_PLUS_MOON;
  return add(barycentre, {
    x: -moonOffset.x * moonMassFraction,
    y: -moonOffset.y * moonMassFraction,
    z: -moonOffset.z * moonMassFraction,
  });
}
