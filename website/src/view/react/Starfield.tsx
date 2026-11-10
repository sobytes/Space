"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial,
} from "three";

/**
 * The real sky, from the Yale Bright Star Catalogue.
 *
 * 9,096 stars in 142 KB as a flat Float32Array: right ascension and declination in radians,
 * visual magnitude, and B-V colour index. Catalogue positions are equatorial J2000, so they get
 * the same obliquity rotation the planet orientations do, otherwise the constellations sit 23
 * degrees out of place relative to the ecliptic the planets move in.
 *
 * The stars are parented to the camera and re-radiused each frame to sit inside the far plane,
 * because the far plane moves by ten orders of magnitude as you fly. They are effectively at
 * infinity, so moving them with the camera is correct rather than a cheat.
 */

const OBLIQUITY_RAD = (84_381.406 / 3600) * (Math.PI / 180);

/** Ballesteros 2012, B-V to effective temperature in kelvin. */
function temperatureFromColourIndex(bv: number): number {
  return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
}

/** A compact blackbody approximation, good enough that Betelgeuse reads red and Rigel blue. */
function rgbFromTemperature(kelvin: number): [number, number, number] {
  const t = Math.min(40_000, Math.max(1_000, kelvin)) / 100;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));

  const red = t <= 66 ? 1 : clamp((329.698_727_446 * Math.pow(t - 60, -0.133_204_759_2)) / 255);
  const green =
    t <= 66
      ? clamp((99.470_802_586 * Math.log(t) - 161.119_568_166) / 255)
      : clamp((288.122_169_528 * Math.pow(t - 60, -0.075_514_849_2)) / 255);
  const blue =
    t >= 66 ? 1 : t <= 19 ? 0 : clamp((138.517_731_223 * Math.log(t - 10) - 305.044_792_730) / 255);

  return [red, green, blue];
}

export function Starfield() {
  const camera = useThree((s) => s.camera);
  const points = useRef<Points>(null);
  const [geometry, setGeometry] = useState<BufferGeometry | null>(null);
  const material = useStarMaterial();

  useEffect(() => {
    let cancelled = false;

    void fetch("/data/bsc5.bin")
      .then((response) => response.arrayBuffer())
      .then((buffer) => {
        if (cancelled) return;
        const raw = new Float32Array(buffer);
        const count = raw.length / 4;

        const positions = new Float32Array(count * 3);
        const colours = new Float32Array(count * 3);
        const sizes = new Float32Array(count);

        for (let i = 0; i < count; i++) {
          const ra = raw[i * 4];
          const dec = raw[i * 4 + 1];
          const magnitude = raw[i * 4 + 2];
          const bv = raw[i * 4 + 3];

          const cosDec = Math.cos(dec);
          const ex = cosDec * Math.cos(ra);
          const ey = cosDec * Math.sin(ra);
          const ez = Math.sin(dec);

          // Equatorial J2000 to ecliptic J2000, the same rotation the planet poles use.
          positions[i * 3] = ex;
          positions[i * 3 + 1] = ey * Math.cos(OBLIQUITY_RAD) + ez * Math.sin(OBLIQUITY_RAD);
          positions[i * 3 + 2] = -ey * Math.sin(OBLIQUITY_RAD) + ez * Math.cos(OBLIQUITY_RAD);

          const [r, g, b] = rgbFromTemperature(temperatureFromColourIndex(bv));
          // Magnitude is logarithmic and inverted: each step of 1 is about 2.5x the flux.
          const brightness = Math.min(1, Math.pow(2.512, (1.5 - magnitude) / 4));
          colours[i * 3] = r * brightness;
          colours[i * 3 + 1] = g * brightness;
          colours[i * 3 + 2] = b * brightness;
          sizes[i] = brightness;
        }

        const built = new BufferGeometry();
        built.setAttribute("position", new BufferAttribute(positions, 3));
        built.setAttribute("color", new BufferAttribute(colours, 3));
        built.setAttribute("aSize", new BufferAttribute(sizes, 1));
        setGeometry(built);
      })
      .catch(() => {
        // A missing catalogue means no stars, not a broken page.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useFrame(() => {
    if (!points.current) return;
    points.current.position.copy(camera.position);
    const radius = camera.far * 0.45;
    points.current.scale.setScalar(radius);
  });

  useEffect(() => () => material.dispose(), [material]);

  if (!geometry) return null;

  return (
    <points
      ref={points}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      renderOrder={-1}
    />
  );
}

/**
 * A sky, rather than a field of identical squares.
 *
 * `aSize` has been computed from each star's magnitude since the catalogue was first loaded and
 * nothing read it: a `PointsMaterial` takes one size for every point, so all 9,096 stars were
 * drawn the same 2.2 pixels and only their colour carried the magnitude. Untextured points are
 * also hard squares. The result was a uniform grid of little white squares at one size, which
 * is what the eye reads as noise rather than as depth, and in the system view it competed with
 * the planets: reported as "its super hard to even see the planet on the axis live with all
 * the dots?".
 *
 * Magnitude now drives the size as well as the brightness, which is what it does in the sky:
 * Sirius is a point you cannot miss and a seventh-magnitude star is barely there. The falloff
 * makes them round. Neither changes a single catalogue position, and the count is unchanged at
 * 9,096 stars, because the fix for a crowded sky is not to throw away stars.
 *
 * The floor on the size matters as much as the range. An earlier pass set it at 0.8 pixels and
 * the sky emptied out at a device pixel ratio of 1: most of a bright star catalogue is faint,
 * and a sub-pixel round point is nothing at all. Thinning the sky was never the fix either.
 */
function useStarMaterial(): ShaderMaterial {
  return useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        // Matching three's own points shader, which folds the device pixel ratio into the size
        // uniform. Without it every star is half size on a retina display.
        uniforms: { uPixelRatio: { value: Math.min(2, window.devicePixelRatio || 1) } },
        vertexShader: `
          attribute float aSize;
          attribute vec3 color;
          varying vec3 vColour;
          uniform float uPixelRatio;
          void main() {
            vColour = color;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            // The catalogue's own range, not an invented one: aSize is the brightness term,
            // which runs from about 0.28 at seventh magnitude to 1 at first and brighter, so
            // this is 2.0 pixels for the faintest star in the sky and 3.7 for Sirius.
            gl_PointSize = (1.4 + 2.3 * aSize) * uPixelRatio;
          }
        `,
        fragmentShader: `
          varying vec3 vColour;
          void main() {
            float d = length(gl_PointCoord - vec2(0.5));
            // Wide enough that a two-pixel star still has a solid centre. A falloff tuned on
            // the bright ones alone makes the faint half of the catalogue disappear.
            float alpha = smoothstep(0.5, 0.24, d);
            if (alpha <= 0.002) discard;
            gl_FragColor = vec4(vColour, alpha);
          }
        `,
      }),
    [],
  );
}
