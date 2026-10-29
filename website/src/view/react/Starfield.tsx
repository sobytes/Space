"use client";

import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { AdditiveBlending, BufferAttribute, BufferGeometry, Points } from "three";

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

  if (!geometry) return null;

  return (
    <points ref={points} geometry={geometry} frustumCulled={false} renderOrder={-1}>
      <pointsMaterial
        vertexColors
        size={2.2}
        sizeAttenuation={false}
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
        toneMapped={false}
      />
    </points>
  );
}
