/**
 * The Viewport owns every scale-critical transform in the scene.
 *
 * One object advances the clock, holds the floating origin, writes every body's position, builds
 * the screen index that picking and labels read, and sets the camera's near and far planes. React
 * declares what a body looks like and is structurally unable to write where it is.
 *
 * That split is the whole design. The invariant "never write a true world coordinate into a
 * THREE.Vector3" is a single-writer invariant, and a design with one writer per body cannot hold
 * it with types, only with discipline. Here there is one writer and one call site.
 *
 * The fence is `invariants.test.ts`, which scans the source, rather than the eslint zone table,
 * which matches on how an import is spelled and lets a relative path through. Files that
 * legitimately build their own float32 buffers, such as the orbit lines and the star field, are
 * declared there with their justification; an undeclared one fails the build.
 */

import type { BufferAttribute, Camera, Object3D, PerspectiveCamera, Points } from "three";
import { heliocentricPositionOf } from "@solar/engine/bodies/position";
import { createNBodyTracker, type NBodyTracker } from "@solar/engine/nbody-tracker";
import type { MassiveBody } from "@solar/engine/nbody";
import { BODY_CONTRACTS, BODY_IDS, type BodyId } from "@solar/engine/bodies/registry";
import { orientationOf } from "@solar/engine/rotation";
import type { JdTdb } from "@solar/engine/time";
import { length, type Vec3 } from "@solar/engine/vec";
import { trajectoryStateAt, type TrajectorySample } from "@solar/engine/propagate";
import { SECONDS_PER_DAY } from "@solar/engine/units";
import { placeAnchor, relativeTo } from "./internal/place";
import { planDepth } from "./depth";
import { initialClock, reduceClock, tickClock, type ClockCommand, type ClockState } from "./clock";

/** Click targets never shrink below this, so a sub-pixel planet stays reachable. */
export const MIN_HIT_RADIUS_PX = 14;

/** Above this apparent radius the real sphere is resolvable and the marker fades out. */
export const MARKER_FADE_PX = 7;

export interface ScreenPlacement {
  readonly id: BodyId;
  /** Normalised device coordinates, -1 to 1. */
  readonly ndcX: number;
  readonly ndcY: number;
  /** True camera distance in metres, float64. */
  readonly distance: number;
  readonly radiusPx: number;
  readonly behindCamera: boolean;
}

/**
 * A propagated trajectory, flat, as the worker transfers it.
 *
 * Typed arrays rather than objects because this crosses a worker boundary and a few thousand
 * sample objects would be structured-cloned rather than transferred. Unpacked once on arrival.
 */
export interface RideTrajectory {
  readonly times: Float64Array;
  /** Six per sample: position xyz then velocity xyz, heliocentric metres and metres a second. */
  readonly states: Float64Array;
  readonly startEpoch: number;
}

export interface ViewportSnapshot {
  readonly epoch: JdTdb;
  readonly secondsPerSecond: number;
  readonly running: boolean;
  readonly focus: BodyId;
  readonly distanceToFocus: number;
  /**
   * Unit vector from the focused body towards the Sun, in render space. The floating origin
   * sits on the focused body, so this is just the normalised negative of the origin.
   */
  readonly sunDirection: { readonly x: number; readonly y: number; readonly z: number };
  readonly gravity: GravitySnapshot;
  /** Whether the floating origin is currently sitting on a launched object. */
  readonly riding: boolean;
  /** Whether there is anything to ride. */
  readonly hasTrajectory: boolean;
}

/**
 * What the gravity mode is doing, surfaced so the UI can state it rather than imply it.
 *
 * In `analytic` mode the planets are on rails from the Standish tables and a mass added to the
 * system changes nothing about them. In `nbody` mode every body pulls every other, which is
 * the physically complete answer and also the one that drifts, lags and occasionally has to
 * restart. A viewer deserves to know which of those they are looking at.
 */
export interface GravitySnapshot {
  readonly mode: "analytic" | "nbody";
  /** Days by which the integration trails the clock. Non-zero means it is budget-bound. */
  readonly lagDays: number;
  /** Relative energy drift since the integration last restarted. */
  readonly energyDrift: number;
  /** Simulated days integrated under mutual gravity since the last restart. */
  readonly integratedDays: number;
  readonly bodyCount: number;
}

export interface Viewport {
  /** Bound once the Canvas exists. `advance` is a no-op until then. */
  setCamera(camera: PerspectiveCamera): void;
  advance(realDeltaSeconds: number): void;
  attach(id: BodyId, node: Object3D): () => void;
  /**
   * Registers the group that holds heliocentric geometry such as orbit lines. It is placed at
   * the Sun each frame, so its children can keep vertices in plain heliocentric metres.
   */
  attachHeliocentricRoot(node: Object3D): () => void;
  /**
   * Registers the Points object that marks bodies too small to see as geometry. The Viewport
   * writes its position buffer, so the single-writer rule over scale-critical data still holds.
   */
  attachMarkers(points: Points): () => void;
  send(command: ClockCommand): void;
  /**
   * Switches between the analytic ephemeris and full mutual gravity.
   *
   * Entering `nbody` seeds the integration from the analytic ephemeris at the current epoch, so
   * the two modes agree at the moment of the switch and diverge from there. That divergence is
   * the mutual perturbation, and it is the thing worth watching.
   */
  setGravityMode(mode: "analytic" | "nbody", options?: NBodyModeOptions): void;
  /** Issues a camera request. Does nothing if no camera rig is listening. */
  requestView(command: ViewCommand): void;
  /** The camera rig subscribes here. Returns an unsubscribe function. */
  subscribeView(listener: (command: ViewCommand) => void): () => void;
  setFocus(id: BodyId): void;
  /**
   * Hand the viewport a propagated trajectory to ride, or null to put it away.
   *
   * Riding is implemented by moving the floating origin onto the object rather than by adding
   * a second camera. Everything downstream already draws relative to that origin, so the
   * existing controls, the existing precision story and the existing distance limits all keep
   * working, and the feature is one branch in the frame loop.
   */
  setRide(ride: RideTrajectory | null): void;
  setRiding(on: boolean): void;
  /** Camera distance from the focused body's surface, metres. Driven by the controls. */
  setDistanceToSurface(metres: number): void;
  /**
   * Direction from a body towards the Sun, in render space, computed for that body now.
   *
   * Deliberately not read from the cached origin. `setFocus` does not recompute the origin;
   * the frame loop does, on its next tick. A camera placed from the snapshot immediately
   * after a focus change was therefore aiming using the previous body's position, which for
   * a short hop looked fine and for a jump across the solar system put the camera over the
   * night side.
   */
  sunDirectionFor(body: BodyId): { x: number; y: number; z: number };
  pickAt(ndcX: number, ndcY: number, viewportHeightPx: number): BodyId | null;
  readonly screen: readonly ScreenPlacement[];
  snapshot(): ViewportSnapshot;
  /** Inspection hook for the visual harness. Reports what the frame loop actually did. */
  debug(): Record<string, unknown>;
  subscribe(listener: (snapshot: ViewportSnapshot) => void): () => void;
}

/**
 * A request to reposition the camera, issued by the UI and executed by the camera rig.
 *
 * The HUD must not reach into three.js, and the camera rig is the only thing that knows about
 * the controls, so this is a one-way channel between them. The Viewport carries it because it
 * already owns focus and the Sun's direction from the focused body, which is everything a
 * placement needs.
 */
export type ViewCommand =
  /**
   * Swing the camera to a given angle between the Sun and the viewer, in degrees, keeping the
   * current distance. 0 is the fully lit disc, 90 puts the terminator down the middle, 180 is
   * the night side. The swing is about ecliptic north, so it reads as the body's phases.
   */
  | { readonly kind: "sunAngle"; readonly degrees: number }
  /** Pull back far enough to hold the focused body and all of its moons. */
  | { readonly kind: "frameMoons" };

export interface NBodyModeOptions {
  /** Registry bodies to integrate. Defaults to the eight planets. */
  readonly bodies?: readonly BodyId[];
  /** Masses that exist in no ephemeris, such as a hypothetical planet. */
  readonly extra?: readonly MassiveBody[];
  readonly stepBudget?: number;
}

export interface ViewportInit {
  readonly initialFocus?: BodyId;
  /** How often the UI-facing snapshot is published, milliseconds. Never per frame. */
  readonly publishIntervalMs?: number;
}

function isPerspective(camera: Camera): camera is PerspectiveCamera {
  return (camera as PerspectiveCamera).isPerspectiveCamera === true;
}

export function createViewport(init: ViewportInit = {}): Viewport {
  let camera: PerspectiveCamera | null = null;

  let clock: ClockState = initialClock();
  let focus: BodyId = init.initialFocus ?? "embary";
  let distanceToSurface = BODY_CONTRACTS[focus].equatorialRadiusM * 8;
  let origin: Vec3 = { x: 0, y: 0, z: 0 };
  let ride: RideTrajectory | null = null;
  let rideSamples: TrajectorySample[] = [];
  let riding = false;

  const nodes = new Map<BodyId, Object3D>();
  let heliocentricRoot: Object3D | null = null;
  let markers: Points | null = null;
  const positions = new Map<BodyId, Vec3>();

  // Null means the analytic ephemeris. A tracker means mutual gravity.
  let tracker: NBodyTracker | null = null;
  let nbodyOptions: NBodyModeOptions = {};
  let gravity: GravitySnapshot = {
    mode: "analytic",
    lagDays: 0,
    energyDrift: 0,
    integratedDays: 0,
    bodyCount: 0,
  };
  let seedEpoch: JdTdb = clock.epoch;

  const screen: ScreenPlacement[] = [];
  const listeners = new Set<(snapshot: ViewportSnapshot) => void>();
  const viewListeners = new Set<(command: ViewCommand) => void>();

  const publishIntervalMs = init.publishIntervalMs ?? 100;
  let lastPublish = 0;

  function snapshot(): ViewportSnapshot {
    return {
      epoch: clock.epoch,
      secondsPerSecond: clock.secondsPerSecond,
      running: clock.running,
      focus,
      distanceToFocus: distanceToSurface,
      sunDirection: sunDirectionFromFocus(),
      gravity,
      riding,
      hasTrajectory: rideSamples.length > 1,
    };
  }

  /**
   * Where the ridden object is at this epoch, in heliocentric metres.
   *
   * The interpolation itself is `trajectoryStateAt` in the engine, shared with the iOS client
   * and gated by the conformance suite, so a rider in a browser and a rider on a phone are in
   * the same place. This only converts the epoch into seconds from release.
   */
  function riderAt(epoch: JdTdb): Vec3 | null {
    if (!ride || rideSamples.length < 2) return null;
    const seconds = (epoch - ride.startEpoch) * SECONDS_PER_DAY;
    return trajectoryStateAt(rideSamples, seconds)?.position ?? null;
  }

  /** The Sun sits at the heliocentric origin, so it is at minus the floating origin. */
  function sunDirectionFromFocus() {
    const magnitude = Math.hypot(origin.x, origin.y, origin.z);
    if (magnitude === 0) return { x: 0, y: 0, z: 1 };
    return { x: -origin.x / magnitude, y: -origin.y / magnitude, z: -origin.z / magnitude };
  }

  function publish(force: boolean): void {
    const now = performance.now();
    if (!force && now - lastPublish < publishIntervalMs) return;
    lastPublish = now;
    const current = snapshot();
    for (const listener of listeners) listener(current);
  }

  /**
   * Projects a camera-relative delta to screen coordinates in float64, rather than letting
   * three.js do it in float32. The whole point of the floating origin is that this number is
   * small, but the projection itself is cheap and doing it here keeps picking exact.
   */
  function project(
    activeCamera: PerspectiveCamera,
    delta: Vec3,
    radiusMetres: number,
    heightPx: number,
  ): Omit<ScreenPlacement, "id"> {
    activeCamera.updateMatrixWorld();

    // The full view transform, translation column included. Dropping e[12..14] leaves only the
    // rotation, which silently reports every distance as the body's offset from the origin
    // rather than from the camera. For the focused body that offset is exactly zero, so the
    // depth planner saw a camera sitting on the surface and clamped the far plane to 5,000 km.
    const e = activeCamera.matrixWorldInverse.elements;
    const viewX = e[0] * delta.x + e[4] * delta.y + e[8] * delta.z + e[12];
    const viewY = e[1] * delta.x + e[5] * delta.y + e[9] * delta.z + e[13];
    const viewZ = e[2] * delta.x + e[6] * delta.y + e[10] * delta.z + e[14];

    const distance = Math.hypot(viewX, viewY, viewZ);
    const behindCamera = viewZ > 0;

    const fovRad = (activeCamera.fov * Math.PI) / 180;
    const tanHalf = Math.tan(fovRad / 2);
    const depth = Math.abs(viewZ) || 1e-9;

    return {
      ndcX: viewX / (depth * tanHalf * activeCamera.aspect),
      ndcY: viewY / (depth * tanHalf),
      distance,
      radiusPx: (radiusMetres / (depth * tanHalf)) * (heightPx / 2),
      behindCamera,
    };
  }

  /**
   * Writes every body's heliocentric position for this frame.
   *
   * In N-body mode a body the tracker integrates comes from the integration, and anything it
   * does not comes from the analytic ephemeris. That mixture is deliberate: integrating all 32
   * bodies costs about 950 s per simulated century because Phobos paces the step size, so the
   * default integrates the eight planets and leaves the moons analytic about their parents.
   * The moons then follow a planet that is itself moving under mutual gravity, which is the
   * right compromise and is stated in the UI rather than left to be discovered.
   */
  function resolvePositions(): void {
    const active = tracker;
    if (!active) {
      for (const id of BODY_IDS) positions.set(id, heliocentricPositionOf(id, clock.epoch));
      return;
    }

    const status = active.seek(clock.epoch);
    gravity = {
      mode: "nbody",
      lagDays: status.lagDays,
      energyDrift: status.energyDrift,
      integratedDays: status.epoch - seedEpoch,
      bodyCount: status.bodyCount,
    };
    if (status.reseeded) seedEpoch = status.epoch;

    const integrated = new Set(active.ids);
    for (const id of BODY_IDS) {
      positions.set(
        id,
        integrated.has(id)
          ? active.heliocentricPosition(id)
          : heliocentricPositionOf(id, clock.epoch),
      );
    }
  }

  function advance(realDeltaSeconds: number): void {
    const activeCamera = camera;
    if (!activeCamera) return;

    clock = tickClock(clock, realDeltaSeconds);

    resolvePositions();

    // The origin tracks the focused body, so the deltas handed to the GPU stay small no matter
    // how far from the Sun the camera is. Riding moves it onto the launched object instead,
    // which is the whole of that feature.
    const rider = riding ? riderAt(clock.epoch) : null;
    origin = rider ?? positions.get(focus) ?? { x: 0, y: 0, z: 0 };

    for (const id of BODY_IDS) {
      const node = nodes.get(id);
      const worldPosition = positions.get(id);
      if (!node || !worldPosition) continue;

      const contract = BODY_CONTRACTS[id];
      const orientation = orientationOf(id, clock.epoch);

      placeAnchor(node, {
        worldPosition,
        origin,
        radiusMetres: contract.equatorialRadiusM,
        spinRadians: orientation.spin,
        tiltRadians: orientation.tilt,
        poleAzimuthRadians: orientation.poleAzimuth,
      });
    }

    if (heliocentricRoot) {
      // The Sun is the heliocentric origin, so this group sits at minus the floating origin.
      // Its children keep vertices in true heliocentric metres. Those are large float32 values
      // and carry roughly 500 m of error at Neptune, which is far below one pixel at any
      // distance from which a whole orbit is visible. The invariant that matters is not
      // "never a large float32 number", it is "never a float32 error you can resolve".
      heliocentricRoot.position.set(-origin.x, -origin.y, -origin.z);
      heliocentricRoot.updateMatrix();
      heliocentricRoot.matrixWorldNeedsUpdate = true;
    }

    const heightPx = typeof window === "undefined" ? 1080 : window.innerHeight;
    screen.length = 0;
    for (const id of BODY_IDS) {
      const worldPosition = positions.get(id);
      if (!worldPosition) continue;
      const delta = relativeTo(worldPosition, origin);
      screen.push({
        id,
        ...project(activeCamera, delta, BODY_CONTRACTS[id].equatorialRadiusM, heightPx),
      });
    }

    if (markers) {
      // A body under a few pixels across cannot be seen as geometry, which is most of the
      // system from most viewpoints. These markers keep every body findable and clickable
      // without faking its size: the marker fades out as the real sphere becomes resolvable.
      const attribute = markers.geometry.getAttribute("position") as BufferAttribute;
      const sizeAttribute = markers.geometry.getAttribute("aSize") as BufferAttribute | undefined;
      BODY_IDS.forEach((id, index) => {
        const worldPosition = positions.get(id);
        if (!worldPosition) return;
        const delta = relativeTo(worldPosition, origin);
        attribute.setXYZ(index, delta.x, delta.y, delta.z);
        if (sizeAttribute) {
          const placement = screen.find((p) => p.id === id);
          const apparent = placement?.radiusPx ?? 0;
          sizeAttribute.setX(index, apparent < MARKER_FADE_PX ? 1 - apparent / MARKER_FADE_PX : 0);
        }
      });
      attribute.needsUpdate = true;
      if (sizeAttribute) sizeAttribute.needsUpdate = true;
    }

    const focusPlacement = screen.find((p) => p.id === focus);
    if (focusPlacement) {
      distanceToSurface = Math.max(
        0,
        focusPlacement.distance - BODY_CONTRACTS[focus].equatorialRadiusM,
      );
    }

    const sceneRadius = Math.max(
      ...BODY_IDS.map((id) => length(positions.get(id) ?? { x: 0, y: 0, z: 0 })),
    );
    const plan = planDepth({
      distanceToFocusSurface: distanceToSurface,
      focusRadius: BODY_CONTRACTS[focus].equatorialRadiusM,
      sceneRadius,
    });

    if (isPerspective(activeCamera) && (activeCamera.near !== plan.near || activeCamera.far !== plan.far)) {
      activeCamera.near = plan.near;
      activeCamera.far = plan.far;
      activeCamera.updateProjectionMatrix();
    }

    publish(false);
  }

  return {
    setCamera(next) {
      camera = next;
    },

    advance,

    attach(id, node) {
      nodes.set(id, node);
      node.matrixAutoUpdate = false;
      return () => {
        nodes.delete(id);
      };
    },

    attachHeliocentricRoot(node) {
      heliocentricRoot = node;
      node.matrixAutoUpdate = false;
      return () => {
        heliocentricRoot = null;
      };
    },

    attachMarkers(points) {
      markers = points;
      return () => {
        markers = null;
      };
    },

    send(command) {
      clock = reduceClock(clock, command);
      publish(true);
    },

    setGravityMode(mode, options) {
      if (mode === "analytic") {
        tracker = null;
        gravity = { mode: "analytic", lagDays: 0, energyDrift: 0, integratedDays: 0, bodyCount: 0 };
        return;
      }
      nbodyOptions = options ?? nbodyOptions;
      // Seeded at the current epoch, so flipping the switch changes nothing visible at first
      // and everything after. Any divergence from here on is the mutual perturbation.
      tracker = createNBodyTracker({
        epoch: clock.epoch,
        bodies: nbodyOptions.bodies,
        extra: nbodyOptions.extra,
        stepBudget: nbodyOptions.stepBudget,
      });
      seedEpoch = clock.epoch;
      resolvePositions();
    },

    requestView(command) {
      for (const listener of viewListeners) listener(command);
    },

    subscribeView(listener) {
      viewListeners.add(listener);
      return () => viewListeners.delete(listener);
    },

    setFocus(id) {
      focus = id;
      publish(true);
    },

    setRide(next) {
      ride = next;
      riding = false;
      rideSamples = [];
      if (next) {
        // Unpacked once into the shape the shared interpolation takes, rather than per frame.
        // The buffers arrive from the worker as flat typed arrays to transfer cheaply.
        rideSamples = Array.from({ length: next.times.length }, (_, i) => ({
          t: next.times[i],
          position: { x: next.states[i * 6], y: next.states[i * 6 + 1], z: next.states[i * 6 + 2] },
          velocity: {
            x: next.states[i * 6 + 3],
            y: next.states[i * 6 + 4],
            z: next.states[i * 6 + 5],
          },
        }));
      }
      publish(true);
    },

    setRiding(on) {
      riding = on && rideSamples.length > 1;
      publish(true);
    },

    setDistanceToSurface(metres) {
      distanceToSurface = Math.max(0, metres);
    },

    sunDirectionFor(body) {
      const position = heliocentricPositionOf(body, clock.epoch);
      const magnitude = Math.hypot(position.x, position.y, position.z);
      if (magnitude === 0) return { x: 0, y: 0, z: 1 };
      return { x: -position.x / magnitude, y: -position.y / magnitude, z: -position.z / magnitude };
    },

    pickAt(ndcX, ndcY, viewportHeightPx) {
      let best: BodyId | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (const placement of screen) {
        if (placement.behindCamera) continue;
        const hitRadiusPx = Math.max(placement.radiusPx, MIN_HIT_RADIUS_PX);
        const hitNdc = (hitRadiusPx / viewportHeightPx) * 2;
        const dx = placement.ndcX - ndcX;
        const dy = placement.ndcY - ndcY;
        if (Math.hypot(dx, dy) > hitNdc) continue;
        if (placement.distance < bestDistance) {
          bestDistance = placement.distance;
          best = placement.id;
        }
      }
      return best;
    },

    get screen() {
      return screen;
    },

    debug() {
      const earth = positions.get("embary");
      const node = nodes.get("embary");
      return {
        attachedNodes: nodes.size,
        resolvedPositions: positions.size,
        gravityMode: gravity.mode,
        gravityLagDays: gravity.lagDays,
        gravityEnergyDrift: gravity.energyDrift,
        integratedDays: gravity.integratedDays,
        integratedBodies: gravity.bodyCount,
        cameraBound: camera !== null,
        focus,
        distanceToSurface,
        origin,
        earthWorld: earth,
        earthNodePosition: node ? { x: node.position.x, y: node.position.y, z: node.position.z } : null,
        earthNodeScale: node ? node.scale.x : null,
        earthNodeVisible: node ? node.visible : null,
        cameraPosition: camera ? { x: camera.position.x, y: camera.position.y, z: camera.position.z } : null,
        cameraNear: camera?.near,
        cameraFar: camera?.far,
        screenSample: screen.slice(0, 3),
      };
    },

    snapshot,

    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
