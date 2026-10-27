"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
} from "three";
import { BODY_CONTRACTS, BODY_IDS } from "@/engine/bodies/registry";
import { useViewport } from "./ViewportContext";

/**
 * Markers for bodies too small to see as geometry.
 *
 * From anywhere useful in the solar system, most planets are well under a pixel across. Drawing
 * them at a fake size would be a lie about scale, which is the one thing this project will not
 * do. Instead each body gets a soft screen-space dot in its own colour that fades out as the
 * real sphere becomes resolvable, so scale stays honest and nothing becomes invisible.
 *
 * The position buffer is written by the Viewport, not here, so the rule that one object owns
 * every scale-critical write still holds.
 */
export function BodyMarkers() {
  const viewport = useViewport();
  const points = useRef<Points>(null);

  const { geometry, material } = useMemo(() => {
    const count = BODY_IDS.length;
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute("aSize", new BufferAttribute(new Float32Array(count), 1));

    const colours = new Float32Array(count * 3);
    BODY_IDS.forEach((id, index) => {
      const colour = new Color(BODY_CONTRACTS[id].appearance.tint);
      colours[index * 3] = colour.r;
      colours[index * 3 + 1] = colour.g;
      colours[index * 3 + 2] = colour.b;
    });
    geo.setAttribute("aColour", new BufferAttribute(colours, 3));

    const mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      // Set at creation. The whole scene is behind an ssr:false boundary, so window exists.
      uniforms: { uPixelRatio: { value: Math.min(2, window.devicePixelRatio || 1) } },
      vertexShader: `
        attribute float aSize;
        attribute vec3 aColour;
        varying float vFade;
        varying vec3 vColour;
        uniform float uPixelRatio;
        void main() {
          vFade = aSize;
          vColour = aColour;
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * viewPosition;
          gl_PointSize = (4.0 + 7.0 * aSize) * uPixelRatio;
        }
      `,
      fragmentShader: `
        varying float vFade;
        varying vec3 vColour;
        void main() {
          if (vFade <= 0.001) discard;
          // A soft radial falloff reads as a glow rather than a hard square sprite.
          float d = length(gl_PointCoord - vec2(0.5));
          float alpha = smoothstep(0.5, 0.08, d) * vFade;
          gl_FragColor = vec4(vColour, alpha);
        }
      `,
    });

    return { geometry: geo, material: mat };
  }, []);

  useEffect(() => {
    if (!points.current) return;
    return viewport.attachMarkers(points.current);
  }, [viewport]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  return (
    <points ref={points} geometry={geometry} material={material} frustumCulled={false} renderOrder={2} />
  );
}
