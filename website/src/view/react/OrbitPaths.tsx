"use client";

import { useEffect, useMemo } from "react";
import { BufferAttribute, BufferGeometry, LineBasicMaterial, LineLoop } from "three";
import { BODY_CONTRACTS, BODY_IDS, type BodyId } from "@solar/engine/bodies/registry";
import { SHORT_SPAN, type PlanetId } from "@solar/engine/data/planets";
import { heliocentricPosition } from "@solar/engine/kepler";
import { J2000_JD, jdTdb } from "@solar/engine/time";
import type { ViewportSnapshot } from "../core/viewport";
import { useViewportValue } from "./ViewportContext";

const SAMPLES = 512;

/** Mean longitude advances 360 degrees in one orbit, and the table gives its rate per century. */
function orbitalPeriodDays(planet: PlanetId): number {
  return (360 / SHORT_SPAN.elements[planet].ratePerCentury.meanLongitudeDeg) * 36_525;
}

/**
 * Orbit paths, sampled from the same Kepler solver that positions the planets.
 *
 * Sampling the real propagator rather than drawing an idealised ellipse matters: the elements
 * drift with time, so the drawn path is the orbit the engine will actually follow rather than a
 * decorative approximation of it. Samples are even in time, which naturally clusters vertices
 * near aphelion where the body moves slowest and the curve is flattest.
 *
 * Vertices stay in true heliocentric metres. Those are large float32 values carrying roughly
 * 500 m of error at Neptune, which is far under one pixel at any distance from which a whole
 * orbit fits on screen. The invariant that matters is not "never a large float32 number", it is
 * "never a float32 error you can resolve". The parent group absorbs the floating origin, so
 * nothing here is rebuilt as the camera moves.
 */
function buildOrbit(planet: PlanetId, colour: string): LineLoop {
  const periodDays = orbitalPeriodDays(planet);
  const positions = new Float32Array(SAMPLES * 3);

  for (let i = 0; i < SAMPLES; i++) {
    const p = heliocentricPosition(planet, jdTdb(J2000_JD + (periodDays * i) / SAMPLES));
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));

  const loop = new LineLoop(
    geometry,
    new LineBasicMaterial({ color: colour, transparent: true, opacity: 0.4, depthWrite: false }),
  );
  loop.frustumCulled = false;
  return loop;
}

const selectFocus = (s: ViewportSnapshot) => s.focus;

export function OrbitPaths() {
  const focus = useViewportValue(selectFocus);

  const orbits = useMemo(() => {
    const built: { id: BodyId; line: LineLoop }[] = [];
    for (const id of BODY_IDS) {
      const contract = BODY_CONTRACTS[id];
      if (contract.ephemeris.kind !== "standish-elements") continue;
      built.push({ id, line: buildOrbit(contract.ephemeris.planet, contract.appearance.tint) });
    }
    return built;
  }, []);

  useEffect(
    () => () => {
      for (const { line } of orbits) {
        line.geometry.dispose();
        (line.material as LineBasicMaterial).dispose();
      }
    },
    [orbits],
  );

  return (
    <>
      {orbits.map(({ id, line }) => (
        // r3f's piercing props set the material declaratively, so the focused orbit brightens
        // without anyone mutating an object a hook owns.
        <primitive key={id} object={line} material-opacity={id === focus ? 0.95 : 0.4} />
      ))}
    </>
  );
}
