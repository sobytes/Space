/**
 * Runs asteroid propagation off the render thread.
 *
 * This is the payoff for keeping `src/engine` free of the DOM, three.js and React. The exact
 * same `runAsteroid` the gates exercise runs here, unchanged, with no worker-specific variant
 * to drift out of sync. A fifty-year run with nine perturbers is tens of thousands of adaptive
 * steps, which would visibly stall a sixty-frame-per-second canvas.
 *
 * The trajectory comes back as a transferable Float32Array rather than an array of objects.
 * Positions are heliocentric metres, which the orbit-line group already absorbs the floating
 * origin for, so the main thread does no conversion.
 */

import { runAsteroid, type AsteroidLaunch, type ImpactEstimate } from "@solar/engine/scenarios/asteroid";
import type { ImpactConsequences } from "@solar/engine/scenarios/impact";
import { findTransferWindow, refineIntercept, synodicPeriodDays } from "@solar/engine/launch/intercept";
import type { BodyId } from "@solar/engine/bodies/contract";
import type { JdTdb } from "@solar/engine/time";
import type { CloseApproach, Fate } from "@solar/engine/propagate";

export interface AsteroidRequest {
  readonly id: number;
  readonly launch: AsteroidLaunch;
}

export interface AsteroidResponse {
  readonly id: number;
  /** Flat xyz triples in heliocentric metres. */
  readonly path: Float32Array;
  /**
   * The same samples again, in full precision and with time and velocity, for riding.
   *
   * `path` is float32 and positions only, which is right for a line the GPU draws and wrong
   * for placing a camera: the floating origin has to be the rider's position in metres, and
   * half a kilometre of float32 error at Neptune becomes half a kilometre of camera jitter
   * when the camera is a hundred metres from the rock. The interpolation also needs velocity,
   * since a linear path between samples cuts corners by thousands of kilometres during a
   * close approach.
   */
  readonly ride: {
    readonly times: Float64Array;
    readonly states: Float64Array;
    readonly startEpoch: number;
  };
  readonly summary: string;
  readonly fate: Fate;
  readonly impact: ImpactEstimate | null;
  /** What the impact does where it lands: airburst or crater, blast radii, shaking. */
  readonly consequences: ImpactConsequences | null;
  readonly finalEccentricity: number;
  readonly finalSemiMajorAxisAu: number | null;
  readonly closeApproaches: readonly CloseApproach[];
  readonly steps: number;
  readonly elapsedMs: number;
}

/**
 * Aiming runs here too, not on the main thread.
 *
 * Differential correction is a dozen full propagations and takes a couple of seconds for a
 * Mars transfer. Run on the main thread that freezes the interface, and a frozen interface is
 * how the asteroid sheet's own controls stopped responding once before.
 */
export interface SolveRequest {
  readonly id: number;
  readonly solve: { readonly from: BodyId; readonly to: BodyId; readonly startEpoch: JdTdb; readonly releaseAltitudeM: number };
}

export interface SolveResponse {
  readonly id: number;
  readonly solved: {
    readonly departEpoch: JdTdb;
    readonly flightDays: number;
    readonly departureDeltaVMS: number;
    readonly arrivalSpeedMS: number;
    readonly headingDeg: number;
    readonly inclinationDeg: number;
    readonly missM: number;
  } | null;
}

self.onmessage = (event: MessageEvent<AsteroidRequest | SolveRequest>) => {
  if ("solve" in event.data) {
    const { id, solve } = event.data;
    const window = findTransferWindow(solve.from, solve.to, solve.startEpoch, {
      releaseAltitudeM: solve.releaseAltitudeM,
      searchDays: Math.min(synodicPeriodDays(solve.from, solve.to), 1_200),
    });
    const refined = window
      ? refineIntercept(window.best, { releaseAltitudeM: solve.releaseAltitudeM })
      : null;
    const response: SolveResponse = {
      id,
      solved: refined
        ? {
            departEpoch: refined.intercept.departEpoch,
            flightDays: refined.intercept.flightDays,
            departureDeltaVMS: refined.intercept.departureDeltaVMS,
            arrivalSpeedMS: refined.intercept.arrivalSpeedMS,
            headingDeg: refined.intercept.headingDeg,
            inclinationDeg: refined.intercept.inclinationDeg,
            missM: refined.missM,
          }
        : null,
    };
    self.postMessage(response);
    return;
  }

  onPropagate(event as MessageEvent<AsteroidRequest>);
};

const onPropagate = (event: MessageEvent<AsteroidRequest>) => {
  const { id, launch } = event.data;
  const started = performance.now();

  const outcome = runAsteroid(launch);

  const samples = outcome.result.samples;
  const path = new Float32Array(samples.length * 3);
  for (let i = 0; i < samples.length; i++) {
    path[i * 3] = samples[i].position.x;
    path[i * 3 + 1] = samples[i].position.y;
    path[i * 3 + 2] = samples[i].position.z;
  }

  // Six per sample: position then velocity. One buffer rather than two, so it transfers as
  // one and cannot arrive half-updated.
  const states = new Float64Array(samples.length * 6);
  const times = new Float64Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    times[i] = samples[i].t;
    states[i * 6] = samples[i].position.x;
    states[i * 6 + 1] = samples[i].position.y;
    states[i * 6 + 2] = samples[i].position.z;
    states[i * 6 + 3] = samples[i].velocity.x;
    states[i * 6 + 4] = samples[i].velocity.y;
    states[i * 6 + 5] = samples[i].velocity.z;
  }

  const response: AsteroidResponse = {
    id,
    path,
    ride: { times, states, startEpoch: launch.startEpoch },
    summary: outcome.summary,
    fate: outcome.result.fate,
    impact: outcome.impact,
    consequences: outcome.consequences,
    finalEccentricity: outcome.finalEccentricity,
    finalSemiMajorAxisAu: outcome.finalSemiMajorAxisAu,
    closeApproaches: outcome.result.closeApproaches,
    steps: outcome.result.steps,
    elapsedMs: performance.now() - started,
  };

  self.postMessage(response, { transfer: [path.buffer, times.buffer, states.buffer] });
};
