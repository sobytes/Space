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

import type { Camera, Object3D, PerspectiveCamera } from "three";
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
