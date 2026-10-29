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
import type { CloseApproach, Fate } from "@solar/engine/propagate";

export interface AsteroidRequest {
  readonly id: number;
  readonly launch: AsteroidLaunch;
}

export interface AsteroidResponse {
  readonly id: number;
  /** Flat xyz triples in heliocentric metres. */
  readonly path: Float32Array;
  readonly summary: string;
  readonly fate: Fate;
  readonly impact: ImpactEstimate | null;
  readonly finalEccentricity: number;
  readonly finalSemiMajorAxisAu: number | null;
  readonly closeApproaches: readonly CloseApproach[];
  readonly steps: number;
  readonly elapsedMs: number;
}

self.onmessage = (event: MessageEvent<AsteroidRequest>) => {
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

  const response: AsteroidResponse = {
    id,
    path,
    summary: outcome.summary,
    fate: outcome.result.fate,
    impact: outcome.impact,
    finalEccentricity: outcome.finalEccentricity,
    finalSemiMajorAxisAu: outcome.finalSemiMajorAxisAu,
    closeApproaches: outcome.result.closeApproaches,
    steps: outcome.result.steps,
    elapsedMs: performance.now() - started,
  };

  self.postMessage(response, { transfer: [path.buffer] });
};
