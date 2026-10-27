"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { ACESFilmicToneMapping } from "three";
import { BODY_IDS } from "@/engine/bodies/registry";
import { Body } from "./Body";
import { BodyMarkers } from "./BodyMarkers";
import { CameraRig } from "./CameraRig";
import { Hud } from "./Hud";
import { OrbitPaths } from "./OrbitPaths";
import { PickLayer } from "./PickLayer";
import { Starfield } from "./Starfield";
import { ViewportBinding, ViewportProvider } from "./ViewportContext";

/**
 * `logarithmicDepthBuffer` is set at construction because it is a renderer-construction flag
 * and cannot be toggled afterwards. It is the secondary fix for depth ordering; the
 * load-bearing one is the camera-relative placement inside the Viewport.
 *
 * The provider wraps both the Canvas and the DOM overlay so the HUD reads the same viewport the
 * scene is driven by, without the HUD having to live inside WebGL.
 */
export function Scene() {
  return (
    <ViewportProvider>
      <div className="relative h-dvh w-full overflow-hidden bg-black">
        <Canvas
          gl={{
            logarithmicDepthBuffer: true,
            antialias: true,
            powerPreference: "high-performance",
            toneMapping: ACESFilmicToneMapping,
          }}
          camera={{ fov: 45, near: 1, far: 1e9, position: [0, 3e7, 6e7] }}
          dpr={[1, 2]}
        >
          <ViewportBinding />
          <Starfield />
          <OrbitPaths />
          <BodyMarkers />
          {/* The Sun carries its own light, inside its own group. See Body.tsx. */}
          <ambientLight intensity={0.05} />
          <Suspense fallback={null}>
            {BODY_IDS.map((id) => (
              <Body key={id} id={id} />
            ))}
          </Suspense>
          <CameraRig />
        </Canvas>
        <PickLayer />
        <Hud />
      </div>
    </ViewportProvider>
  );
}
