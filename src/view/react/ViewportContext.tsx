"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { PerspectiveCamera } from "three";
import { createViewport, type Viewport, type ViewportSnapshot } from "../core/viewport";

const Context = createContext<Viewport | null>(null);

export function useViewport(): Viewport {
  const viewport = useContext(Context);
  if (!viewport) throw new Error("useViewport must be used inside ViewportProvider");
  return viewport;
}

/**
 * Wraps both the Canvas and the DOM overlay, because the time controls and the body panel are
 * HTML and the scene is WebGL, and both read the same viewport. The camera only exists inside
 * the Canvas, so `ViewportBinding` hands it over and owns the one frame callback.
 */
export function ViewportProvider({ children }: { children: React.ReactNode }) {
  const viewport = useMemo(() => createViewport({ initialFocus: "embary" }), []);
  return <Context value={viewport}>{children}</Context>;
}

/** Lives inside the Canvas. The single useFrame subscriber in the application. */
export function ViewportBinding() {
  const viewport = useViewport();
  const camera = useThree((s) => s.camera) as PerspectiveCamera;

  useEffect(() => {
    viewport.setCamera(camera);
  }, [viewport, camera]);

  useEffect(() => {
    (window as unknown as { __solar?: unknown }).__solar = viewport;
  }, [viewport]);

  useFrame((_, delta) => viewport.advance(delta));
  return null;
}

/**
 * Reads a slice of viewport state for the UI. The viewport publishes at 10 Hz rather than per
 * frame, which is why a date label does not force sixty React renders a second.
 */
export function useViewportValue<T>(select: (snapshot: ViewportSnapshot) => T): T {
  const viewport = useViewport();
  const [value, setValue] = useState(() => select(viewport.snapshot()));
  const selectRef = useRef(select);
  selectRef.current = select;

  useEffect(
    () =>
      viewport.subscribe((snapshot) => {
        const next = selectRef.current(snapshot);
        setValue((previous) => (Object.is(previous, next) ? previous : next));
      }),
    [viewport],
  );

  return value;
}
