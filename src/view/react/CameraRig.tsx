"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { CameraControls } from "@react-three/drei";
import type CameraControlsImpl from "camera-controls";
import { BODY_CONTRACTS } from "@/engine/bodies/registry";
import type { ViewportSnapshot } from "../core/viewport";
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
