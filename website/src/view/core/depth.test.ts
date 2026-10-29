/**
 * The decade sweep. This is what predicate P8 rests on.
 *
 * P8 says the camera must travel from outside Neptune's orbit to a kilometre above the Moon
 * with no depth artifact. Proving that only with screenshots is slow and subjective, so the
 * numeric half of it lives here: at every scale from a kilometre to ten billion, the depth plan
 * must stay inside the buffer's resolvable ratio, and the near plane must not jump between
 * adjacent decades, because a jump is what a visible seam looks like as a number.
 */

import { describe, expect, it } from "vitest";
import { MAX_DEPTH_RATIO, MIN_NEAR_METRES, planDepth } from "./depth";

const MOON_RADIUS_M = 1_737_400;
const NEPTUNE_ORBIT_M = 4.5e12;

/** A kilometre above the Moon through to well outside Neptune's orbit, ten decades. */
const DECADES = Array.from({ length: 11 }, (_, i) => 10 ** (3 + i));

describe("planDepth across ten orders of magnitude", () => {
  it("never exceeds the depth buffer's resolvable ratio", () => {
    const rows: Record<string, string>[] = [];

    for (const distance of DECADES) {
      const plan = planDepth({
        distanceToFocusSurface: distance,
        focusRadius: MOON_RADIUS_M,
        sceneRadius: NEPTUNE_ORBIT_M,
      });
      const ratio = plan.far / plan.near;

      rows.push({
        "camera distance (m)": distance.toExponential(0),
        near: plan.near.toExponential(3),
        far: plan.far.toExponential(3),
        "far/near": ratio.toExponential(2),
        "share of budget": `${((ratio / MAX_DEPTH_RATIO) * 100).toFixed(1)}%`,
      });

      expect(ratio, `far/near at ${distance.toExponential(0)} m`).toBeLessThanOrEqual(
        MAX_DEPTH_RATIO,
      );
      expect(plan.near, `near at ${distance.toExponential(0)} m`).toBeGreaterThanOrEqual(
        MIN_NEAR_METRES,
      );
      expect(plan.far, `far must exceed near at ${distance.toExponential(0)} m`).toBeGreaterThan(
        plan.near,
      );
    }

    console.table(rows);
  });

  it("never jumps the near plane between adjacent decades, which is what a seam looks like", () => {
    const plans = DECADES.map((distance) =>
      planDepth({
        distanceToFocusSurface: distance,
        focusRadius: MOON_RADIUS_M,
        sceneRadius: NEPTUNE_ORBIT_M,
      }),
    );

    for (let i = 1; i < plans.length; i++) {
      const ratio = plans[i].near / plans[i - 1].near;
      expect(
        ratio,
        `near plane jumps ${ratio.toFixed(1)}x between ${DECADES[i - 1].toExponential(0)} and ${DECADES[i].toExponential(0)} m`,
      ).toBeLessThanOrEqual(10.000_001);
    }
  });

  it("keeps the focused body inside the frustum at every distance", () => {
    for (const distance of DECADES) {
      const plan = planDepth({
        distanceToFocusSurface: distance,
        focusRadius: MOON_RADIUS_M,
        sceneRadius: NEPTUNE_ORBIT_M,
      });
      // Near must sit in front of the surface, or the body clips as you approach.
      expect(plan.near, `near must not clip the surface at ${distance.toExponential(0)} m`).toBeLessThanOrEqual(
        Math.max(distance, MIN_NEAR_METRES),
      );
      // Far must reach past the body, or you see nothing at all.
      expect(plan.far, `far must reach the body at ${distance.toExponential(0)} m`).toBeGreaterThan(
        distance,
      );
    }
  });

  it("survives the degenerate cases without producing a broken frustum", () => {
    const atSurface = planDepth({
      distanceToFocusSurface: 0,
      focusRadius: MOON_RADIUS_M,
      sceneRadius: NEPTUNE_ORBIT_M,
    });
    expect(atSurface.near).toBe(MIN_NEAR_METRES);
    expect(atSurface.far).toBeGreaterThan(atSurface.near);

    const negative = planDepth({
      distanceToFocusSurface: -5,
      focusRadius: MOON_RADIUS_M,
      sceneRadius: NEPTUNE_ORBIT_M,
    });
    expect(negative.near).toBe(MIN_NEAR_METRES);
    expect(Number.isFinite(negative.far)).toBe(true);

    const tinyBody = planDepth({
      distanceToFocusSurface: 1_000,
      focusRadius: 0.5,
      sceneRadius: NEPTUNE_ORBIT_M,
    });
    expect(tinyBody.near).toBeGreaterThanOrEqual(MIN_NEAR_METRES);
    expect(tinyBody.far / tinyBody.near).toBeLessThanOrEqual(MAX_DEPTH_RATIO);
  });

  it("puts the blend distance between the near plane and the body's own scale", () => {
    const plan = planDepth({
      distanceToFocusSurface: 1e5,
      focusRadius: MOON_RADIUS_M,
      sceneRadius: NEPTUNE_ORBIT_M,
    });
    expect(plan.blendDistance).toBeGreaterThanOrEqual(plan.near);
    expect(plan.blendDistance).toBeLessThanOrEqual(MOON_RADIUS_M);
  });
});
