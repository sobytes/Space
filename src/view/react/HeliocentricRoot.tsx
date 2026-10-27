"use client";

import { useEffect, useRef } from "react";
import { Group } from "three";
import { useViewport } from "./ViewportContext";

/**
 * The group that sits at the Sun.
 *
 * Children keep their vertices in true heliocentric metres and this group absorbs the floating
 * origin, so an orbit line or an asteroid trajectory never has to be rebuilt as the camera
 * moves. One group rather than one per feature, because the Viewport places exactly one and
 * two would mean two writers for the same piece of state.
 */
export function HeliocentricRoot({ children }: { children: React.ReactNode }) {
  const viewport = useViewport();
  const root = useRef<Group>(null);

  useEffect(() => {
    if (!root.current) return;
    return viewport.attachHeliocentricRoot(root.current);
  }, [viewport]);

  return <group ref={root}>{children}</group>;
}
