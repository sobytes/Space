/**
 * Adaptive N-body propagation for small bodies.
 *
 * Dormand-Prince 5(4), the standard embedded Runge-Kutta pair. Two solutions of different order
 * come out of the same seven stage evaluations, their difference estimates the local error, and
 * the step size is chosen from it. That matters here because a small body's step needs to be
 * small near a close encounter and can be enormous in the quiet stretches between, and a fixed
 * step has to assume the worst everywhere.
 *
 * Coefficients: Dormand, J.R. and Prince, P.J., "A family of embedded Runge-Kutta formulae",
 * Journal of Computational and Applied Mathematics 6(1), 1980.
 *
 * Not symplectic, so energy drifts slowly over very long integrations. `propagate.test.ts`
 * measures that drift against the analytic two-body solution rather than asserting it is
 * absent, because asserting a thing an integrator cannot do is how a gate becomes a lie.
 */

import { GM_SUN } from "./units";
import { eccentricityVector } from "./elements";
import { cross, dot, length, lengthSquared, sub, type Vec3 } from "./vec";

/** Stage nodes. */
const C = [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1] as const;

/** Runge-Kutta coupling coefficients, row per stage. */
const A: readonly (readonly number[])[] = [
  [],
  [1 / 5],
  [3 / 40, 9 / 40],
  [44 / 45, -56 / 15, 32 / 9],
  [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
  [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
  [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
];

/** Fifth-order solution weights. */
const B5 = [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0] as const;

/** Fourth-order solution weights, for the embedded error estimate. */
const B4 = [
  5179 / 57600, 0, 7571 / 16695, 393 / 640, -92097 / 339200, 187 / 2100, 1 / 40,
] as const;

export interface Perturber {
  readonly id: string;
  /** Gravitational parameter, m^3 s^-2. */
  readonly gm: number;
  /** Heliocentric position at a time measured in seconds from the run's start epoch. */
  positionAt(secondsFromStart: number): Vec3;
  /** Collision radius, metres. Zero for a point mass that cannot be hit. */
  readonly radiusM: number;
}

export interface ForceModel {
  readonly centralGm: number;
  readonly perturbers: readonly Perturber[];
  /** First post-Newtonian correction from the central body. Mercury needs it; a body out in
   *  the main belt does not, so it is opt-in and its cost is stated rather than assumed. */
  readonly relativistic: boolean;
}

export interface PropagationLimits {
  /** Relative error per step the adaptive controller targets. */
  readonly tolerance: number;
  readonly minStepSeconds: number;
  readonly maxStepSeconds: number;
  readonly maxSteps: number;
}

/**
 * A hard ceiling on recorded samples, independent of the requested cadence.
 *
 * `sampleIntervalFor` already bounds what this module asks for, but `propagate` is public and
 * will honour any interval it is handed. Now that the sampler can emit many points per step
 * rather than one, an interval of a second across a century would try to allocate billions.
 */
const MAX_SAMPLES = 200_000;

export const DEFAULT_LIMITS: PropagationLimits = {
  tolerance: 1e-11,
  minStepSeconds: 1,
  maxStepSeconds: 86_400 * 30,
  maxSteps: 2_000_000,
};

export type Fate =
  | { readonly kind: "propagating" }
  | { readonly kind: "impact"; readonly body: string; readonly atSeconds: number }
  | { readonly kind: "escaped"; readonly atSeconds: number; readonly eccentricity: number }
  | { readonly kind: "step-limit"; readonly atSeconds: number };

export interface TrajectorySample {
  readonly t: number;
  readonly position: Vec3;
  readonly velocity: Vec3;
}

export interface CloseApproach {
  readonly body: string;
  readonly atSeconds: number;
  readonly distanceM: number;
  readonly relativeSpeedMS: number;
}

export interface PropagationResult {
  readonly samples: readonly TrajectorySample[];
  readonly closeApproaches: readonly CloseApproach[];
  readonly fate: Fate;
  readonly steps: number;
  readonly rejectedSteps: number;
}

const SPEED_OF_LIGHT = 299_792_458;
const C2 = SPEED_OF_LIGHT * SPEED_OF_LIGHT;

function acceleration(model: ForceModel, position: Vec3, velocity: Vec3, t: number, out: Float64Array): void {
  const r2 = lengthSquared(position);
  const r = Math.sqrt(r2);
  const invR3 = 1 / (r2 * r);

  let ax = -model.centralGm * position.x * invR3;
  let ay = -model.centralGm * position.y * invR3;
  let az = -model.centralGm * position.z * invR3;

  if (model.relativistic) {
    const v2 = lengthSquared(velocity);
    const rDotV = dot(position, velocity);
    const prefactor = model.centralGm / (C2 * r2 * r);
    const radial = 4 * (model.centralGm / r) - v2;
    ax += prefactor * (radial * position.x + 4 * rDotV * velocity.x);
    ay += prefactor * (radial * position.y + 4 * rDotV * velocity.y);
    az += prefactor * (radial * position.z + 4 * rDotV * velocity.z);
  }

  for (const perturber of model.perturbers) {
    const p = perturber.positionAt(t);

    // Direct term: the perturber's pull on the body.
    const dx = p.x - position.x;
    const dy = p.y - position.y;
    const dz = p.z - position.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    const directScale = perturber.gm / (d2 * Math.sqrt(d2));

    // Indirect term: the perturber also pulls the Sun, and the frame is centred on the Sun.
    // Dropping this is a classic and quiet error; it leaves a spurious secular drift.
    const s2 = p.x * p.x + p.y * p.y + p.z * p.z;
    const indirectScale = perturber.gm / (s2 * Math.sqrt(s2));

    ax += dx * directScale - p.x * indirectScale;
    ay += dy * directScale - p.y * indirectScale;
    az += dz * directScale - p.z * indirectScale;
  }

  out[0] = ax;
  out[1] = ay;
  out[2] = az;
}

/** Specific orbital energy about the central body, J/kg. Negative is bound. */
export function specificEnergy(centralGm: number, position: Vec3, velocity: Vec3): number {
  return lengthSquared(velocity) / 2 - centralGm / length(position);
}

export function specificAngularMomentum(position: Vec3, velocity: Vec3): Vec3 {
  return cross(position, velocity);
}

/** Orbital eccentricity from a state vector. At or above one the orbit is unbound. */
export function eccentricityOf(centralGm: number, position: Vec3, velocity: Vec3): number {
  return length(eccentricityVector(centralGm, position, velocity));
}

export interface PropagateOptions {
  readonly model: ForceModel;
  readonly initial: { readonly position: Vec3; readonly velocity: Vec3 };
  readonly durationSeconds: number;
  readonly limits?: PropagationLimits;
  /** Trajectory is recorded at most this often, to keep the sample array bounded. */
  readonly sampleIntervalSeconds?: number;
  /** Bodies closer than this are recorded as a close approach, metres. */
  readonly closeApproachThresholdM?: number;
}

export function propagate(options: PropagateOptions): PropagationResult {
  const limits = options.limits ?? DEFAULT_LIMITS;
  const model = options.model;
  const sampleInterval = options.sampleIntervalSeconds ?? options.durationSeconds / 1000;
  const approachThreshold = options.closeApproachThresholdM ?? 1.5e10;

  let t = 0;
  let position = options.initial.position;
  let velocity = options.initial.velocity;
  let step = Math.min(limits.maxStepSeconds, Math.max(limits.minStepSeconds, 3_600));

  const samples: TrajectorySample[] = [{ t: 0, position, velocity }];
  const closeApproaches: CloseApproach[] = [];
  let nextSampleAt = sampleInterval;

  const k: Float64Array[] = Array.from({ length: 7 }, () => new Float64Array(6));
  const accel = new Float64Array(3);
  let steps = 0;
  let rejectedSteps = 0;
  let fate: Fate = { kind: "propagating" };

  /** Tracks the nearest approach to each perturber so a minimum is caught, not just a sample. */
  const nearest = new Map<string, { distance: number; t: number; speed: number }>();

  while (t < options.durationSeconds && steps < limits.maxSteps) {
    const h = Math.min(step, options.durationSeconds - t);

    for (let stage = 0; stage < 7; stage++) {
      let px = position.x, py = position.y, pz = position.z;
      let vx = velocity.x, vy = velocity.y, vz = velocity.z;
      for (let j = 0; j < stage; j++) {
        const a = A[stage][j];
        if (a === 0) continue;
        px += h * a * k[j][0]; py += h * a * k[j][1]; pz += h * a * k[j][2];
        vx += h * a * k[j][3]; vy += h * a * k[j][4]; vz += h * a * k[j][5];
      }
      acceleration(model, { x: px, y: py, z: pz }, { x: vx, y: vy, z: vz }, t + C[stage] * h, accel);
      k[stage][0] = vx; k[stage][1] = vy; k[stage][2] = vz;
      k[stage][3] = accel[0]; k[stage][4] = accel[1]; k[stage][5] = accel[2];
    }

    const y5 = new Float64Array(6);
    const y4 = new Float64Array(6);
    const base = [position.x, position.y, position.z, velocity.x, velocity.y, velocity.z];
    for (let i = 0; i < 6; i++) {
      let s5 = 0;
      let s4 = 0;
      for (let stage = 0; stage < 7; stage++) {
        s5 += B5[stage] * k[stage][i];
        s4 += B4[stage] * k[stage][i];
      }
      y5[i] = base[i] + h * s5;
      y4[i] = base[i] + h * s4;
    }

    // Scaled error, position and velocity weighted by their own magnitude so neither dominates.
    const positionScale = Math.max(1, Math.hypot(y5[0], y5[1], y5[2]));
    const velocityScale = Math.max(1, Math.hypot(y5[3], y5[4], y5[5]));
    const positionError = Math.hypot(y5[0] - y4[0], y5[1] - y4[1], y5[2] - y4[2]) / positionScale;
    const velocityError = Math.hypot(y5[3] - y4[3], y5[4] - y4[4], y5[5] - y4[5]) / velocityScale;
    const error = Math.max(positionError, velocityError);

    if (error > limits.tolerance && h > limits.minStepSeconds) {
      rejectedSteps += 1;
      step = Math.max(limits.minStepSeconds, h * Math.max(0.2, 0.9 * (limits.tolerance / error) ** 0.2));
      continue;
    }

    // Kept so the sampler can interpolate across the step it just took.
    const tBefore = t;
    const positionBefore = position;
    const velocityBefore = velocity;

    position = { x: y5[0], y: y5[1], z: y5[2] };
    velocity = { x: y5[3], y: y5[4], z: y5[5] };
    t += h;
    steps += 1;

    for (const perturber of model.perturbers) {
      const p = perturber.positionAt(t);
      const separation = length(sub(position, p));
      if (separation > approachThreshold) continue;
      const best = nearest.get(perturber.id);
      if (!best || separation < best.distance) {
        nearest.set(perturber.id, { distance: separation, t, speed: length(velocity) });
      }
      if (perturber.radiusM > 0 && separation <= perturber.radiusM) {
        fate = { kind: "impact", body: perturber.id, atSeconds: t };
        break;
      }
    }
    if (fate.kind === "impact") break;

    /**
     * Every sample the step passed over, not just the last one.
     *
     * This was `if (t >= nextSampleAt)`, which records at most one sample per integration
     * step and advances the schedule by a single interval however far the step reached. So a
     * requested cadence finer than the step size was silently coarsened to the step size, and
     * a cadence slightly finer lost samples: a request for 1000 across 3.7 years returned 987,
     * at times that were not the ones asked for.
     *
     * Measured on a perturbed heliocentric orbit, the integrator ran at a 1.36 day mean step
     * under a 1e-10 tolerance, well inside the 30 day ceiling, so this was not what produced
     * the polygonal paths; a fixed sample count was. It is still the wrong behaviour, and
     * fixing it is what lets `sampleIntervalFor` promise a resolution rather than request
     * one.
     *
     * Interpolating inside the step costs no extra force evaluations and no accuracy worth
     * the name: the blend is third order in a step already controlled to 1e-10. Shrinking the
     * integrator step to the drawing cadence would have been the other way to get here, and
     * it would have let the drawing dictate the physics.
     */
    const stepStart: TrajectorySample = {
      t: tBefore,
      position: positionBefore,
      velocity: velocityBefore,
    };
    const stepEnd: TrajectorySample = { t, position, velocity };
    while (nextSampleAt <= t && samples.length < MAX_SAMPLES) {
      const at = hermiteBetween(stepStart, stepEnd, nextSampleAt);
      samples.push({ t: nextSampleAt, position: at.position, velocity: at.velocity });
      nextSampleAt += sampleInterval;
    }

    const e = eccentricityOf(model.centralGm, position, velocity);
    if (e >= 1 && length(position) > 5e12) {
      fate = { kind: "escaped", atSeconds: t, eccentricity: e };
      break;
    }

    step = Math.min(
      limits.maxStepSeconds,
      h * Math.min(5, 0.9 * (limits.tolerance / Math.max(error, 1e-18)) ** 0.2),
    );
  }

  /**
   * Always record where it actually ended up.
   *
   * The loop only pushed a sample when the clock crossed a sample boundary, so the last
   * recorded state was up to one sample interval short of the requested duration: on a
   * fifty-year run at a thousand samples, eighteen days of motion missing from the answer. The
   * final step is already clamped to land exactly on `durationSeconds`, so the exact endpoint
   * was computed every time and then thrown away. Callers read `samples[samples.length - 1]`
   * as the final state, and now it is one.
   */
  const lastSample = samples[samples.length - 1];
  if (fate.kind !== "impact" && t > lastSample.t) {
    samples.push({ t, position, velocity });
  }

  if (fate.kind === "propagating" && steps >= limits.maxSteps) {
    fate = { kind: "step-limit", atSeconds: t };
  }

  for (const [body, best] of nearest) {
    closeApproaches.push({
      body,
      atSeconds: best.t,
      distanceM: best.distance,
      relativeSpeedMS: best.speed,
    });
  }

  samples.push({ t, position, velocity });
  return { samples, closeApproaches, fate, steps, rejectedSteps };
}

/** A two-body model with no perturbers, used as the exactly-solvable reference. */
/**
 * How often to record a sample, chosen from the orbit rather than from the span.
 *
 * A fixed number of samples across the whole run sounds reasonable and degrades badly: the
 * resolution per orbit is the total divided by the number of orbits, so a path that is smooth
 * over two years becomes a polygon over fifty. Measured on the shipped values, a one-au orbit
 * got 1000 points per orbit at two years and 40 at fifty on the web, and 300 then 12 on iOS.
 * Twelve points per orbit draws a dodecagon, and fifty overlapping dodecagons is the
 * crosshatched band that was reported as "it might be correct, just wanted to check". It was
 * not correct: the orbit is smooth and the drawing was not.
 *
 * The two clients also disagreed, 2000 against 600, so the same launch drew a different shape
 * depending on which one you ran it in. That is the part a conformance suite should have
 * caught and could not, because nothing had ever stated what the cadence was supposed to be.
 *
 * Tying the cadence to the orbital period fixes the resolution per orbit instead, so the path
 * looks the same at any span. The period comes from the initial state by vis-viva, which costs
 * nothing and needs no extra input. An unbound orbit has no period, so those fall back to a
 * fixed count, which is the right behaviour: a hyperbolic path is one swing and does not
 * accumulate turns.
 *
 * `maxSamples` is a memory bound, not a quality target. A tight orbit propagated for centuries
 * would otherwise ask for hundreds of thousands of points; it degrades to a coarser path
 * rather than refusing, and the degradation is proportional rather than sudden.
 */
export function sampleIntervalFor(
  gm: number,
  initial: { readonly position: Vec3; readonly velocity: Vec3 },
  durationSeconds: number,
  options: { pointsPerOrbit?: number; maxSamples?: number } = {},
): number {
  const pointsPerOrbit = options.pointsPerOrbit ?? 180;
  const maxSamples = options.maxSamples ?? 40_000;
  const floor = durationSeconds / maxSamples;

  const r = length(initial.position);
  const v = length(initial.velocity);
  const energy = (v * v) / 2 - gm / r;
  if (!(energy < 0) || r <= 0) return Math.max(floor, durationSeconds / 2_000);

  const semiMajorAxis = -gm / (2 * energy);
  const period = 2 * Math.PI * Math.sqrt(semiMajorAxis ** 3 / gm);
  return Math.max(floor, period / pointsPerOrbit);
}

export function twoBodyModel(centralGm = GM_SUN): ForceModel {
  return { centralGm, perturbers: [], relativistic: false };
}

/**
 * Where a propagated object is at an arbitrary moment, interpolated between samples.
 *
 * Cubic Hermite rather than linear, because the integrator hands back velocity alongside
 * position and discarding it shows an object that visibly corners at every sample. During a
 * close approach, which is exactly where someone is watching, the samples are far apart
 * relative to how fast the direction is changing and a linear path cuts the corner by
 * thousands of kilometres.
 *
 * Shared rather than reimplemented per client. Both the browser and the phone need to place a
 * rider on a trajectory at the current clock, and two hand-rolled interpolations would be two
 * chances to put the object somewhere the drawn path does not go.
 */
export function trajectoryStateAt(
  samples: readonly TrajectorySample[],
  seconds: number,
): { position: Vec3; velocity: Vec3 } | null {
  if (samples.length === 0) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (samples.length === 1 || seconds <= first.t) {
    return { position: first.position, velocity: first.velocity };
  }
  if (seconds >= last.t) return { position: last.position, velocity: last.velocity };

  // Binary search: a two-century run holds thousands of samples and this is called per frame.
  let low = 0;
  let high = samples.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (samples[mid].t <= seconds) low = mid;
    else high = mid;
  }

  return hermiteBetween(samples[low], samples[high], seconds);
}

/**
 * Cubic Hermite between two states, used both to look a trajectory up and to record it.
 *
 * Shared on purpose. The sampler needs it because an adaptive integrator takes steps far
 * longer than the cadence a drawn path needs, and the lookup needs it for the same reason one
 * step later. Two implementations of the same blend would be two chances for the path on
 * screen to disagree with the object riding it.
 */
export function hermiteBetween(
  a: TrajectorySample,
  b: TrajectorySample,
  seconds: number,
): { position: Vec3; velocity: Vec3 } {
  const h = b.t - a.t;
  if (h <= 0) return { position: a.position, velocity: a.velocity };

  const u = (seconds - a.t) / h;
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  // Derivative of the same polynomial, so the velocity reported is the one the drawn path
  // actually has rather than a separately interpolated quantity that disagrees with it.
  const d00 = (6 * u2 - 6 * u) / h;
  const d10 = 3 * u2 - 4 * u + 1;
  const d01 = (-6 * u2 + 6 * u) / h;
  const d11 = 3 * u2 - 2 * u;

  const blend = (
    pa: number, va: number, pb: number, vb: number,
  ): [number, number] => [
    h00 * pa + h10 * h * va + h01 * pb + h11 * h * vb,
    d00 * pa + d10 * va + d01 * pb + d11 * vb,
  ];

  const [x, vx] = blend(a.position.x, a.velocity.x, b.position.x, b.velocity.x);
  const [y, vy] = blend(a.position.y, a.velocity.y, b.position.y, b.velocity.y);
  const [z, vz] = blend(a.position.z, a.velocity.z, b.position.z, b.velocity.z);
  return { position: { x, y, z }, velocity: { x: vx, y: vy, z: vz } };
}
