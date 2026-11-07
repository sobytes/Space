"use client";

import { useEffect, useState } from "react";
import { BODY_CONTRACTS, childrenOf } from "@solar/engine/bodies/registry";
import { placeLabels, type LabelInput } from "@solar/engine/labels";
import { localTimeLabel } from "@solar/engine/solar-time";
import { epochMsFromJdUtc, utcFromTdb } from "@solar/engine/time";
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

  /**
   * The viewer's own zone, named, because "what time is it on Earth" means the clock on their
   * wall and a time with no zone on it is just a number that looks like one.
   *
   * Resolved for the instant being shown rather than for now, so scrubbing to a date in July
   * carries the offset that was actually in force then, not today's.
   */
  const zone = (() => {
    const date = new Date(epochMsFromJdUtc(utcFromTdb(publishedEpoch)));
    const named = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")?.value;
    return { offsetMinutes: -date.getTimezoneOffset(), label: named ?? "UTC" };
  })();
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
         * Whether this label carries a clock is `placeLabels`' decision, not this view's.
         *
         * It was this view's, twice, and both rules were wrong because they were guesses about
         * crowding made without knowing where anything had landed: first "the focus and its
         * satellites", which in the system view is the Sun and all eight planets and thinned
         * nothing, then a rank rule that silenced the comparison it existed for. The module
         * that places the plates is the only thing that knows whether there is room for a
         * second line.
         */
        const localTime = placement.detail
          ? localTimeLabel(placement.id, publishedEpoch, zone)
          : null;
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
              suppressing it there removed the one comparison most worth having.

              Drawn only where `placeLabels` found room for it. A date is three times the width
              of a name, and five of them will not fit across the inner solar system at any
              arrangement; the previous answer was to drop whole labels until they did, which
              left Mercury, Venus, Earth and Mars unnamed in the system view with edge pointers
              to off-screen giants as the only labels on the screen. Dropping a line keeps the
              name, and the name is what says which planet that is.
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
