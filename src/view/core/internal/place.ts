/**
 * The camera-relative conversion from float64 simulation coordinates to float32.
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
 * This is not literally the only float32 write in the view layer, and claiming otherwise would
 * be false. `invariants.test.ts` holds the real list: each additional writer is declared there
 * with the reason it is safe, and an undeclared one fails the build. Orbit lines, for instance,
 * keep vertices in true heliocentric metres because a 500 m error at Neptune is far under a
 * pixel at any distance from which a whole orbit is visible.
 *
 * What this function is, exactly, is the only place a body's transform is written. The eslint
 * zone table guards the import, but it matches on how a path is spelled and a relative import
 * from a sibling directory slips through it, so `invariants.test.ts` scans the source instead.
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
