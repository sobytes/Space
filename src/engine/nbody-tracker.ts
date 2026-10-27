/**
 * A live N-body system that follows a clock.
 *
 * `nbody.ts` integrates. This decides when to integrate, how much, and when to give up and
 * start again, because a simulator's clock does three things a sequential integrator cannot
 * follow naively.
 *
 * It runs backwards. Handled in `advance`, which takes a signed duration.
 *
 * It jumps. Scrubbing to a date centuries away cannot be integrated inside one frame, and
 * waiting for it would freeze the view. Past `reseedThresholdDays` the tracker abandons its
 * integrated state and re-seeds from the analytic ephemeris at the new date. That is a real
 * discontinuity and it is reported rather than hidden: `reseeded` says it happened, and the
 * accumulated mutual-perturbation history is gone.
 *
 * It runs faster than gravity can be integrated. At a high time rate one frame may ask for more
 * simulated time than the step budget allows. The tracker does what fits and reports the
 * shortfall as `lagDays`, so the view can say the integration is behind instead of pretending
 * otherwise or dropping to a step size that would wreck the orbits.
 *
 * The honest summary of this mode against the analytic one: the analytic ephemeris is more
 * accurate over the span it was fitted for and is exactly reversible, while this is the only
 * mode in which a mass you add changes anything. Neither supersedes the other.
 */

import { heliocentricStateOf } from "./bodies/position";
import { BODY_CONTRACTS, type BodyId } from "./bodies/registry";
import {
  DEFAULT_NBODY_LIMITS,
  advance,
  positionOf,
  solarSystemAt,
  totalEnergy,
  velocityOf,
  type MassiveBody,
  type NBodyLimits,
  type NBodySystem,
} from "./nbody";
import { jdTdb, type JdTdb } from "./time";
import { SECONDS_PER_DAY } from "./units";
import { sub, type Vec3 } from "./vec";

/** The eight planets. The default set, because it integrates centuries in seconds. */
export const PLANETARY_SET: readonly BodyId[] = (
  Object.keys(BODY_CONTRACTS) as BodyId[]
).filter((id) => BODY_CONTRACTS[id].ephemeris.kind === "standish-elements");

/** Every moon in the registry. Measured at roughly 950 s per simulated century; see the gate. */
export const ALL_MOONS: readonly BodyId[] = (Object.keys(BODY_CONTRACTS) as BodyId[]).filter(
  (id) => BODY_CONTRACTS[id].ephemeris.kind === "mean-elements-about-parent",
);

export interface TrackerInit {
  readonly epoch: JdTdb;
  /** Registry bodies to integrate, excluding the Sun, which is always present. */
  readonly bodies?: readonly BodyId[];
  /** Bodies that exist in no ephemeris. This is how a hypothetical planet enters the system. */
  readonly extra?: readonly MassiveBody[];
  readonly limits?: NBodyLimits;
  /** A gap larger than this is re-seeded rather than integrated. */
  readonly reseedThresholdDays?: number;
  /** Maximum integration steps per `seek`. Bounds the per-frame cost. */
  readonly stepBudget?: number;
}

export interface TrackerStatus {
  /** The epoch the state actually represents, which trails `targetEpoch` when budget-bound. */
  readonly epoch: JdTdb;
  readonly targetEpoch: JdTdb;
  readonly lagDays: number;
  readonly reseeded: boolean;
  readonly steps: number;
  /** Relative energy drift since the last seed. The integration's own error bar. */
  readonly energyDrift: number;
  readonly bodyCount: number;
}

export interface NBodyTracker {
  /** Integrates toward `target`, within the step budget. */
  seek(target: JdTdb): TrackerStatus;
  /** Discards the integrated state and restarts from the analytic ephemeris. */
  reseed(epoch: JdTdb): void;
  /** Heliocentric, so it drops straight into a renderer that works from the Sun. */
  heliocentricPosition(id: BodyId | string): Vec3;
  heliocentricVelocity(id: BodyId | string): Vec3;
  status(): TrackerStatus;
  readonly ids: readonly string[];
}

export function createNBodyTracker(init: TrackerInit): NBodyTracker {
  const bodies = init.bodies ?? PLANETARY_SET;
  const extra = init.extra ?? [];
  const limits = init.limits ?? DEFAULT_NBODY_LIMITS;
  const reseedThresholdSeconds = (init.reseedThresholdDays ?? 3_652.5) * SECONDS_PER_DAY;
  const stepBudget = init.stepBudget ?? 2_000;

  let system: NBodySystem;
  let seedEnergy = 0;
  let lastStatus: TrackerStatus;

  function build(epoch: JdTdb): void {
    // Everything is handed in as `extra` with no planets of its own, so one code path performs
    // the barycentric conversion for planets, moons and invented bodies alike. Getting that
    // conversion right in one place and wrong in another is exactly the bug this avoids.
    const seeded: MassiveBody[] = bodies
      .filter((id) => id !== "sun")
      .map((id) => {
        const state = heliocentricStateOf(id, epoch);
        return {
          id,
          gm: BODY_CONTRACTS[id].gm,
          position: state.position,
          velocity: state.velocity,
        };
      });
    system = solarSystemAt(epoch, [...seeded, ...extra], []);
    seedEnergy = totalEnergy(system);
  }

  const currentEpoch = (): JdTdb =>
    jdTdb(system.startEpoch + system.elapsed / SECONDS_PER_DAY);

  function statusFrom(target: JdTdb, steps: number, reseeded: boolean): TrackerStatus {
    const epoch = currentEpoch();
    return {
      epoch,
      targetEpoch: target,
      lagDays: target - epoch,
      reseeded,
      steps,
      energyDrift: seedEnergy === 0 ? 0 : Math.abs((totalEnergy(system) - seedEnergy) / seedEnergy),
      bodyCount: system.ids.length,
    };
  }

  build(init.epoch);
  lastStatus = statusFrom(init.epoch, 0, true);

  return {
    get ids() {
      return system.ids;
    },

    seek(target) {
      const deltaSeconds = (target - currentEpoch()) * SECONDS_PER_DAY;

      if (Math.abs(deltaSeconds) > reseedThresholdSeconds) {
        build(target);
        lastStatus = statusFrom(target, 0, true);
        return lastStatus;
      }

      const { steps } = advance(system, deltaSeconds, limits, stepBudget);
      lastStatus = statusFrom(target, steps, false);
      return lastStatus;
    },

    reseed(epoch) {
      build(epoch);
      lastStatus = statusFrom(epoch, 0, true);
    },

    heliocentricPosition(id) {
      return sub(positionOf(system, id), positionOf(system, "sun"));
    },

    heliocentricVelocity(id) {
      return sub(velocityOf(system, id), velocityOf(system, "sun"));
    },

    status() {
      return lastStatus;
    },
  };
}
