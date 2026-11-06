"use client";

import { Fragment, useEffect, useMemo, useRef } from "react";
import {
  BufferAttribute, BufferGeometry, Group, LineBasicMaterial, LineLoop, Points, PointsMaterial,
} from "three";
import { BODY_CONTRACTS, BODY_IDS, type BodyId } from "@solar/engine/bodies/registry";
import { heliocentricPositionOf } from "@solar/engine/bodies/position";
import { SHORT_SPAN, type PlanetId } from "@solar/engine/data/planets";
import { MAX_MARKS, orbitTimeMarks } from "@solar/engine/orbit-time";
import { J2000_JD, jdTdb } from "@solar/engine/time";
import type { ViewportSnapshot } from "../core/viewport";
import { useViewport, useViewportValue } from "./ViewportContext";

const SAMPLES = 512;

/** Mean longitude advances 360 degrees in one orbit, and the table gives its rate per century. */
function orbitalPeriodDays(planet: PlanetId): number {
  return (360 / SHORT_SPAN.elements[planet].ratePerCentury.meanLongitudeDeg) * 36_525;
}

/**
 * Orbit paths, sampled from the same solver that positions the body.
 *
 * Sampling the real ephemeris rather than drawing an idealised ellipse matters: the elements
 * drift with time, so the drawn path is the orbit the engine will actually follow rather than a
 * decorative approximation of it. Samples are even in time, which naturally clusters vertices
 * near apoapsis where the body moves slowest and the curve is flattest.
 *
 * A planet's vertices stay in true heliocentric metres. Those are large float32 values carrying
 * roughly 500 m of error at Neptune, which is far under one pixel at any distance from which a
 * whole orbit fits on screen. The invariant that matters is not "never a large float32 number",
 * it is "never a float32 error you can resolve". The parent group absorbs the floating origin,
 * so nothing here is rebuilt as the camera moves.
 *
 * A moon's vertices are relative to its planet, and `parent` is what makes that true. Sampled
 * heliocentrically, a moon's path over one of its own periods is dominated by where its planet
 * went in that time rather than by the orbit: Phobos goes round Mars in 7.7 hours, during which
 * Mars travels 660,000 km along its own orbit while Phobos stays within 9,400 km of it. The
 * drawn path came out as a straight streak seventy times longer than the orbit it was meant to
 * show. Subtracting the parent at the same instant leaves the ellipse.
 */
export function orbitSamples(
  id: BodyId,
  periodDays: number,
  parent: BodyId | null,
): Float32Array {
  const positions = new Float32Array(SAMPLES * 3);

  for (let i = 0; i < SAMPLES; i++) {
    const at = jdTdb(J2000_JD + (periodDays * i) / SAMPLES);
    const p = heliocentricPositionOf(id, at);
    const origin = parent ? heliocentricPositionOf(parent, at) : null;
    positions[i * 3] = origin ? p.x - origin.x : p.x;
    positions[i * 3 + 1] = origin ? p.y - origin.y : p.y;
    positions[i * 3 + 2] = origin ? p.z - origin.z : p.z;
  }

  return positions;
}

function buildOrbit(id: BodyId, periodDays: number, parent: BodyId | null, colour: string): LineLoop {
  const positions = orbitSamples(id, periodDays, parent);

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));

  const loop = new LineLoop(
    geometry,
    new LineBasicMaterial({ color: colour, transparent: true, opacity: 0.4, depthWrite: false }),
  );
  loop.frustumCulled = false;
  return loop;
}

interface Orbit {
  readonly id: BodyId;
  readonly parent: BodyId | null;
  readonly periodDays: number;
  readonly line: LineLoop;
}

/**
 * Where the body will be, at equal intervals of time, counted from now.
 *
 * An orbit line says where a body goes and nothing about when, which is half of what there is
 * to watch. These are sampled from the same ephemeris that drew the line and positioned at the
 * epochs `orbitTimeMarks` returns, so a mark is not a decoration: it is the body's actual
 * future position at a stated time. Because they are equally spaced in time they are unequally
 * spaced along the path, and the crowding near periapsis is Kepler's second law measured
 * rather than illustrated.
 *
 * A `Points` object rather than meshes. There are at most 24 of them per orbit and they are
 * rewritten whenever the clock publishes, so one buffer and one draw call is the right shape;
 * two dozen sprites would be two dozen objects to keep in step with the group they hang in.
 *
 * Planetary orbits only. A moon's ring is drawn in that moon's own tint, which for the Moon is
 * the same pale grey as its orbit line, so the marks were indistinguishable from the line they
 * sat on: reported as not being able to see them at all. In the system view each planet has a
 * distinct colour against a line of the same colour at a much larger scale, where they read.
 */
function TimeMarks({ orbit, colour }: { orbit: Orbit; colour: string }) {
  const epoch = useViewportValue(selectEpoch);

  const points = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(MAX_MARKS * 3), 3));
    const material = new PointsMaterial({
      color: colour,
      // Screen-space pixels, so a mark stays legible whether the orbit is an astronomical
      // unit or four hundred thousand kilometres across.
      size: 4.5,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    const object = new Points(geometry, material);
    object.frustumCulled = false;
    return object;
  }, [colour]);

  useEffect(() => () => {
    points.geometry.dispose();
    (points.material as PointsMaterial).dispose();
  }, [points]);

  useEffect(() => {
    const { marks } = orbitTimeMarks(orbit.periodDays, jdTdb(epoch));
    const attribute = points.geometry.getAttribute("position") as BufferAttribute;
    const array = attribute.array as Float32Array;

    for (let i = 0; i < marks.length; i++) {
      const at = marks[i].epoch;
      const p = heliocentricPositionOf(orbit.id, at);
      const origin = orbit.parent ? heliocentricPositionOf(orbit.parent, at) : null;
      array[i * 3] = origin ? p.x - origin.x : p.x;
      array[i * 3 + 1] = origin ? p.y - origin.y : p.y;
      array[i * 3 + 2] = origin ? p.z - origin.z : p.z;
    }

    // Drawing only what was written. The buffer is allocated for the worst case and a stale
    // tail would leave marks from a previous body sitting at the origin.
    points.geometry.setDrawRange(0, marks.length);
    attribute.needsUpdate = true;
    points.geometry.computeBoundingSphere();
  }, [points, orbit, epoch]);

  return <primitive object={points} />;
}

/**
 * Whether an orbit belongs on screen at this focus, which is a question about scale.
 *
 * A planet's orbit is an astronomical unit or more across. Standing at Earth, Saturn's ring is
 * so much larger than the view that only its near edge crosses the screen, and because the
 * camera arrives lifted a quarter of its distance above the ecliptic and looks down at the
 * planet, that edge is the plane's horizon some fourteen degrees up: streaks across the sky,
 * well above the planet and visibly not centred on it. Reported as exactly that. They are
 * geometrically correct and they are not worth the screen.
 *
 * So a planet's orbit is drawn in the system view, and a moon's only when its own system is
 * in view. It is the rule the iOS client has always used, and the website not having it was
 * the divergence the contracts exist to prevent.
 */
export function orbitIsVisible(
  orbit: { readonly id: BodyId; readonly parent: BodyId | null },
  focus: BodyId,
): boolean {
  if (orbit.parent === null) return focus === "sun";
  return orbit.parent === focus || orbit.id === focus;
}

function buildAll(): Orbit[] {
  const built: Orbit[] = [];
  for (const id of BODY_IDS) {
    const contract = BODY_CONTRACTS[id];
    const { ephemeris, appearance } = contract;
    if (ephemeris.kind === "standish-elements") {
      const period = orbitalPeriodDays(ephemeris.planet);
      built.push({
        id,
        parent: null,
        periodDays: period,
        line: buildOrbit(id, period, null, appearance.tint),
      });
    } else if (ephemeris.kind === "mean-elements-about-parent" && contract.parent) {
      built.push({
        id,
        parent: contract.parent,
        periodDays: ephemeris.periodDays,
        line: buildOrbit(id, ephemeris.periodDays, contract.parent, appearance.tint),
      });
    }
  }
  return built;
}

/** A moon's ring, hung on a group the viewport keeps sitting on the planet. */
function MoonOrbit({ orbit }: { orbit: Orbit }) {
  const viewport = useViewport();
  const group = useRef<Group>(null);

  useEffect(() => {
    if (!group.current || !orbit.parent) return;
    return viewport.attachOrbitAnchor(orbit.parent, group.current);
  }, [viewport, orbit.parent]);

  return (
    <group ref={group}>
      <primitive object={orbit.line} material-opacity={0.5} />
    </group>
  );
}

const selectFocus = (s: ViewportSnapshot) => s.focus;
const selectEpoch = (s: ViewportSnapshot) => s.epoch;

/**
 * Built once for the lifetime of the page, not once per component.
 *
 * Two components read this set and a `useMemo` in each would sample the ephemeris twice, some
 * thirty thousand Kepler solves, and hold two copies of every buffer for one scene. Module
 * scope rather than a context because the geometry depends on nothing: the elements are fixed
 * and a ring is the same ring whoever asks for it.
 *
 * Nothing disposes it, deliberately. It lives as long as the page does, and a dispose on
 * unmount would free buffers the other component is still drawing from.
 */
let cached: Orbit[] | null = null;
function allOrbits(): Orbit[] {
  cached ??= buildAll();
  return cached;
}

/**
 * Planetary orbits. Belongs inside the heliocentric group, which carries the origin.
 *
 * Drawn only in the system view; see `orbitIsVisible` for why.
 */
export function OrbitPaths() {
  const focus = useViewportValue(selectFocus);
  const orbits = allOrbits();

  return (
    <>
      {orbits
        .filter((o) => o.parent === null && orbitIsVisible(o, focus))
        .map((orbit) => (
          <Fragment key={orbit.id}>
            {/* r3f's piercing props set the material declaratively, so nothing mutates an
                object a hook owns. */}
            <primitive object={orbit.line} material-opacity={orbit.id === focus ? 0.95 : 0.4} />
            <TimeMarks orbit={orbit} colour={BODY_CONTRACTS[orbit.id].appearance.tint} />
          </Fragment>
        ))}
    </>
  );
}

/**
 * Moon orbits, and the reason they are a separate component rather than a branch above.
 *
 * These must hang off the scene root, not off the heliocentric group. Their anchor is written
 * as the planet's position minus the origin, a subtraction done in float64 so the number that
 * reaches the GPU is small. Nested inside the heliocentric group the same result would be
 * reached as the difference of two values near 1e12, in float32, and a ring a few hundred
 * thousand kilometres across would be positioned by cancelling two numbers ten thousand times
 * larger than itself.
 *
 * Drawn only when that satellite system is in view; see `orbitIsVisible`.
 */
export function MoonOrbits() {
  const focus = useViewportValue(selectFocus);
  const orbits = allOrbits();

  return (
    <>
      {orbits
        .filter((o) => o.parent !== null && orbitIsVisible(o, focus))
        .map((orbit) => (
          <MoonOrbit key={orbit.id} orbit={orbit} />
        ))}
    </>
  );
}
