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
import { approximateJulianYear, julianCenturiesSinceJ2000, type JdTdb } from "./time";
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

/** Newton-Raphson stops once a step moves E by less than this, in radians. */
const ECCENTRIC_ANOMALY_TOLERANCE = 1e-13;
const ECCENTRIC_ANOMALY_MAX_ITERATIONS = 40;

/**
 * Elements evaluated at one instant, paired with their rate of change, in engine units:
 * metres and radians, rates per Julian century. The rates are what makes the analytic
 * velocity exact rather than a frozen-element approximation.
 */
interface EvaluatedElements {
  readonly semiMajorAxis: number;
  readonly semiMajorAxisRate: number;
  readonly eccentricity: number;
  readonly eccentricityRate: number;
  readonly inclination: number;
  readonly inclinationRate: number;
  readonly argumentOfPerihelion: number;
  readonly argumentOfPerihelionRate: number;
  readonly longitudeOfAscendingNode: number;
  readonly longitudeOfAscendingNodeRate: number;
  readonly meanAnomaly: number;
  readonly meanAnomalyRate: number;
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
    semiMajorAxis: toMetresFromAu(au(semiMajorAxisAu)),
    semiMajorAxisRate: toMetresFromAu(ratePerCentury.semiMajorAxisAu),
    eccentricity: atJ2000.eccentricity + ratePerCentury.eccentricity * centuries,
    eccentricityRate: ratePerCentury.eccentricity,
    inclination: radiansFromDegrees(inclinationDeg),
    inclinationRate: radiansFromDegrees(ratePerCentury.inclinationDeg),
    argumentOfPerihelion: radiansFromDegrees(
      longitudeOfPerihelionDeg - longitudeOfAscendingNodeDeg,
    ),
    argumentOfPerihelionRate: radiansFromDegrees(
      ratePerCentury.longitudeOfPerihelionDeg - ratePerCentury.longitudeOfAscendingNodeDeg,
    ),
    longitudeOfAscendingNode: radiansFromDegrees(longitudeOfAscendingNodeDeg),
    longitudeOfAscendingNodeRate: radiansFromDegrees(
      ratePerCentury.longitudeOfAscendingNodeDeg,
    ),
    meanAnomaly: normalizeAngleSigned(radiansFromDegrees(meanAnomalyDeg)),
    meanAnomalyRate: radiansFromDegrees(meanAnomalyRateDeg),
  };
}

/**
 * Solves `M = E - e sin E` for E. Throws rather than returning a half-solved value, because
 * a silently unconverged E is a position that looks plausible and is wrong.
 */
export function solveEccentricAnomaly(meanAnomaly: number, eccentricity: number): number {
  let eccentricAnomaly = meanAnomaly + eccentricity * Math.sin(meanAnomaly);
  for (let i = 0; i < ECCENTRIC_ANOMALY_MAX_ITERATIONS; i += 1) {
    const residual = eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - meanAnomaly;
    const step = residual / (1 - eccentricity * Math.cos(eccentricAnomaly));
    eccentricAnomaly -= step;
    if (Math.abs(step) < ECCENTRIC_ANOMALY_TOLERANCE) return eccentricAnomaly;
  }
  throw new Error(
    `Kepler's equation did not converge to ${ECCENTRIC_ANOMALY_TOLERANCE} rad in ` +
      `${ECCENTRIC_ANOMALY_MAX_ITERATIONS} iterations (M=${meanAnomaly}, e=${eccentricity})`,
  );
}

function stateFrom(el: EvaluatedElements): StateVector {
  const eccentricAnomaly = solveEccentricAnomaly(el.meanAnomaly, el.eccentricity);
  const cosE = Math.cos(eccentricAnomaly);
  const sinE = Math.sin(eccentricAnomaly);

  const minorFactor = Math.sqrt(1 - el.eccentricity * el.eccentricity);
  const semiMinorAxis = el.semiMajorAxis * minorFactor;

  const inPlane = vec3(
    el.semiMajorAxis * (cosE - el.eccentricity),
    semiMinorAxis * sinE,
    0,
  );

  const eccentricAnomalyRate =
    (el.meanAnomalyRate + sinE * el.eccentricityRate) / (1 - el.eccentricity * cosE);
  const semiMinorAxisRate =
    el.semiMajorAxisRate * minorFactor -
    (el.semiMajorAxis * el.eccentricity * el.eccentricityRate) / minorFactor;

  const inPlaneRate = vec3(
    el.semiMajorAxisRate * (cosE - el.eccentricity) +
      el.semiMajorAxis * (-sinE * eccentricAnomalyRate - el.eccentricityRate),
    semiMinorAxisRate * sinE + semiMinorAxis * cosE * eccentricAnomalyRate,
    0,
  );

  // d/dT of R(angle) v is R(angle) dv/dT + (dangle/dT) * (axis x R(angle) v), applied once per
  // rotation so the drift of w, I and Omega all contribute to the velocity.
  const afterPerihelion = rotateZ(inPlane, el.argumentOfPerihelion);
  const afterInclination = rotateX(afterPerihelion, el.inclination);
  const position = rotateZ(afterInclination, el.longitudeOfAscendingNode);

  const ratePerihelion = add(
    rotateZ(inPlaneRate, el.argumentOfPerihelion),
    scale(cross(Z_AXIS, afterPerihelion), el.argumentOfPerihelionRate),
  );
  const rateInclination = add(
    rotateX(ratePerihelion, el.inclination),
    scale(cross(X_AXIS, afterInclination), el.inclinationRate),
  );
  const rateNode = add(
    rotateZ(rateInclination, el.longitudeOfAscendingNode),
    scale(cross(Z_AXIS, position), el.longitudeOfAscendingNodeRate),
  );

  return { position, velocity: scale(rateNode, 1 / SECONDS_PER_JULIAN_CENTURY) };
}

function resolveModel(jd: JdTdb, override?: EphemerisModel): EphemerisModel {
  return override ?? modelForYear(approximateJulianYear(jd));
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

export function heliocentricState(
  planet: PlanetId,
  jd: JdTdb,
  model?: EphemerisModel,
): StateVector {
  const resolved = resolveModel(jd, model);
  const centuries = julianCenturiesSinceJ2000(jd);
  return stateFrom(evaluateElements(resolved.elements[planet], centuries));
}
