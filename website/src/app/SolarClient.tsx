"use client";

import dynamic from "next/dynamic";

/**
 * The WebGL boundary.
 *
 * `ssr: false` is still an error inside a Server Component in Next 16, so it has to live behind
 * a `'use client'` module. three.js touches browser globals at import time, so the scene must
 * never be evaluated on the server at all.
 */
const Scene = dynamic(() => import("@/view/react/Scene").then((m) => m.Scene), {
  ssr: false,
  loading: () => (
    <div className="flex h-dvh w-full items-center justify-center bg-black">
      <div className="text-center">
        <p className="font-mono text-sm tracking-widest text-amber-300/80">LOADING EPHEMERIS</p>
        <p className="mt-2 text-xs text-zinc-600">
          JPL Standish elements, IAU rotational elements, 9,096 stars
        </p>
      </div>
    </div>
  ),
});

export function SolarClient() {
  return <Scene />;
}
