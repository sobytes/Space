"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { CameraControls } from "@react-three/drei";
import type CameraControlsImpl from "camera-controls";
import type { PerspectiveCamera } from "three";
import { BODY_CONTRACTS, satelliteSystemRadiusM } from "@solar/engine/bodies/registry";
import type { ViewCommand, ViewportSnapshot } from "../core/viewport";
import { useViewport, useViewportValue } from "./ViewportContext";

/**
 * Navigation, and the one piece of luck the floating origin buys us.
 *
 * Because the origin tracks the focused body, that body sits at exactly (0,0,0) in render space
 * at all times. So the orbit target never moves and never needs updating, which removes the
 * usual source of jitter when a camera chases something at 1e12 metres.
 *
 * Distance limits come from the focused body's own radius: you can get to a kilometre above the
 * surface and no closer, and no further than a thousand body radii before a focus change makes
 * more sense than more dolly.
 */
const selectFocus = (s: ViewportSnapshot) => s.focus;

export function CameraRig() {
  const controls = useRef<CameraControlsImpl>(null);
  const viewport = useViewport();
  const focus = useViewportValue(selectFocus);
  const size = useThree((s) => s.size);

  useEffect(() => {
    const instance = controls.current;
    if (!instance) return;

    const radius = BODY_CONTRACTS[focus].equatorialRadiusM;

    // Focusing the Sun is the system view, so it gets a far wider range: past Neptune's orbit
    // at 4.5e12 m. Every other body is framed against itself, a kilometre above the surface at
    // the closest and a few thousand radii at the widest.
    const isSystemView = focus === "sun";
    instance.minDistance = radius * 1.02;
    instance.maxDistance = isSystemView ? 2e13 : radius * 4_000;
    instance.dollySpeed = 0.6;
    instance.truckSpeed = 0;
    void instance.setTarget(0, 0, 0, false);

    /**
     * Approach from the lit side.
     *
     * Flying to a body and arriving over its night side is a black screen and reads as a bug.
     * The floating origin puts the focused body at the render origin, so the Sun's direction
     * from it is just the normalised negative of the origin, which the viewport publishes.
     * The camera is placed along that direction and lifted slightly out of the ecliptic so the
     * terminator is visible rather than edge-on.
     */
    const sunDirection = viewport.sunDirectionFor(focus);
    const distance = isSystemView ? 1.6e12 : radius * 6;
    void instance.setLookAt(
      sunDirection.x * distance,
      sunDirection.y * distance + distance * 0.25,
      sunDirection.z * distance,
      0,
      0,
      0,
      true,
    );
  }, [focus, viewport]);

  /**
   * Camera requests from the HUD.
   *
   * `sunAngle` rotates the viewing direction about ecliptic north, away from the Sun. The
   * rotation is Rodrigues' formula with the axis not perpendicular to the Sun direction, since
   * a body's Sun direction is never exactly in the ecliptic plane:
   *
   *     d = S cos(t) + (n x S) sin(t) + n (n . S)(1 - cos(t))
   *
   * No vertical lift is added, unlike the arrival framing. At 90 degrees that puts the viewer
   * exactly in the plane containing the Sun, which makes the terminator a clean vertical line
   * down the middle of the disc rather than a curve, and that is the whole point of the view.
   *
   * Distance is deliberately preserved. Choosing a lighting angle should not also change how
   * close you are, or every press would undo your zoom.
   */
  useEffect(
    () =>
      viewport.subscribeView((command: ViewCommand) => {
        const instance = controls.current;
        if (!instance) return;

        if (command.kind === "frameMoons") {
          const systemRadius = satelliteSystemRadiusM(focus);
          if (systemRadius === null) return;
          /**
           * Derived from the camera, not from a constant.
           *
           * A fixed multiple of the orbit radius only works for one field of view. At 2.4 times
           * the apoapsis the moon subtends 22.6 degrees off axis, which squeaks inside a 50
           * degree vertical field and falls straight out of a narrower one or a shorter window.
           * Solving for the distance that puts the apoapsis at a set fraction of the vertical
           * half-frame holds regardless:  d = r / tan(fov/2 * fill).
           *
           * Vertical rather than horizontal because that is the shorter axis on every window
           * wider than it is tall, so it is the one that crops.
           */
          const halfFovRad = ((instance.camera as PerspectiveCamera).fov * Math.PI) / 360;
          const fill = 0.7;
          const distance = systemRadius / Math.tan(halfFovRad * fill);
          void instance.dollyTo(Math.min(distance, instance.maxDistance), true);
          return;
        }

        const sun = viewport.sunDirectionFor(focus);
        const t = (command.degrees * Math.PI) / 180;
        const cos = Math.cos(t);
        const sin = Math.sin(t);
        // Ecliptic north in render space. The scene's y axis is the ecliptic pole.
        const nx = 0;
        const ny = 1;
        const nz = 0;
        const dot = nx * sun.x + ny * sun.y + nz * sun.z;
        const crossX = ny * sun.z - nz * sun.y;
        const crossY = nz * sun.x - nx * sun.z;
        const crossZ = nx * sun.y - ny * sun.x;

        const dx = sun.x * cos + crossX * sin + nx * dot * (1 - cos);
        const dy = sun.y * cos + crossY * sin + ny * dot * (1 - cos);
        const dz = sun.z * cos + crossZ * sin + nz * dot * (1 - cos);
        const length = Math.hypot(dx, dy, dz) || 1;

        const distance = instance.distance || BODY_CONTRACTS[focus].equatorialRadiusM * 6;
        void instance.setLookAt(
          (dx / length) * distance,
          (dy / length) * distance,
          (dz / length) * distance,
          0,
          0,
          0,
          true,
        );
      }),
    [viewport, focus],
  );

  useEffect(() => {
    // Inspection hook for the visual harness, alongside window.__solar. Flying to a precise
    // altitude from a test is far more reliable than synthesising wheel events.
    (window as unknown as { __controls?: unknown }).__controls = controls.current;
  });

  useFrame(() => {
    const instance = controls.current;
    if (!instance) return;
    const radius = BODY_CONTRACTS[focus].equatorialRadiusM;
    viewport.setDistanceToSurface(Math.max(0, instance.distance - radius));
  });

  useEffect(() => {
    void size;
  }, [size]);

  return (
    <CameraControls
      ref={controls}
      makeDefault
      smoothTime={0.35}
      draggingSmoothTime={0.12}
      polarRotateSpeed={0.6}
      azimuthRotateSpeed={0.6}
    />
  );
}
