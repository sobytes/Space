/**
 * The depth plan: how to see a crater and Neptune's orbit in the same frame.
 *
 * Three separate things break across ten orders of magnitude, and this module owns exactly one
 * of them. Camera-relative placement handles float32 vertex positions and matrix concatenation.
 * The depth buffer is the third, and it fails differently: a perspective projection spends most
 * of its depth precision near the far plane, so once the far-to-near ratio grows large enough,
 * surfaces metres apart start fighting for the same depth value.
 *
 * `logarithmicDepthBuffer` buys roughly 1e7 of usable ratio. That is not enough on its own for a
 * 1e10 scene, so the near and far planes have to track the camera. This module is the pure
 * function that does that, kept free of three.js so its gate is a unit test rather than a
 * screenshot. The project's predicate P8 rests on it.
 */

/**
 * The far-to-near ratio a logarithmic depth buffer resolves without visible z-fighting.
 *
 * Treat a change to this number as a change to the gate, not a tuning knob. It is the budget
 * `planDepth` spends, and `depth.test.ts` asserts every plan across ten decades stays inside it.
 */
export const MAX_DEPTH_RATIO = 1e7;

/** Closest the near plane may ever sit, in metres. Below this, a crater rim self-intersects. */
export const MIN_NEAR_METRES = 0.5;

export interface DepthPlan {
  readonly near: number;
  readonly far: number;
  /**
   * Where a blended `gl_FragDepth` would hand over from a linear near range to a logarithmic far
   * range, the technique NASA's Eyes uses. Computed here so the material override is a later
   * change with a number already waiting for it, rather than a redesign.
   */
  readonly blendDistance: number;
}

export interface DepthInputs {
  /** Camera to the focused body's surface, metres. Never negative; clamped if it is. */
  readonly distanceToFocusSurface: number;
  /** Radius of the body being looked at, metres. */
  readonly focusRadius: number;
  /** Distance to the furthest thing that must stay drawn, metres. */
  readonly sceneRadius: number;
}

/**
 * Near sits a tenth of the way to the focused surface, so the body never clips as you approach,
 * and is capped at the body's own radius so a distant view does not push near out past the
 * target. Far reaches whatever has to stay visible. If that pair would exceed the depth budget,
 * far is pulled in rather than near pushed out, because losing the furthest orbit line is a
 * smaller error than clipping the thing the user is looking at.
 */
export function planDepth(inputs: DepthInputs): DepthPlan {
  const distance = Math.max(0, inputs.distanceToFocusSurface);
  const near = Math.min(
    Math.max(distance * 0.1, MIN_NEAR_METRES),
    Math.max(inputs.focusRadius, MIN_NEAR_METRES),
  );

  const wanted = Math.max(inputs.sceneRadius * 2, distance * 1e4, near * 1e3);
  const far = Math.min(wanted, near * MAX_DEPTH_RATIO);

  return {
    near,
    far,
    // Geometric mean, so the handover sits midway in log space rather than in linear space,
    // which is the space the precision problem actually lives in.
    blendDistance: Math.sqrt(near * Math.max(inputs.focusRadius, near)),
  };
}
