"use client";

import { useEffect } from "react";
import type { AsteroidResponse } from "../workers/asteroid.worker";
import { useViewport } from "./ViewportContext";

/**
 * Hands a completed propagation to the viewport, so the camera can be put on it.
 *
 * Its own component rather than an effect inside the panel, because the panel unmounts when
 * the overlay is hidden and the trajectory should survive that. Rendering nothing is the
 * point: this exists purely to connect the worker's output to the floating origin.
 */
export function RideBinding({ response }: { response: AsteroidResponse | null }) {
  const viewport = useViewport();

  useEffect(() => {
    viewport.setRide(response ? response.ride : null);
  }, [viewport, response]);

  return null;
}
