/**
 * Fixed-step integrators over a flat Float64Array state block.
 *
 * Deliberately not a general ODE library. These exist to be fast in the hot loop and small
 * enough to audit, which matters because a subtly wrong integrator produces a trajectory
 * that looks entirely plausible.
 */

export type AccelerationFn = (
  position: readonly [number, number, number],
  velocity: readonly [number, number, number],
  timeSeconds: number,
  out: Float64Array,
) => void;

/**
 * Classical fourth-order Runge-Kutta. Not symplectic, so energy drifts slowly and a long
 * run accumulates a spurious perihelion advance of its own. Any precession measurement
 * built on this must therefore be differential: run the same integrator with and without
 * the term under test, so the numerical artefact is common to both and cancels.
 */
export function rk4Step(
  state: Float64Array,
  timeSeconds: number,
  dt: number,
  acceleration: AccelerationFn,
  scratch: Rk4Scratch,
): void {
  const { k, tmp, accel } = scratch;
  const stageOffset = [0, 0.5, 0.5, 1];

  for (let stage = 0; stage < 4; stage++) {
    const h = dt * stageOffset[stage];
    if (stage === 0) {
      for (let i = 0; i < 6; i++) tmp[i] = state[i];
    } else {
      const prev = k[stage - 1];
      for (let i = 0; i < 6; i++) tmp[i] = state[i] + prev[i] * h;
    }

    acceleration(
      [tmp[0], tmp[1], tmp[2]],
      [tmp[3], tmp[4], tmp[5]],
      timeSeconds + h,
      accel,
    );

    const slope = k[stage];
    slope[0] = tmp[3]; slope[1] = tmp[4]; slope[2] = tmp[5];
    slope[3] = accel[0]; slope[4] = accel[1]; slope[5] = accel[2];
  }

  const sixth = dt / 6;
  for (let i = 0; i < 6; i++) {
    state[i] += sixth * (k[0][i] + 2 * k[1][i] + 2 * k[2][i] + k[3][i]);
  }
}

export interface Rk4Scratch {
  readonly k: readonly Float64Array[];
  readonly tmp: Float64Array;
  readonly accel: Float64Array;
}

export function createRk4Scratch(): Rk4Scratch {
  return {
    k: [new Float64Array(6), new Float64Array(6), new Float64Array(6), new Float64Array(6)],
    tmp: new Float64Array(6),
    accel: new Float64Array(3),
  };
}
