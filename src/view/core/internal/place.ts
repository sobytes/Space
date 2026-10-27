/**
 * The only place in this repository where a float64 simulation coordinate becomes float32.
 *
 * Everything in src/engine computes in plain JS doubles, in metres, heliocentric. The GPU
 * stores vertex positions and matrices in float32, which carries about seven decimal digits.
 * At Neptune's 4.5e12 m that is half a million metres of error per coordinate, so writing a
 * true world position into a THREE.Vector3 destroys the scene before any shader runs.
 *
 * The fix is to subtract the camera's true position first, in float64. Because the camera is
 * near whatever you are looking at, the result is small, and float32 has ample precision for
 * a small number. Distant bodies lose precision, which does not matter, because they are
 * distant. This is the whole floating-origin technique in one subtraction.
 *
 * `internal/` is unreachable from outside src/view/core via the eslint zone table, so no other
 * module can route around this function.
 */

import type { Object3D } from "three";
import type { Vec3 } from "@/engine/vec";

export interface Placement {
  readonly worldPosition: Vec3;
  readonly origin: Vec3;
  readonly radiusMetres: number;
  readonly spinRadians: number;
  readonly tiltRadians: number;
  readonly poleAzimuthRadians: number;
}

/**
 * Writes a body's transform. The three subtractions happen in float64 and only their results
 * reach the Vector3, which is float32.
 */
export function placeAnchor(node: Object3D, placement: Placement): void {
  const { worldPosition, origin, radiusMetres } = placement;

  node.position.set(
    worldPosition.x - origin.x,
    worldPosition.y - origin.y,
    worldPosition.z - origin.z,
  );
  node.scale.setScalar(radiusMetres);

  // Orientation order matters: swing the pole into its sky direction, tilt it, then spin about
  // it. Applying spin before tilt would wobble the body instead of rotating it.
  node.rotation.set(0, 0, 0);
  node.rotateY(placement.poleAzimuthRadians);
  node.rotateX(placement.tiltRadians);
  node.rotateY(placement.spinRadians);

  // matrixAutoUpdate is off on attached nodes so three.js cannot overwrite the Viewport's
  // write. The cost of that is having to mark the world matrix dirty by hand: without this
  // line three recomposes matrixWorld once and then never again, leaving every body at
  // identity, which renders as a one-metre sphere at the origin and looks like nothing at all.
  node.updateMatrix();
  node.matrixWorldNeedsUpdate = true;
}

/** Camera-relative delta as plain numbers, for projection maths that never touches three. */
export function relativeTo(worldPosition: Vec3, origin: Vec3): Vec3 {
  return {
    x: worldPosition.x - origin.x,
    y: worldPosition.y - origin.y,
    z: worldPosition.z - origin.z,
  };
}
