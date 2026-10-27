"use client";

import { useViewport } from "./ViewportContext";

/**
 * Clicking a planet that is one pixel wide.
 *
 * Raycasting the real mesh fails exactly when you need it, because a distant planet is smaller
 * than a pixel and the ray passes beside it. So picking runs against the Viewport's screen index
 * instead, which carries each body's projected position and apparent radius in float64, with a
 * floor of fourteen pixels on the hit target. Everything in the solar system stays clickable.
 */
export function PickLayer() {
  const viewport = useViewport();

  return (
    <div
      className="absolute inset-0 cursor-crosshair"
      onPointerDown={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const ndcY = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
        const hit = viewport.pickAt(ndcX, ndcY, rect.height);
        if (hit) viewport.setFocus(hit);
      }}
    />
  );
}
