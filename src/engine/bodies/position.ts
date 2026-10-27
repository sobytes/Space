/**
 * Heliocentric position for any body in the registry, resolved through its contract.
 *
 * One function so the renderer never branches on body kind. The contract's `ephemeris` field is
 * a discriminated union, so adding a body with a new position source makes this switch fail to
 * compile until it is handled, rather than silently returning the origin.
 */

import { heliocentricPosition, heliocentricState } from "../kepler";
import type { JdTdb } from "../time";
import { SECONDS_PER_DAY, normalizeAngle, toRadians } from "../units";
import { add, rotateX, rotateZ, scale, sub, vec3, ZERO, type StateVector, type Vec3 } from "../vec";
import { BODY_CONTRACTS, type BodyId } from "./registry";
import { orientationOf } from "../rotation";
import { intoPlane, laplacePlaneFor } from "./laplace";
import type { EphemerisSource } from "./contract";

const EARTH_GM_PLUS_MOON = 4.0350324e14;

/**
 * A moon's position relative to its primary, from JPL's mean elements.
 *
 * The full element set, not a simplification. The first version used only the semi-major axis,
 * eccentricity and inclination and invented an ascending node that regressed from zero. That
 * leaves the orbit's orientation within its plane arbitrary, which happens to look fine for a
 * near-circular equatorial moon and is badly wrong for Triton: with a fabricated node its
 * orbit came out 5 degrees from the ecliptic instead of about 130, because the 157 degree
 * inclination was being added to Neptune's tilt rather than combined with the real node.
 *
 * Honest about what it is. These are mean elements at a single epoch, so they give the orbit
 * the moon follows on average and not the perturbed path it follows this week. For Earth's
 * Moon that is good to roughly a degree, which is fine for showing it going round and nowhere
 * near enough for an eclipse.
 */
function meanElementsPosition(
  source: Extract<EphemerisSource, { kind: "mean-elements-about-parent" }>,
  epoch: JdTdb,
): Vec3 {
  const daysSinceEpoch = epoch - source.epochJd;
  const meanAnomaly = normalizeAngle(
    toRadians(source.meanAnomalyAtEpochDeg as never) +
      (2 * Math.PI * daysSinceEpoch) / source.periodDays,
  );

  const e = source.eccentricity;
  let eccentric = meanAnomaly;
  for (let i = 0; i < 16; i++) {
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

  // Argument of periapsis, then inclination, then node. The same sequence kepler.ts uses for
  // the planets, so the two paths cannot drift apart in convention.
  return rotateZ(
    rotateX(
      rotateZ(inPlane, toRadians(source.argumentOfPeriapsisDeg as never)),
      toRadians(source.inclinationDeg as never),
    ),
    toRadians(source.ascendingNodeDeg as never),
  );
}

/**
 * Rotates an orbit expressed in a planet's equatorial plane into the J2000 ecliptic.
 *
 * This is not a detail. Most regular satellites orbit in their parent's equatorial plane, and
 * for Jupiter that is nearly the ecliptic so the difference hides. For Uranus, tilted 98
 * degrees, it is the difference between moons circling the planet and moons sweeping through
 * it. Triton's retrograde 157 degree orbit is meaningless without it too.
 *
 * The parent's IAU pole already comes back in ecliptic coordinates, so the transform is the
 * rotation taking ecliptic north onto that pole.
 */
function intoParentEquator(local: Vec3, parent: BodyId, epoch: JdTdb): Vec3 {
  const pole = orientationOf(parent, epoch).poleEcliptic;

  // Tilt by the angle between ecliptic north and the pole, about the line where the two
  // planes meet, then swing that line to the pole's own longitude.
  const tilt = Math.acos(Math.min(1, Math.max(-1, pole.z)));
  const azimuth = Math.atan2(pole.y, pole.x);

  return rotateZ(rotateX(local, tilt), azimuth);
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
      const local = meanElementsPosition(source, epoch);
      if (parent === null) return local;

      /**
       * Three reference planes, because JPL quotes satellite elements in three.
       *
       * Close satellites sit in their planet's equator. Distant ones are pulled towards the
       * planet's own orbital plane by the Sun, and the Laplace surface is the transition
       * between the two. Treating everything as equatorial puts Iapetus and Phoebe in
       * visibly wrong orbits, which is why `laplace.ts` computes the blend.
       */
      const oriented =
        source.referencePlane === "parent-equator"
          ? intoParentEquator(local, parent, epoch)
          : source.referencePlane === "laplace"
            ? intoPlane(local, laplacePlaneFor(parent, source.semiMajorAxisM, epoch).pole)
            : local;

      return add(heliocentricPositionOf(parent, epoch), oriented);
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

/**
 * Heliocentric position and velocity for any body in the registry.
 *
 * The two position sources need different treatment. A planet's elements come from the Standish
 * tables, and `kepler.ts` carries the exact analytic derivative of its own position function,
 * including the drift of every element, so that is used directly. A moon's come from JPL mean
 * elements and pass through a chain of plane rotations that depend on the parent's pole and, for
 * the outer satellites, on the Laplace surface. Differentiating that chain by hand would be a
 * second implementation to keep in step with the first, so it is central-differenced instead.
 *
 * The differencing interval is one twenty-thousandth of the body's own orbital period, which
 * keeps the truncation error near 1e-8 relative for Phobos, the fastest body in the registry,
 * while leaving roughly nine significant digits in the difference itself. Both ends of that
 * tradeoff get worse if the interval is chosen as a fixed number of seconds instead, which is
 * why it scales with the body.
 *
 * This is the only approximation in the N-body mode's initial conditions, and it is well under
 * the mean elements' own error.
 */
export function heliocentricStateOf(body: BodyId, epoch: JdTdb): StateVector {
  const source = BODY_CONTRACTS[body].ephemeris;

  switch (source.kind) {
    case "fixed-at-barycentre":
      return { position: ZERO, velocity: ZERO };
    case "standish-elements":
      return heliocentricState(source.planet, epoch);
    case "mean-elements-about-parent": {
      const halfInterval = source.periodDays / 20_000;
      const before = heliocentricPositionOf(body, (epoch - halfInterval) as JdTdb);
      const after = heliocentricPositionOf(body, (epoch + halfInterval) as JdTdb);
      return {
        position: heliocentricPositionOf(body, epoch),
        velocity: scale(sub(after, before), 1 / (2 * halfInterval * SECONDS_PER_DAY)),
      };
    }
  }
}
