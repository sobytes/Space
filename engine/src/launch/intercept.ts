/**
 * Can I get there from here, how fast must I leave, and when is the cheap moment?
 *
 * This is what the asteroid and launch tools were missing. Both of them used to take abstract
 * inputs, a heading in degrees and a speed in metres per second, and hand back whatever
 * happened. Nothing happened, almost always: the target volume of a planet is a few parts in
 * a billion of the sky and nobody finds it by moving a slider. So the tools produced a line
 * and no outcome, which is a demonstration of an integrator rather than a thing anyone can
 * use.
 *
 * Asking the inverse question instead turns both into instruments. Where do I aim to hit
 * Mars? What does it cost, and is there a cheaper date? That second question is the whole of
 * practical mission design, and the shape of its answer, a valley in a plane of departure and
 * arrival dates, is why every mission planner has a porkchop plot on the wall.
 *
 * Everything here is two-body Lambert about the Sun, which is how real transfers are scoped
 * before anyone integrates them. `runAsteroid` then flies the result under full mutual
 * gravity, so the aim is a first guess that the integrator either confirms or does not.
 */

import { heliocentricStateOf } from "../bodies/position";
import type { BodyId } from "../bodies/contract";
import { contractFor } from "../bodies/registry";
import { jdTdb, type JdTdb } from "../time";
import { AU_IN_METRES, DAYS_PER_JULIAN_CENTURY, GM_SUN, SECONDS_PER_DAY } from "../units";
import { SHORT_SPAN } from "../data/planets";
import { length, scale, sub, type Vec3 } from "../vec";
import { solveLambert } from "./lambert";
import { asteroidForceModel, releaseAnglesFor, releaseFrame } from "../scenarios/asteroid";
import { propagate } from "../propagate";

export interface Intercept {
  readonly from: BodyId;
  readonly to: BodyId;
  readonly departEpoch: JdTdb;
  readonly flightDays: number;
  /** Heliocentric velocity the object must have at release, m/s. */
  readonly departureVelocity: Vec3;
  /**
   * Speed relative to the body it leaves, m/s. This is the number that costs propellant: a
   * payload released from Earth already has Earth's 30 km/s for free.
   */
  readonly departureDeltaVMS: number;
  /** Speed relative to the target on arrival, m/s. For an impact this sets the energy. */
  readonly arrivalSpeedMS: number;
  /** Where the object is aimed, as a heading in the ecliptic from the origin's own motion. */
  readonly headingDeg: number;
  readonly inclinationDeg: number;
}

/**
 * Solve one transfer: leave this body on this date, arrive at that one this many days later.
 *
 * Returns null where no transfer exists, which happens often and is a real answer. Asking to
 * reach Neptune in a fortnight has no solution at any speed.
 */
export function solveIntercept(
  from: BodyId,
  to: BodyId,
  departEpoch: JdTdb,
  flightDays: number,
  releaseAltitudeM = 0,
): Intercept | null {
  if (from === to || !(flightDays > 0)) return null;

  const origin = heliocentricStateOf(from, departEpoch);
  const arriveEpoch = jdTdb(departEpoch + flightDays);
  const target = heliocentricStateOf(to, arriveEpoch);

  /**
   * Solve from where the object is actually released, not from the planet's centre.
   *
   * The asteroid tool releases at an altitude, and its default is five million kilometres,
   * which is a third of the distance to Venus at closest approach. Aiming from the centre and
   * departing from there missed by 0.19 au, and the aim looked perfectly correct because
   * every number in it was.
   */
  const frame = releaseFrame(from, departEpoch);
  const radial = scale(frame.origin, 1 / length(frame.origin));
  const releaseRadius = contractFor(from).equatorialRadiusM + releaseAltitudeM;
  const releasePoint = {
    x: frame.origin.x + radial.x * releaseRadius,
    y: frame.origin.y + radial.y * releaseRadius,
    z: frame.origin.z + radial.z * releaseRadius,
  };

  const flightSeconds = flightDays * SECONDS_PER_DAY;
  const direct = solveLambert(GM_SUN, releasePoint, target.position, flightSeconds, false);
  const around = solveLambert(GM_SUN, releasePoint, target.position, flightSeconds, true);

  // Whichever costs less to leave on. Which one that is swaps as the flight time changes.
  const cost = (solution: ReturnType<typeof solveLambert>) =>
    solution === null ? Infinity : length(sub(solution.departureVelocity, origin.velocity));
  const best = cost(direct) <= cost(around) ? direct : around;
  if (best === null) return null;

  /**
   * Converted through the launcher's own frame, not a reinvented one.
   *
   * A first version built its own basis from the ecliptic and produced angles that looked
   * entirely reasonable and pointed somewhere else: the asteroid left Mars at exactly the
   * right speed in the wrong direction and was still beside Mars two years later. The
   * controls are along-track, outward and normal about the origin body, so the inverse has
   * to use that frame, and now it uses the same object the forward direction is built from.
   */
  const { headingDeg, inclinationDeg } = releaseAnglesFor(frame, best.departureVelocity);
  return {
    from,
    to,
    departEpoch,
    flightDays,
    departureVelocity: best.departureVelocity,
    departureDeltaVMS: length(sub(best.departureVelocity, origin.velocity)),
    arrivalSpeedMS: length(sub(best.arrivalVelocity, target.velocity)),
    headingDeg,
    inclinationDeg,
  };
}

export interface TransferWindow {
  readonly best: Intercept;
  /** Every solution scanned, so a client can draw the valley rather than only its floor. */
  readonly scanned: readonly { readonly departEpoch: JdTdb; readonly flightDays: number; readonly departureDeltaVMS: number }[];
  /** How often the geometry repeats, days. Miss a window and this is the wait. */
  readonly synodicPeriodDays: number;
}

/**
 * Orbital period, days, from the element tables rather than from where the body happens to be.
 *
 * A first version applied Kepler's third law to the instantaneous heliocentric distance,
 * which is only the semi-major axis for a circular orbit. Mars is eccentric enough that it
 * put its year at 775 days instead of 687, and the Earth-Mars synodic period came out as 878
 * days against the real 780. That is three months of error in the answer to "when is the next
 * launch window", which is the question the whole feature exists to answer.
 *
 * The mean longitude rate is exact and already tabulated, so it is used where there is one.
 */
export function orbitalPeriodDays(id: BodyId): number {
  const ephemeris = contractFor(id).ephemeris;
  if (ephemeris.kind === "mean-elements-about-parent") return ephemeris.periodDays;
  if (ephemeris.kind === "standish-elements") {
    const rate = SHORT_SPAN.elements[ephemeris.planet].ratePerCentury.meanLongitudeDeg;
    return (360 / rate) * DAYS_PER_JULIAN_CENTURY;
  }
  // A moon of a planet, or anything else: fall back to its parent's year.
  const parent = contractFor(id).parent;
  return parent ? orbitalPeriodDays(parent) : 365.25;
}

/** How often two bodies return to the same relative geometry, days. */
export function synodicPeriodDays(a: BodyId, b: BodyId): number {
  const pa = orbitalPeriodDays(a);
  const pb = orbitalPeriodDays(b);
  if (pa === pb) return Infinity;
  return Math.abs(1 / (1 / pa - 1 / pb));
}

/**
 * The Hohmann flight time for the pair, days: half the period of an ellipse touching both
 * orbits.
 *
 * Used to size the search, not as an answer. A grid that stops short of it cannot find the
 * cheap transfer at all, which is what happened to Jupiter: capped at 391 days against a
 * Hohmann time of 997, the search could only offer fast expensive trajectories and reported
 * 13.4 km/s for a journey that costs 8.8.
 */
export function hohmannFlightDays(a: BodyId, b: BodyId): number {
  const transferAxis = (semiMajorAxisM(a) + semiMajorAxisM(b)) / 2;
  return (Math.PI * Math.sqrt(transferAxis ** 3 / GM_SUN)) / SECONDS_PER_DAY;
}

/**
 * Heliocentric semi-major axis, metres.
 *
 * Not the distance right now. This is the same mistake the period calculation made, caught
 * twice because it was written twice: Mars ranges between 1.38 and 1.67 au, so sampling its
 * position at one instant and calling that the orbit's size puts the Hohmann flight time to
 * Mars at 236 days instead of 259. Derived once here so there is nowhere left to repeat it.
 */
export function semiMajorAxisM(id: BodyId): number {
  const ephemeris = contractFor(id).ephemeris;
  if (ephemeris.kind === "standish-elements") {
    return SHORT_SPAN.elements[ephemeris.planet].atJ2000.semiMajorAxisAu * AU_IN_METRES;
  }
  const parent = contractFor(id).parent;
  if (parent) return semiMajorAxisM(parent);
  return length(heliocentricStateOf(id, jdTdb(2_451_545)).position);
}

/**
 * Search a grid of departure dates and flight times for the cheapest transfer.
 *
 * This is a porkchop plot without the plot: the same scan, reported as its minimum plus every
 * point visited so a client can draw the contours. Coarse by design, because the answer is a
 * date to aim at rather than a trajectory to fly, and the integrator refines it afterwards.
 */
export function findTransferWindow(
  from: BodyId,
  to: BodyId,
  searchFrom: JdTdb,
  options: {
    readonly searchDays?: number;
    readonly departureSteps?: number;
    readonly minFlightDays?: number;
    readonly maxFlightDays?: number;
    readonly flightSteps?: number;
    /** Altitude the object is released at, metres. Must match what the launcher will use. */
    readonly releaseAltitudeM?: number;
  } = {},
): TransferWindow | null {
  const synodic = synodicPeriodDays(from, to);
  // One full synodic period by default: every geometry the two bodies can present.
  const searchDays = options.searchDays ?? Math.min(synodic, 2_000);
  const departureSteps = options.departureSteps ?? 40;
  const minFlight = options.minFlightDays ?? 30;
  // Sized from the Hohmann time, not from the search span. A grid that stops short of the
  // minimum-energy transfer cannot find it, and will confidently report a worse one.
  const maxFlight = options.maxFlightDays ?? Math.max(180, hohmannFlightDays(from, to) * 1.6);
  const flightSteps = options.flightSteps ?? 40;

  let best: Intercept | null = null;
  const scanned: { departEpoch: JdTdb; flightDays: number; departureDeltaVMS: number }[] = [];

  for (let i = 0; i < departureSteps; i++) {
    const departEpoch = jdTdb(searchFrom + (searchDays * i) / departureSteps);
    for (let j = 0; j < flightSteps; j++) {
      const flightDays = minFlight + ((maxFlight - minFlight) * j) / (flightSteps - 1);
      const solution = solveIntercept(from, to, departEpoch, flightDays, options.releaseAltitudeM ?? 0);
      if (!solution) continue;
      scanned.push({ departEpoch, flightDays, departureDeltaVMS: solution.departureDeltaVMS });
      if (!best || solution.departureDeltaVMS < best.departureDeltaVMS) best = solution;
    }
  }

  if (!best) return null;
  return { best, scanned, synodicPeriodDays: synodic };
}

/**
 * Correct a two-body aim until it actually hits under full gravity.
 *
 * Lambert solves the two-body problem, and the simulation flies the real one with every
 * planet pulling. Over a nine-month transfer those differ by enough to matter: a Lambert aim
 * at Earth from Mars arrives 75,000 km off, which is a clean miss by twelve Earth radii and
 * looks like a bullseye on any plot you would draw of it.
 *
 * Closing that is a shooting method. Propagate, measure the miss at the arrival epoch, and
 * Newton-step the departure velocity using a Jacobian built from three finite differences.
 * It is the same differential correction real mission design uses, for the same reason.
 *
 * Four propagations an iteration and a handful of iterations, each a few tens of
 * milliseconds, so this is cheap enough to run on a button press.
 */
export function refineIntercept(
  intercept: Intercept,
  options: {
    readonly releaseAltitudeM?: number;
    readonly iterations?: number;
    /** Stop once the miss is inside this. Defaults to the target's own radius. */
    readonly toleranceM?: number;
  } = {},
): { intercept: Intercept; missM: number; iterations: number } | null {
  const iterations = options.iterations ?? 6;
  const targetRadius = contractFor(intercept.to).equatorialRadiusM;
  const tolerance = options.toleranceM ?? targetRadius;

  const flightSeconds = intercept.flightDays * SECONDS_PER_DAY;
  const arriveEpoch = jdTdb(intercept.departEpoch + intercept.flightDays);
  const aimPoint = heliocentricStateOf(intercept.to, arriveEpoch).position;

  const frame = releaseFrame(intercept.from, intercept.departEpoch);
  const radial = scale(frame.origin, 1 / length(frame.origin));
  const releaseRadius = contractFor(intercept.from).equatorialRadiusM + (options.releaseAltitudeM ?? 0);
  const releasePoint = {
    x: frame.origin.x + radial.x * releaseRadius,
    y: frame.origin.y + radial.y * releaseRadius,
    z: frame.origin.z + radial.z * releaseRadius,
  };

  const model = asteroidForceModel(intercept.departEpoch);
  const arrivalFor = (velocity: Vec3): Vec3 => {
    const result = propagate({
      model,
      initial: { position: releasePoint, velocity },
      durationSeconds: flightSeconds,
      limits: { tolerance: 1e-10, minStepSeconds: 1, maxStepSeconds: 86_400 * 5, maxSteps: 400_000 },
      // One sample: this only needs the endpoint, and the endpoint is now exact.
      sampleIntervalSeconds: flightSeconds,
      closeApproachThresholdM: 0,
    });
    return result.samples[result.samples.length - 1].position;
  };

  let velocity = intercept.departureVelocity;
  let missVector = sub(arrivalFor(velocity), aimPoint);
  let used = 0;

  for (; used < iterations && length(missVector) > tolerance; used++) {
    /**
     * The finite-difference step has to scale with how far off we are.
     *
     * A fixed one metre per second sounds small and is not: over a nine-month transfer it
     * moves the arrival point by 0.17 au, so the Jacobian was being measured hundreds of
     * times further out than the miss it was meant to correct, and the linearisation was
     * meaningless. Newton then stalled at 25,000 km and the correction rejected its own
     * steps for making things worse.
     *
     * Sizing the nudge so it displaces the arrival by about a tenth of the current miss keeps
     * the derivative local, and shrinks it automatically as the solution converges.
     */
    const step = Math.max(1e-6, length(missVector) / (10 * flightSeconds));
    const columns: Vec3[] = [];
    for (const axis of ["x", "y", "z"] as const) {
      const nudged = { ...velocity, [axis]: velocity[axis] + step };
      columns.push(scale(sub(sub(arrivalFor(nudged), aimPoint), missVector), 1 / step));
    }

    const correction = solve3x3(columns, missVector);
    if (!correction) break;

    /**
     * Back off along the Newton direction rather than giving up on it.
     *
     * The direction is almost always right even where the full step overshoots, because the
     * problem is only mildly non-linear. Halving a few times finds a step that improves
     * things; abandoning the iteration on the first overshoot left 25,000 km on the table.
     */
    let improved = false;
    for (let damping = 1; damping >= 1 / 16; damping /= 2) {
      const next = {
        x: velocity.x - correction.x * damping,
        y: velocity.y - correction.y * damping,
        z: velocity.z - correction.z * damping,
      };
      const nextMiss = sub(arrivalFor(next), aimPoint);
      if (length(nextMiss) < length(missVector)) {
        velocity = next;
        missVector = nextMiss;
        improved = true;
        break;
      }
    }
    if (!improved) break;
  }

  const angles = releaseAnglesFor(frame, velocity);
  const origin = heliocentricStateOf(intercept.from, intercept.departEpoch);
  const target = heliocentricStateOf(intercept.to, arriveEpoch);
  return {
    intercept: {
      ...intercept,
      departureVelocity: velocity,
      departureDeltaVMS: length(sub(velocity, origin.velocity)),
      arrivalSpeedMS: length(sub(velocity, target.velocity)),
      headingDeg: angles.headingDeg,
      inclinationDeg: angles.inclinationDeg,
    },
    missM: length(missVector),
    iterations: used,
  };
}

/** Cramer's rule on three columns. Null when the Jacobian is singular, which means the step
 *  direction is undetermined and the caller should stop rather than take a wild guess. */
function solve3x3(columns: readonly Vec3[], rhs: Vec3): Vec3 | null {
  const [a, b, c] = columns;
  const det =
    a.x * (b.y * c.z - b.z * c.y)
    - b.x * (a.y * c.z - a.z * c.y)
    + c.x * (a.y * b.z - a.z * b.y);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-30) return null;
  const detFor = (replace: 0 | 1 | 2): number => {
    const m = [a, b, c].map((column, index) => (index === replace ? rhs : column));
    return (
      m[0].x * (m[1].y * m[2].z - m[1].z * m[2].y)
      - m[1].x * (m[0].y * m[2].z - m[0].z * m[2].y)
      + m[2].x * (m[0].y * m[1].z - m[0].z * m[1].y)
    );
  };
  return { x: detFor(0) / det, y: detFor(1) / det, z: detFor(2) / det };
}
