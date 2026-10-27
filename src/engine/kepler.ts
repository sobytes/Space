/**
 * Approximate planetary positions from the JPL Standish Keplerian element tables.
 *
 * Algorithm: https://ssd.jpl.nasa.gov/planets/approx_pos.html. Elements drift linearly with
 * time, the mean anomaly is solved for the eccentric anomaly, and the resulting orbital-plane
 * coordinates are rotated into the J2000 ecliptic by argument of perihelion, inclination and
 * longitude of ascending node, in that order.
 *
 * Everything returned is heliocentric, metres and metres per second, mean ecliptic and equinox
 * of J2000. `embary` is the Earth-Moon barycentre, which is what the table actually models.
 *
 * Velocity is the exact analytic derivative of the position function with respect to time,
 * including the drift of every element and of the long-period terms, not a finite difference.
 * `kepler.test.ts` pins it against a central difference of the same position function.
 */

import {
  modelForYear,
  type EphemerisModel,
  type PlanetElements,
  type PlanetId,
} from "./data/planets";
import {
  DAYS_PER_JULIAN_CENTURY,
  SECONDS_PER_DAY,
  au,
  deg,
  normalizeAngleSigned,
  toMetresFromAu,
  toRadians,
} from "./units";
import { julianCenturiesSinceJ2000, julianYearForModelSelection, type JdTdb } from "./time";
import {
  add,
  cross,
  rotateX,
  rotateZ,
  scale,
  vec3,
  type StateVector,
  type Vec3,
} from "./vec";

const radiansFromDegrees = (degrees: number): number => toRadians(deg(degrees));

const X_AXIS: Vec3 = vec3(1, 0, 0);
const Z_AXIS: Vec3 = vec3(0, 0, 1);

const SECONDS_PER_JULIAN_CENTURY = DAYS_PER_JULIAN_CENTURY * SECONDS_PER_DAY;

const ECCENTRIC_ANOMALY_TOLERANCE_RADIANS = 1e-13;
const ECCENTRIC_ANOMALY_MAX_ITERATIONS = 40;

interface EvaluatedElements {
  readonly semiMajorAxisMetres: number;
  readonly semiMajorAxisMetresPerCentury: number;
  readonly eccentricity: number;
  readonly eccentricityPerCentury: number;
  readonly inclinationRadians: number;
  readonly inclinationRadiansPerCentury: number;
  readonly argumentOfPerihelionRadians: number;
  readonly argumentOfPerihelionRadiansPerCentury: number;
  readonly longitudeOfAscendingNodeRadians: number;
  readonly longitudeOfAscendingNodeRadiansPerCentury: number;
  readonly meanAnomalyRadians: number;
  readonly meanAnomalyRadiansPerCentury: number;
}

function evaluateElements(elements: PlanetElements, centuries: number): EvaluatedElements {
  const { atJ2000, ratePerCentury, longPeriodTerms } = elements;

  const semiMajorAxisAu = atJ2000.semiMajorAxisAu + ratePerCentury.semiMajorAxisAu * centuries;
  const inclinationDeg = atJ2000.inclinationDeg + ratePerCentury.inclinationDeg * centuries;
  const meanLongitudeDeg =
    atJ2000.meanLongitudeDeg + ratePerCentury.meanLongitudeDeg * centuries;
  const longitudeOfPerihelionDeg =
    atJ2000.longitudeOfPerihelionDeg + ratePerCentury.longitudeOfPerihelionDeg * centuries;
  const longitudeOfAscendingNodeDeg =
    atJ2000.longitudeOfAscendingNodeDeg + ratePerCentury.longitudeOfAscendingNodeDeg * centuries;

  let meanAnomalyDeg = meanLongitudeDeg - longitudeOfPerihelionDeg;
  let meanAnomalyRateDeg =
    ratePerCentury.meanLongitudeDeg - ratePerCentury.longitudeOfPerihelionDeg;

  if (longPeriodTerms) {
    const { b, c, s, f } = longPeriodTerms;
    const phase = radiansFromDegrees(f * centuries);
    const phaseRate = radiansFromDegrees(f);
    meanAnomalyDeg += b * centuries * centuries + c * Math.cos(phase) + s * Math.sin(phase);
    meanAnomalyRateDeg +=
      2 * b * centuries - c * Math.sin(phase) * phaseRate + s * Math.cos(phase) * phaseRate;
  }

  return {
    semiMajorAxisMetres: toMetresFromAu(au(semiMajorAxisAu)),
    semiMajorAxisMetresPerCentury: toMetresFromAu(ratePerCentury.semiMajorAxisAu),
    eccentricity: atJ2000.eccentricity + ratePerCentury.eccentricity * centuries,
    eccentricityPerCentury: ratePerCentury.eccentricity,
    inclinationRadians: radiansFromDegrees(inclinationDeg),
    inclinationRadiansPerCentury: radiansFromDegrees(ratePerCentury.inclinationDeg),
    argumentOfPerihelionRadians: radiansFromDegrees(
      longitudeOfPerihelionDeg - longitudeOfAscendingNodeDeg,
    ),
    argumentOfPerihelionRadiansPerCentury: radiansFromDegrees(
      ratePerCentury.longitudeOfPerihelionDeg - ratePerCentury.longitudeOfAscendingNodeDeg,
    ),
    longitudeOfAscendingNodeRadians: radiansFromDegrees(longitudeOfAscendingNodeDeg),
    longitudeOfAscendingNodeRadiansPerCentury: radiansFromDegrees(
      ratePerCentury.longitudeOfAscendingNodeDeg,
    ),
    meanAnomalyRadians: normalizeAngleSigned(radiansFromDegrees(meanAnomalyDeg)),
    meanAnomalyRadiansPerCentury: radiansFromDegrees(meanAnomalyRateDeg),
  };
}

/** Solves `M = E - e sin E` for E. Throws rather than returning a half-solved value. */
export function solveEccentricAnomaly(meanAnomaly: number, eccentricity: number): number {
  let eccentricAnomaly = meanAnomaly + eccentricity * Math.sin(meanAnomaly);
  for (let i = 0; i < ECCENTRIC_ANOMALY_MAX_ITERATIONS; i += 1) {
    const residual = eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - meanAnomaly;
    const step = residual / (1 - eccentricity * Math.cos(eccentricAnomaly));
    eccentricAnomaly -= step;
    if (Math.abs(step) < ECCENTRIC_ANOMALY_TOLERANCE_RADIANS) return eccentricAnomaly;
  }
  throw new Error(
    `Kepler's equation did not converge to ${ECCENTRIC_ANOMALY_TOLERANCE_RADIANS} rad in ` +
      `${ECCENTRIC_ANOMALY_MAX_ITERATIONS} iterations (M=${meanAnomaly}, e=${eccentricity})`,
  );
}

/** A vector and its time derivative, carried together so one rotation can turn both. */
interface Moving {
  readonly value: Vec3;
  readonly rate: Vec3;
}

type Rotation = (v: Vec3, radians: number) => Vec3;

/**
 * Rotates a moving vector about `axis` by an angle that is itself changing, applying the
 * product rule `d/dT (R v) = R dv/dT + (dangle/dT) (axis x R v)`.
 */
function rotateMoving(
  moving: Moving,
  rotate: Rotation,
  axis: Vec3,
  radians: number,
  radiansRate: number,
): Moving {
  const value = rotate(moving.value, radians);
  return {
    value,
    rate: add(rotate(moving.rate, radians), scale(cross(axis, value), radiansRate)),
  };
}

function stateFrom(el: EvaluatedElements): StateVector {
  const eccentricAnomaly = solveEccentricAnomaly(el.meanAnomalyRadians, el.eccentricity);
  const cosE = Math.cos(eccentricAnomaly);
  const sinE = Math.sin(eccentricAnomaly);

  const minorFactor = Math.sqrt(1 - el.eccentricity * el.eccentricity);
  const semiMinorAxis = el.semiMajorAxisMetres * minorFactor;

  const eccentricAnomalyRate =
    (el.meanAnomalyRadiansPerCentury + sinE * el.eccentricityPerCentury) /
    (1 - el.eccentricity * cosE);
  const semiMinorAxisRate =
    el.semiMajorAxisMetresPerCentury * minorFactor -
    (el.semiMajorAxisMetres * el.eccentricity * el.eccentricityPerCentury) / minorFactor;

  const inPlane: Moving = {
    value: vec3(el.semiMajorAxisMetres * (cosE - el.eccentricity), semiMinorAxis * sinE, 0),
    rate: vec3(
      el.semiMajorAxisMetresPerCentury * (cosE - el.eccentricity) +
        el.semiMajorAxisMetres * (-sinE * eccentricAnomalyRate - el.eccentricityPerCentury),
      semiMinorAxisRate * sinE + semiMinorAxis * cosE * eccentricAnomalyRate,
      0,
    ),
  };

  const perihelion = rotateMoving(
    inPlane,
    rotateZ,
    Z_AXIS,
    el.argumentOfPerihelionRadians,
    el.argumentOfPerihelionRadiansPerCentury,
  );
  const inclined = rotateMoving(
    perihelion,
    rotateX,
    X_AXIS,
    el.inclinationRadians,
    el.inclinationRadiansPerCentury,
  );
  const ecliptic = rotateMoving(
    inclined,
    rotateZ,
    Z_AXIS,
    el.longitudeOfAscendingNodeRadians,
    el.longitudeOfAscendingNodeRadiansPerCentury,
  );

  return {
    position: ecliptic.value,
    velocity: scale(ecliptic.rate, 1 / SECONDS_PER_JULIAN_CENTURY),
  };
}

/** Heliocentric position in metres, J2000 ecliptic. */
export function heliocentricPosition(
  planet: PlanetId,
  jd: JdTdb,
  model?: EphemerisModel,
): Vec3 {
  return heliocentricState(planet, jd, model).position;
}

/** Heliocentric velocity in metres per second, J2000 ecliptic. */
export function heliocentricVelocity(
  planet: PlanetId,
  jd: JdTdb,
  model?: EphemerisModel,
): Vec3 {
  return heliocentricState(planet, jd, model).velocity;
}

/**
 * Heliocentric position and velocity, metres and metres per second, J2000 ecliptic. Without
 * `model` the element table is chosen by the year, so a caller that needs one table across a
 * span crossing 1800 or 2050 must pass it, since the two tables disagree at the seam.
 */
export function heliocentricState(
  planet: PlanetId,
  jd: JdTdb,
  model?: EphemerisModel,
): StateVector {
  const resolved = model ?? modelForYear(julianYearForModelSelection(jd));
  return stateFrom(evaluateElements(resolved.elements[planet], julianCenturiesSinceJ2000(jd)));
}
