"use client";

import { useEffect, useState } from "react";
import { BODY_CONTRACTS, childrenOf } from "@solar/engine/bodies/registry";
import { placeLabels, type LabelInput } from "@solar/engine/labels";
import { localTimeLabel } from "@solar/engine/solar-time";
import { useViewport } from "./ViewportContext";

/**
 * Names over the scene, including for bodies that are not on screen.
 *
 * Drawn in the DOM rather than as geometry, for the same reason the iOS client draws it in
 * SwiftUI: text in the 3D scene has to be rasterised per body and rescaled every frame to
 * stay a constant size, and it still cannot reach a body outside the frustum. That last case
 * is the one labels exist for. Focused on Earth, the Moon is sixty radii away and simply not
 * in frame, so there is nothing on screen to look harder at.
 *
 * Placement comes from `@solar/engine/labels`, shared with the phone and gated by the
 * conformance suite, so the two clients clamp and thin labels identically.
 */
export function LabelLayer({ visible }: { visible: boolean }) {
  const viewport = useViewport();
  const [frame, setFrame] = useState(0);

  /**
   * Repainted on an animation frame rather than from the viewport's snapshot.
   *
   * The snapshot is published on a throttle, deliberately, so that the HUD's text does not
   * re-render sixty times a second. Labels have to track the bodies exactly or they visibly
   * lag behind them during a drag, so they are the one part of the overlay that does want
   * every frame.
   */
  useEffect(() => {
    if (!visible) return;
    let handle = 0;
    const tick = () => {
      setFrame((n) => n + 1);
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [visible]);
  void frame;

  if (!visible) return null;

  const { focus, epoch: publishedEpoch } = viewport.snapshot();
  const satellites = new Set(childrenOf(focus));
  const width = window.innerWidth;
  const height = window.innerHeight;

  const inputs: LabelInput[] = viewport.screen.map((placement) => ({
    id: placement.id,
    ndcX: placement.ndcX,
    ndcY: placement.ndcY,
    radiusPx: placement.radiusPx,
    distance: placement.distance,
    behindCamera: placement.behindCamera,
    relevance:
      placement.id === focus
        ? "focus"
        : satellites.has(placement.id)
          ? "satellite-of-focus"
          : "other",
  }));

  const placements = placeLabels(inputs, {
    viewportWidthPx: width,
    viewportHeightPx: height,
  });

  return (
    // Nothing here takes a pointer event. The canvas underneath owns every gesture, and a
    // label that swallowed a drag would break the camera wherever one happened to be.
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {placements.map((placement) => {
        const contract = BODY_CONTRACTS[placement.id];
        const isFocus = placement.id === focus;
        /**
         * Satellites of the focus, except in the system view, where every planet is one.
         *
         * The first version of this rule said "the focus and its satellites", which in the
         * system view means the Sun and all eight planets, so nothing was thinned and the
         * sprawl stayed exactly as reported. Focusing a planet is the case the full badge is
         * for: two or three labels, and the Moon's month next to Earth's year.
         */
        const localTime = localTimeLabel(placement.id, publishedEpoch);
        // The arrow goes on the side the body is on. Always placing it first put a pointer
        // on the left of a name whose body was off to the right.
        const trailing =
          placement.bearingRadians !== null && Math.abs(placement.bearingRadians) < Math.PI / 2;
        const arrow =
          placement.clamped && placement.bearingRadians !== null ? (
            <span
              aria-hidden
              className="inline-block text-[8px] leading-none"
              style={{ transform: `rotate(${placement.bearingRadians}rad)` }}
            >
              ▶
            </span>
          ) : null;

        return (
          <div
            key={placement.id}
            className={`absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center whitespace-nowrap rounded-lg px-1.5 py-0.5 ${
              isFocus
                ? "bg-black/35 text-[12px] font-medium text-white"
                : "bg-black/35 text-[10px] text-white/70"
            } ${placement.clamped ? "bg-black/55" : ""}`}
            style={{ left: placement.x, top: placement.y }}
          >
            <span className="flex items-center gap-1">
              {!trailing ? arrow : null}
              {contract.displayName}
              {trailing ? arrow : null}
            </span>
            {/*
              The day and the orbit, under the name.

              The panel was the wrong place for this. It is the first thing anyone hides to
              look at the planets, and with it hidden there was no time anywhere on screen.
              Here the labels sit side by side, so Earth's year and the Moon's month can be
              compared rather than remembered.

              On clamped labels too, which was not the first instinct. An edge pointer is
              exactly where the Moon's label usually ends up while framed with Earth, so
              suppressing it there removed the one comparison most worth having. The clamp
              keeps labels 44 px inside the viewport, which is room enough for a second line.
            */}
            {/*
              The date and time where that body is, now, ticking with the clock.

              This showed how long a day and a year last there, which is a fact about the body
              rather than a clock, and was asked to be the reading instead. Earth gets the
              calendar because Earth has one; everywhere else gets a count of its own days and
              the time at its prime meridian, which is what Mars missions actually run on.

              Read from the throttled epoch, not the animation frame this layer redraws on: a
              clock showing minutes has no use for sixty ephemeris evaluations a second.
            */}
            {localTime !== null ? (
              <span className="font-mono text-[9px] leading-tight tabular-nums text-white/50">
                {localTime}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
