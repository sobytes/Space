/**
 * The gate that would have caught a planet facing the wrong way.
 *
 * There was none, which is why this shipped. The conformance suite gates the engine and the
 * engine was right about every pole it was asked for. The orbit tests are about where a body
 * is, not which way it faces. The visual probes count lit pixels and check the focused body is
 * centred in frame, and a planet with its spin axis sixty-eight degrees from its pole passes
 * both of those perfectly: it is still round, still lit, still in the middle.
 *
 * What was missing is anything that read the transform the renderer actually wrote. These do,
 * by calling `placeAnchor` exactly as the Viewport calls it and then asking the resulting
 * matrix where a given point on the body ended up.
 *
 * The last test is the one that matters most. It ties the drawn globe to `subSolarPoint`, the
 * same function the clock panel and the time-zone list read, so the hemisphere drawn lit and
 * the hemisphere reported lit cannot drift apart again. That is the failure this project has
 * now had twice, once per client: Chicago listed in daylight with North America drawn in the
 * dark on iOS, and here a globe spinning about an axis the Sun knew nothing about.
 */

import { describe, expect, it } from "vitest";
import { Object3D, Vector3 } from "three";
import { BODY_IDS, type BodyId } from "@solar/engine/bodies/registry";
import { heliocentricPositionOf } from "@solar/engine/bodies/position";
import { bodyFrameOf } from "@solar/engine/rotation";
import { subSolarPoint } from "@solar/engine/solar-time";
import { J2000_JD, type JdTdb } from "@solar/engine/time";
import { placeAnchor } from "./internal/place";

/**
 * Four instants rather than one. A single epoch cannot tell a correct frame from one that
 * happens to agree at that moment, and the spin is the fastest-moving part of it: Jupiter
 * turns 870 degrees a day, so two samples a quarter day apart are two completely different
 * orientations of the same planet.
 */
const EPOCHS: readonly JdTdb[] = [
  J2000_JD as JdTdb,
  (J2000_JD + 0.37) as JdTdb,
  (J2000_JD + 9_809) as JdTdb,
  (J2000_JD - 4_212.5) as JdTdb,
];

/** The transform the Viewport writes, with the body at the render origin. */
function placed(body: BodyId, epoch: JdTdb): Object3D {
  const node = new Object3D();
  node.matrixAutoUpdate = false;
  placeAnchor(node, {
    worldPosition: { x: 0, y: 0, z: 0 },
    origin: { x: 0, y: 0, z: 0 },
    radiusMetres: 1,
    frame: bodyFrameOf(body, epoch),
  });
  return node;
}

/** A direction in the mesh's own frame, out through the given point on the surface. */
function meshDirection(latitudeDeg: number, longitudeDegEast: number): Vector3 {
  const lat = (latitudeDeg * Math.PI) / 180;
  const lon = (longitudeDegEast * Math.PI) / 180;
  // North is local +y, longitude zero is local +x, and east is local -z. See `placeAnchor`.
  return new Vector3(
    Math.cos(lat) * Math.cos(lon),
    Math.sin(lat),
    -Math.cos(lat) * Math.sin(lon),
  );
}

/** Where a point on the body points once the Viewport's transform has been applied. */
function drawnDirection(node: Object3D, latitudeDeg: number, longitudeDegEast: number): Vector3 {
  return meshDirection(latitudeDeg, longitudeDegEast)
    .applyQuaternion(node.quaternion)
    .normalize();
}

function degreesBetween(a: Vector3, b: Vector3): number {
  return (Math.acos(Math.min(1, Math.max(-1, a.dot(b)))) * 180) / Math.PI;
}

/**
 * A ten-thousandth of a degree, which is a third of a milliarcsecond.
 *
 * Not zero, and not because the frame is approximate. `acos` is ill-conditioned next to an
 * argument of one: a dot product one float64 ulp short of unity comes back as about 1e-8
 * radians of angle, so the measurement's own noise floor is a few microdegrees however exact
 * the rotation is. Titan and Tethys land on 1.2e-6 degrees and would fail a bar set at 1e-6
 * for no reason anyone could act on.
 *
 * The errors this is here to catch are 52 to 96 degrees, and the subtlest one it has to catch,
 * a quarter turn of texture, is 90. Anything between a milliarcsecond and a degree is not a
 * bug this gate was written for and would be a different investigation.
 */
const EXACT_DEG = 1e-4;

describe("the axis a body is drawn about", () => {
  it.each(EPOCHS)("is the IAU pole, for every body, at %f", (epoch) => {
    for (const id of BODY_IDS) {
      const pole = bodyFrameOf(id, epoch).pole;
      const want = new Vector3(pole.x, pole.y, pole.z);
      const drawn = drawnDirection(placed(id, epoch), 90, 0);
      expect(
        degreesBetween(drawn, want),
        `${id} draws its north pole ${degreesBetween(drawn, want).toFixed(1)} degrees from the `
        + "IAU pole. A y-up Euler sequence in z-up render space is how this last happened.",
      ).toBeLessThan(EXACT_DEG);
    }
  });

  it.each(EPOCHS)("puts longitude zero on the IAU prime meridian, at %f", (epoch) => {
    for (const id of BODY_IDS) {
      const meridian = bodyFrameOf(id, epoch).primeMeridian;
      const want = new Vector3(meridian.x, meridian.y, meridian.z);
      const drawn = drawnDirection(placed(id, epoch), 0, 0);
      expect(
        degreesBetween(drawn, want),
        `${id} draws the centre column of its map ${degreesBetween(drawn, want).toFixed(1)} `
        + "degrees from its prime meridian. A quarter turn here is six hours of rotation.",
      ).toBeLessThan(EXACT_DEG);
    }
  });

  it.each(EPOCHS)("runs east the way the body turns, at %f", (epoch) => {
    for (const id of BODY_IDS) {
      const east = bodyFrameOf(id, epoch).east;
      const want = new Vector3(east.x, east.y, east.z);
      const drawn = drawnDirection(placed(id, epoch), 0, 90);
      expect(
        degreesBetween(drawn, want),
        `${id} draws east 180 degrees from east, which is a mirrored planet: every `
        + "continent in the right place and the whole globe turning backwards.",
      ).toBeLessThan(EXACT_DEG);
    }
  });
});

describe("the drawn globe and the clock agree about which half is lit", () => {
  it.each(EPOCHS)("points the sub-solar point at the Sun, at %f", (epoch) => {
    for (const id of BODY_IDS) {
      const subSolar = subSolarPoint(id, epoch);
      // Null only for the Sun, which has no sub-solar point of its own to check.
      if (subSolar === null) continue;

      const position = heliocentricPositionOf(id, epoch);
      const toSun = new Vector3(-position.x, -position.y, -position.z).normalize();
      const drawn = drawnDirection(
        placed(id, epoch),
        subSolar.latitudeDeg,
        subSolar.longitudeDeg,
      );

      expect(
        degreesBetween(drawn, toSun),
        `the point ${id} draws facing the Sun is ${degreesBetween(drawn, toSun).toFixed(1)} `
        + "degrees from the point the clock says the Sun is over. One of them is lying to "
        + "somebody: the globe shows one hemisphere in daylight and the panel names the other.",
      ).toBeLessThan(EXACT_DEG);
    }
  });
});
