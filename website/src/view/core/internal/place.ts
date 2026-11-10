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

import { Matrix4, Vector3, type Object3D } from "three";
import type { BodyFrame } from "@solar/engine/rotation";
import type { Vec3 } from "@solar/engine/vec";

export interface Placement {
  readonly worldPosition: Vec3;
  readonly origin: Vec3;
  readonly radiusMetres: number;
  /** The body's own axes in the J2000 ecliptic, which is render space unswizzled. */
  readonly frame: BodyFrame;
}

/**
 * Scratch, reused every frame. `placeAnchor` runs once per body per publish, and allocating a
 * matrix and three vectors thirty-two times at 10 Hz is garbage for no reason.
 */
const basis = new Matrix4();
const meshX = new Vector3();
const meshY = new Vector3();
const meshZ = new Vector3();

/**
 * Writes a body's transform. The three subtractions happen in float64 and only their results
 * reach the Vector3, which is float32.
 */
export function placeAnchor(node: Object3D, placement: Placement): void {
  const { worldPosition, origin, radiusMetres, frame } = placement;

  node.position.set(
    worldPosition.x - origin.x,
    worldPosition.y - origin.y,
    worldPosition.z - origin.z,
  );
  node.scale.setScalar(radiusMetres);

  /**
   * Orientation as a basis, not as a sequence of angles.
   *
   * This was `rotateY(poleAzimuth)` then `rotateX(tilt)` then `rotateY(spin)`, which is a y-up
   * sequence, and render space is z-up: the engine measures tilt from the ecliptic pole, which
   * is z, and the camera's up vector is z. The result was that the pole it drew came out as the
   * pole it wanted with the components cycled, (y, z, x), which is between 52 and 96 degrees
   * wrong depending on the body. Earth was 68.4 degrees out, which pointed a pole at the camera
   * and made the spin read backwards.
   *
   * Nothing caught it because there was nothing to catch it with. The conformance suite gates
   * the engine and the engine was right; the orbit checks are about where a body is, not which
   * way it faces; and the visual gates count lit pixels and check the focused body is centred,
   * which a planet with its axis in the wrong place passes perfectly.
   *
   * Three named axes and no sequence. The engine's frame says where north and the prime
   * meridian are, the geometry says where the mesh keeps them, and the basis maps one to the
   * other. It is also the same frame `subSolarPoint` answers from, so the hemisphere that is
   * drawn lit and the hemisphere the clock says is lit are now the same hemisphere by
   * construction.
   *
   * Where the mesh keeps them, read off `SphereGeometry` rather than assumed, because assuming
   * it is how a globe ends up a quarter turn out with nothing to say so. The poles are on local
   * +y. An equirectangular map's centre column, longitude zero, is on local +x: at u = 0.5 the
   * generator evaluates phi = pi, where x = -cos(phi) = +1 and z = sin(phi) = 0. Increasing u
   * runs east and decreases z, so east is local -z.
   */
  meshY.set(frame.pole.x, frame.pole.y, frame.pole.z);
  meshX.set(frame.primeMeridian.x, frame.primeMeridian.y, frame.primeMeridian.z);
  // Local -z is east, so local +z is west, which is the prime meridian crossed into the pole.
  meshZ.crossVectors(meshX, meshY);
  basis.makeBasis(meshX, meshY, meshZ);
  node.quaternion.setFromRotationMatrix(basis);

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
