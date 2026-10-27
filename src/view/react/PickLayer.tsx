"use client";

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { useViewport } from "./ViewportContext";

/**
 * Clicking a planet that is one pixel wide.
 *
 * Raycasting the real mesh fails exactly when you need it, because a distant planet is smaller
 * than a pixel and the ray passes beside it. So picking runs against the Viewport's screen
 * index instead, which carries each body's projected position and apparent radius in float64,
 * with a floor of fourteen pixels on the hit target.
 *
 * The listener is attached to the canvas itself rather than to an overlay div. The first
 * version used an absolutely positioned div across the viewport, which worked for clicks and
 * silently broke every other interaction: camera-controls listens on the canvas, so the
 * overlay swallowed wheel and drag events and the mouse could not orbit or zoom at all. An
 * overlay that captures pointer events sitting on top of a canvas that needs them is a
 * mistake that only shows up when you try to drive the thing.
 */
export function PickLayer() {
  const viewport = useViewport();
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    const canvas = gl.domElement;

    let downX = 0;
    let downY = 0;

    const onDown = (event: PointerEvent) => {
      downX = event.clientX;
      downY = event.clientY;
    };

    const onUp = (event: PointerEvent) => {
      // A drag is a camera move, not a selection. Only a near-stationary press selects.
      if (Math.hypot(event.clientX - downX, event.clientY - downY) > 4) return;

      const rect = canvas.getBoundingClientRect();
      const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
      const hit = viewport.pickAt(ndcX, ndcY, rect.height);
      if (hit) viewport.setFocus(hit);
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
    };
  }, [viewport, gl]);

  return null;
}
