import { describe, expect, it } from "vitest";
import { createViewport } from "./viewport";
import { heliocentricPositionOf } from "@solar/engine/bodies/position";
import { SECONDS_PER_DAY } from "@solar/engine/units";
import { length, sub } from "@solar/engine/vec";
import type { JdTdb } from "@solar/engine/time";
import { PerspectiveCamera } from "three";

/** The frame loop refuses to run without a camera; nothing here reads anything off it. */
function stubCamera(): PerspectiveCamera {
  return new PerspectiveCamera(45, 1.5, 1, 1e9);
}

/**
 * Riding a launched object, which is implemented by moving the floating origin onto it.
 *
 * That one sentence is the whole feature, and it is also why it needs a test here rather than
 * only on screen: nothing about a camera is involved, so nothing about a camera can confirm
 * it. What can be confirmed is that the origin the whole scene is drawn relative to lands on
 * the object's interpolated position and tracks it as the clock runs.
 *
 * The iOS client does the same thing with the same shared interpolation, so a divergence here
 * is a divergence between the two riders.
 */

/** A straight-line trajectory, which makes the expected position arithmetic rather than a fit. */
function straightLine(startEpoch: number) {
  const base = heliocentricPositionOf("mars", startEpoch as JdTdb);
  const count = 11;
  const times = new Float64Array(count);
  const states = new Float64Array(count * 6);
  const speed = 6_000;
  for (let i = 0; i < count; i++) {
    const t = i * SECONDS_PER_DAY;
    times[i] = t;
    states[i * 6] = base.x + speed * t;
    states[i * 6 + 1] = base.y;
    states[i * 6 + 2] = base.z;
    states[i * 6 + 3] = speed;
    states[i * 6 + 4] = 0;
    states[i * 6 + 5] = 0;
  }
  return { times, states, startEpoch, base, speed };
}

describe("riding a launched object", () => {
  const startEpoch = 2_451_545;

  it("offers nothing to ride until something is launched", () => {
    const viewport = createViewport({ initialFocus: "mars" });
    expect(viewport.snapshot().hasTrajectory).toBe(false);

    // And refuses to ride, rather than riding an empty path and putting the origin at zero,
    // which would silently teleport the camera to the Sun.
    viewport.setRiding(true);
    expect(viewport.snapshot().riding).toBe(false);
  });

  it("accepts a trajectory and only then offers the ride", () => {
    const viewport = createViewport({ initialFocus: "mars" });
    viewport.setRide(straightLine(startEpoch));
    expect(viewport.snapshot().hasTrajectory).toBe(true);
    // Not riding yet: handing over a path is not the same as climbing onto it.
    expect(viewport.snapshot().riding).toBe(false);

    viewport.setRiding(true);
    expect(viewport.snapshot().riding).toBe(true);
  });

  it("puts the floating origin on the object and keeps it there as the clock runs", () => {
    const viewport = createViewport({ initialFocus: "mars" });
    const path = straightLine(startEpoch);
    viewport.setRide(path);
    viewport.setRiding(true);

    // The frame loop is what moves the origin, and it does nothing until a camera is bound.
    viewport.setCamera(stubCamera());
    viewport.send({ kind: "pause" });
    viewport.send({ kind: "scrubTo", epoch: startEpoch as JdTdb });
    viewport.advance(0);

    const atRelease = viewport.debug().origin as { x: number; y: number; z: number };
    expect(length(sub(atRelease, path.base))).toBeLessThan(1);

    // Two days in, the object has travelled speed * 2 days along x and the origin follows.
    const twoDays = 2 * SECONDS_PER_DAY;
    viewport.send({ kind: "scrubTo", epoch: (startEpoch + 2) as JdTdb });
    viewport.advance(0);
    const later = viewport.debug().origin as { x: number; y: number; z: number };
    expect(later.x - path.base.x).toBeCloseTo(path.speed * twoDays, 1);
    expect(later.y).toBeCloseTo(path.base.y, 1);
  });

  /**
   * Stepping off puts the origin back on the focused body.
   *
   * Worth asserting because the two code paths are not symmetric: riding reads an interpolated
   * position and not riding reads a resolved body position, so a stale flag leaves the camera
   * on a rock that is no longer being drawn.
   */
  it("returns the origin to the focused body when the ride stops", () => {
    const viewport = createViewport({ initialFocus: "mars" });
    viewport.setRide(straightLine(startEpoch));
    viewport.setRiding(true);
    viewport.setCamera(stubCamera());
    viewport.send({ kind: "pause" });
    viewport.send({ kind: "scrubTo", epoch: (startEpoch + 2) as JdTdb });
    viewport.advance(0);

    viewport.setRiding(false);
    viewport.advance(0);
    const origin = viewport.debug().origin as { x: number; y: number; z: number };
    const mars = heliocentricPositionOf("mars", (startEpoch + 2) as JdTdb);
    expect(length(sub(origin, mars))).toBeLessThan(1);
  });

  it("drops the trajectory when it is cleared", () => {
    const viewport = createViewport({ initialFocus: "mars" });
    viewport.setRide(straightLine(startEpoch));
    viewport.setRiding(true);
    viewport.setRide(null);
    expect(viewport.snapshot().hasTrajectory).toBe(false);
    expect(viewport.snapshot().riding).toBe(false);
  });
});
