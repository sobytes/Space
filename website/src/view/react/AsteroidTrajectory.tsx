"use client";

import { useEffect, useMemo } from "react";
import { BufferAttribute, BufferGeometry, Color, Line, LineBasicMaterial } from "three";
import type { AsteroidResponse } from "../workers/asteroid.worker";

/**
 * Draws a propagated trajectory.
 *
 * The worker hands back heliocentric metres in a transferred Float32Array, and this parents
 * into the heliocentric group, so the buffer is used exactly as received with no copy and no
 * conversion. Colour encodes the outcome, because the shape of a path tells you very little
 * and whether it hit something tells you everything.
 */
const FATE_COLOUR: Readonly<Record<string, string>> = {
  impact: "#ff4d3d",
  escaped: "#7cc6ff",
  propagating: "#ffd166",
  "step-limit": "#9aa0a6",
};

export function AsteroidTrajectory({ response }: { response: AsteroidResponse | null }) {
  const line = useMemo(() => {
    if (!response || response.path.length < 6) return null;

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(response.path, 3));

    const built = new Line(
      geometry,
      new LineBasicMaterial({
        color: new Color(FATE_COLOUR[response.fate.kind] ?? "#ffd166"),
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      }),
    );
    built.frustumCulled = false;
    return built;
  }, [response]);

  useEffect(
    () => () => {
      if (!line) return;
      line.geometry.dispose();
      (line.material as LineBasicMaterial).dispose();
    },
    [line],
  );

  if (!line) return null;
  return <primitive object={line} />;
}
