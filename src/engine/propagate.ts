/**
 * Adaptive N-body propagation for small bodies.
 *
 * Dormand-Prince 5(4), the standard embedded Runge-Kutta pair. Two solutions of different order
 * come out of the same seven stage evaluations, their difference estimates the local error, and
 * the step size is chosen from it. That matters here because an asteroid's step needs to be
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
  /** First post-Newtonian correction from the central body. Mercury needs it; an asteroid
   *  in the main belt does not, so it is opt-in and its cost is stated rather than assumed. */
  readonly relativistic: boolean;
}

export interface PropagationLimits {
  /** Relative error per step the adaptive controller targets. */
  readonly tolerance: number;
  readonly minStepSeconds: number;
  readonly maxStepSeconds: number;
  readonly maxSteps: number;
}

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

    if (t >= nextSampleAt) {
      samples.push({ t, position, velocity });
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
export function twoBodyModel(centralGm = GM_SUN): ForceModel {
  return { centralGm, perturbers: [], relativistic: false };
}
