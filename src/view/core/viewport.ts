/**
 * The Viewport owns every scale-critical transform in the scene.
 *
 * One object advances the clock, holds the floating origin, writes every body's position, builds
 * the screen index that picking and labels read, and sets the camera's near and far planes. React
 * declares what a body looks like and is structurally unable to write where it is.
 *
 * That split is the whole design. The invariant "never write a true world coordinate into a
 * THREE.Vector3" is a single-writer invariant, and a design with one writer per body cannot hold
 * it with types, only with discipline. Here there is one writer, one call site, and `internal/`
 * is fenced off by lint so nothing can route around it.
 */

import type { BufferAttribute, Camera, Object3D, PerspectiveCamera, Points } from "three";
import { heliocentricPositionOf } from "@/engine/bodies/position";
import { BODY_CONTRACTS, BODY_IDS, type BodyId } from "@/engine/bodies/registry";
import { orientationOf } from "@/engine/rotation";
import type { JdTdb } from "@/engine/time";
import { length, type Vec3 } from "@/engine/vec";
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
  setFocus(id: BodyId): void;
  /** Camera distance from the focused body's surface, metres. Driven by the controls. */
  setDistanceToSurface(metres: number): void;
  pickAt(ndcX: number, ndcY: number, viewportHeightPx: number): BodyId | null;
  readonly screen: readonly ScreenPlacement[];
  snapshot(): ViewportSnapshot;
  /** Inspection hook for the visual harness. Reports what the frame loop actually did. */
  debug(): Record<string, unknown>;
  subscribe(listener: (snapshot: ViewportSnapshot) => void): () => void;
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
  let heliocentricRoot: Object3D | null = null;
  let markers: Points | null = null;
  const positions = new Map<BodyId, Vec3>();
  const screen: ScreenPlacement[] = [];
  const listeners = new Set<(snapshot: ViewportSnapshot) => void>();

  const publishIntervalMs = init.publishIntervalMs ?? 100;
  let lastPublish = 0;

  function snapshot(): ViewportSnapshot {
    return {
      epoch: clock.epoch,
      secondsPerSecond: clock.secondsPerSecond,
      running: clock.running,
      focus,
      distanceToFocus: distanceToSurface,
    };
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

  function advance(realDeltaSeconds: number): void {
    const activeCamera = camera;
    if (!activeCamera) return;

    clock = tickClock(clock, realDeltaSeconds);

    for (const id of BODY_IDS) {
      positions.set(id, heliocentricPositionOf(id, clock.epoch));
    }

    // The origin tracks the focused body, so the deltas handed to the GPU stay small no matter
    // how far from the Sun the camera is.
    origin = positions.get(focus) ?? { x: 0, y: 0, z: 0 };

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

    setFocus(id) {
      focus = id;
      publish(true);
    },

    setDistanceToSurface(metres) {
      distanceToSurface = Math.max(0, metres);
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
