"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
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
 * Reads a slice of viewport state for the UI.
 *
 * `useSyncExternalStore` rather than a ref plus effect, because the viewport is exactly the
 * external store React means. The selectors here all return primitives, so the snapshot
 * allocation inside `getSnapshot` never causes a re-render loop.
 *
 * The viewport publishes at 10 Hz, not per frame. That is the rule that keeps a date label from
 * forcing sixty React renders a second while the scene runs at full rate.
 */
export function useViewportValue<T>(select: (snapshot: ViewportSnapshot) => T): T {
  const viewport = useViewport();
  const subscribe = useCallback(
    (onChange: () => void) => viewport.subscribe(() => onChange()),
    [viewport],
  );
  const getSnapshot = useCallback(() => select(viewport.snapshot()), [viewport, select]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
