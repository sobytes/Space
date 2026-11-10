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
import { engulfedAt, orbitExpansionAt, solarRadiusMetresAt } from "@solar/engine/deep-time";
import { createNBodyTracker, type NBodyTracker } from "@solar/engine/nbody-tracker";
import type { MassiveBody } from "@solar/engine/nbody";
import { BODY_CONTRACTS, BODY_IDS, type BodyId } from "@solar/engine/bodies/registry";
import { bodyFrameOf } from "@solar/engine/rotation";
import type { JdTdb } from "@solar/engine/time";
import { length, type Vec3 } from "@solar/engine/vec";
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
  /** The Sun's age the scene is drawn at, or null for the present. */
  readonly deepTimeAgeGyr: number | null;
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
   * Registers a group that must sit on a body, for geometry held relative to that body.
   *
   * A moon's orbit needs this and the heliocentric root cannot provide it: the root carries
   * one origin for the whole scene, and what a satellite system needs is an origin per
   * planet. Only the position is written, so the ring never inherits a planet's spin.
   */
  attachOrbitAnchor(parent: BodyId, node: Object3D): () => void;
  /** Draw the scene at a given age of the Sun, or null for the present. */
  setDeepTime(ageGyr: number | null): void;
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

  const nodes = new Map<BodyId, Object3D>();
  /** Keyed by node rather than by body: one planet can carry several moons' rings. */
  const orbitAnchors = new Map<Object3D, BodyId>();
  /**
   * The Sun's age the scene is drawn at, or null for the present.
   *
   * Null rather than 4.57, so "is deep time on" is a question about the mode and not a float
   * comparison against the present age, and so the ordinary path does no arithmetic at all.
   */
  let deepTimeAgeGyr: number | null = null;
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
      deepTimeAgeGyr,
    };
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
  /**
   * Everything pushed outwards by the Sun's mass loss, in float64, before anything is drawn.
   *
   * Applied here rather than at the GPU on purpose. This is a multiplication on a true
   * heliocentric metre, which is exactly the kind of arithmetic that must happen before the
   * single float64-to-float32 boundary; scaling a render-space delta instead would scale the
   * floating origin along with it and move the camera off the body it is tracking.
   *
   * One factor for the whole system, because the adiabatic result scales every orbit equally.
   */
  function expanded(position: Vec3): Vec3 {
    if (deepTimeAgeGyr === null) return position;
    const scale = orbitExpansionAt(deepTimeAgeGyr);
    if (scale === 1) return position;
    return { x: position.x * scale, y: position.y * scale, z: position.z * scale };
  }

  function resolvePositions(): void {
    const active = tracker;
    if (!active) {
      for (const id of BODY_IDS) {
        positions.set(id, expanded(heliocentricPositionOf(id, clock.epoch)));
      }
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
        expanded(integrated.has(id)
          ? active.heliocentricPosition(id)
          : heliocentricPositionOf(id, clock.epoch)),
      );
    }
  }

  function advance(realDeltaSeconds: number): void {
    const activeCamera = camera;
    if (!activeCamera) return;

    clock = tickClock(clock, realDeltaSeconds);

    resolvePositions();

    // The origin tracks the focused body, so the deltas handed to the GPU stay small no matter
    // how far from the Sun the camera is.
    origin = positions.get(focus) ?? { x: 0, y: 0, z: 0 };

    for (const id of BODY_IDS) {
      const node = nodes.get(id);
      const worldPosition = positions.get(id);
      if (!node || !worldPosition) continue;

      const contract = BODY_CONTRACTS[id];

      /**
       * What the star has swallowed stops being drawn.
       *
       * Visibility rather than removal, so nothing is rebuilt as the slider moves and a planet
       * comes back if you drag back before the giant phase. `visible` is the one property on
       * an attached node the Viewport writes besides its transform.
       */
      node.visible = deepTimeAgeGyr === null || !engulfedAt(id, deepTimeAgeGyr);
      if (!node.visible) continue;

      placeAnchor(node, {
        worldPosition,
        origin,
        // The Sun alone changes size with age, by a factor of 256 at the red giant tip.
        radiusMetres:
          id === "sun" && deepTimeAgeGyr !== null
            ? solarRadiusMetresAt(deepTimeAgeGyr)
            : contract.equatorialRadiusM,
        // The pole and the prime meridian as vectors, not as angles to be reassembled. See
        // `placeAnchor` for what reassembling them cost.
        frame: bodyFrameOf(id, clock.epoch),
      });
    }

    if (heliocentricRoot) {
      // The Sun is the heliocentric origin, so this group sits at minus the floating origin.
      // Its children keep vertices in true heliocentric metres. Those are large float32 values
      // and carry roughly 500 m of error at Neptune, which is far below one pixel at any
      // distance from which a whole orbit is visible. The invariant that matters is not
      // "never a large float32 number", it is "never a float32 error you can resolve".
      heliocentricRoot.position.set(-origin.x, -origin.y, -origin.z);
      /**
       * The drawn orbits expand with the planets on them.
       *
       * Scaling the group rather than rebuilding every vertex, and it composes correctly
       * because the origin this group carries is already the expanded one: a child vertex at
       * a true heliocentric metre renders at scale * v - origin, which is the expanded orbit
       * seen from the expanded camera position. Rebuilding 512 vertices per planet on every
       * drag of the slider would be the obvious alternative and the wrong one.
       */
      const scale = deepTimeAgeGyr === null ? 1 : orbitExpansionAt(deepTimeAgeGyr);
      heliocentricRoot.scale.setScalar(scale);
      heliocentricRoot.updateMatrix();
      heliocentricRoot.matrixWorldNeedsUpdate = true;
    }

    // A moon's ring holds vertices relative to its planet, so it rides the planet rather than
    // the Sun. Position only: inheriting a planet's spin would turn the orbit with the day.
    for (const [node, parent] of orbitAnchors) {
      const at = positions.get(parent);
      if (!at) continue;
      node.position.set(at.x - origin.x, at.y - origin.y, at.z - origin.z);
      node.updateMatrix();
      node.matrixWorldNeedsUpdate = true;
    }

    const heightPx = typeof window === "undefined" ? 1080 : window.innerHeight;
    screen.length = 0;
    for (const id of BODY_IDS) {
      const worldPosition = positions.get(id);
      if (!worldPosition) continue;
      // A body the star has swallowed is not labelled either. Without this the scene showed
      // Earth destroyed and its name still floating where it used to be.
      if (deepTimeAgeGyr !== null && engulfedAt(id, deepTimeAgeGyr)) continue;
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

    /**
     * Draw the scene as it stands at a given age of the Sun, or null for the present.
     *
     * Three things change and nothing else: every orbit expands by the mass-loss factor, the
     * Sun is drawn at its radius for that age, and a body the star has swallowed stops being
     * drawn. The clock keeps running, so the planets still go round; what moves is the scale
     * of the system and the size of the star at the middle of it.
     */
    setDeepTime(ageGyr) {
      deepTimeAgeGyr = ageGyr;
      publish(true);
    },

    attachOrbitAnchor(parent, node) {
      orbitAnchors.set(node, parent);
      node.matrixAutoUpdate = false;
      return () => {
        orbitAnchors.delete(node);
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
