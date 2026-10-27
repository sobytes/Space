/**
 * Two vector representations, on purpose.
 *
 * `Vec3` is an immutable record used across the engine's public surface, where clarity beats
 * allocation count. `Float64Array` state blocks are used inside the integrators, where a
 * 20-body step allocating three records per body per substage would dominate the cost.
 *
 * Everything here is float64. The engine never computes in float32; that conversion happens
 * once, at the renderer, relative to the camera.
 */

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const neg = (a: Vec3): Vec3 => ({ x: -a.x, y: -a.y, z: -a.z });

export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

export const lengthSquared = (a: Vec3): number => a.x * a.x + a.y * a.y + a.z * a.z;
export const length = (a: Vec3): number => Math.sqrt(lengthSquared(a));
export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));

export function normalize(a: Vec3): Vec3 {
  const len = length(a);
  return len === 0 ? ZERO : scale(a, 1 / len);
}

/** Angle between two vectors, clamped because round-off pushes the cosine past 1. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const denom = length(a) * length(b);
  if (denom === 0) return 0;
  return Math.acos(Math.min(1, Math.max(-1, dot(a, b) / denom)));
}

/** Right-handed rotation about the x axis, used for the ecliptic-to-equatorial tilt. */
export function rotateX(a: Vec3, radians: number): Vec3 {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return { x: a.x, y: a.y * c - a.z * s, z: a.y * s + a.z * c };
}

export function rotateY(a: Vec3, radians: number): Vec3 {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return { x: a.x * c + a.z * s, y: a.y, z: -a.x * s + a.z * c };
}

export function rotateZ(a: Vec3, radians: number): Vec3 {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c, z: a.z };
}

/** Position and velocity together. Metres and metres per second, always. */
export interface StateVector {
  readonly position: Vec3;
  readonly velocity: Vec3;
}

export const STATE_STRIDE = 6;

export function readState(block: Float64Array, index: number): StateVector {
  const o = index * STATE_STRIDE;
  return {
    position: { x: block[o], y: block[o + 1], z: block[o + 2] },
    velocity: { x: block[o + 3], y: block[o + 4], z: block[o + 5] },
  };
}

export function writeState(block: Float64Array, index: number, state: StateVector): void {
  const o = index * STATE_STRIDE;
  block[o] = state.position.x;
  block[o + 1] = state.position.y;
  block[o + 2] = state.position.z;
  block[o + 3] = state.velocity.x;
  block[o + 4] = state.velocity.y;
  block[o + 5] = state.velocity.z;
}
