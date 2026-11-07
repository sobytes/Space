/**
 * Where a body's name goes on screen, and whether it goes there at all.
 *
 * Labels exist because the honest rendering of this solar system is mostly empty space with
 * things in it too small to identify. A marker says "something is here"; only a label says
 * what. Asked for directly, with the Moon as the example: focused on Earth at six radii, the
 * Moon is sixty radii away and simply not in frame, so neither the sphere nor its marker can
 * help and no amount of looking harder finds it.
 *
 * That last case is the one this module exists for. A label for a body that is off screen is
 * clamped to the edge nearest it and flagged, so a client can draw it as a pointer rather
 * than drop it. "The Moon is that way, 384,000 km" answers the question; silence does not.
 *
 * The decisions live here rather than in either client because they are judgement calls with
 * numbers in them, and two clients making them separately is how the marker threshold came to
 * exist on the web and not on the phone. `labels.test.ts` gates the edges.
 */

import type { BodyId } from "./bodies/contract";
import { BODY_CONTRACTS } from "./bodies/registry";

export interface LabelInput {
  readonly id: BodyId;
  /** Normalised device coordinates, -1 to 1, x right and y up. */
  readonly ndcX: number;
  readonly ndcY: number;
  /** Apparent radius of the body in pixels. Decides how far the label sits from it. */
  readonly radiusPx: number;
  /** True camera distance in metres. Used only to order labels front to back. */
  readonly distance: number;
  readonly behindCamera: boolean;
  /** Whether this body is the focused one, or a satellite of it. */
  readonly relevance: "focus" | "satellite-of-focus" | "other";
}

export interface LabelPlacement {
  readonly id: BodyId;
  /** Centre of the label plate, in pixels from the top left of the viewport. */
  readonly x: number;
  readonly y: number;
  /** True when the body itself is outside the viewport and this is an edge pointer. */
  readonly clamped: boolean;
  /** Direction from the label towards the body, radians, screen space. Only when clamped. */
  readonly bearingRadians: number | null;
  /** Front to back, so a client can draw nearer labels over further ones. */
  readonly depth: number;
  /**
   * Whether this label has room for its second line.
   *
   * The second line is the body's own date and time, and it is three times the width of the
   * name. In the system view five of them land inside a hundred points of the Sun and cannot
   * all be drawn, which is how the inner planets came to be unlabelled entirely while edge
   * pointers for Jupiter and Neptune had the screen to themselves. Dropping a line is a far
   * better answer than dropping a label: a name still says which planet that is.
   */
  readonly detail: boolean;
}

export interface LabelOptions {
  readonly viewportWidthPx: number;
  readonly viewportHeightPx: number;
  /**
   * Keep the whole label plate this far inside the viewport.
   *
   * Not cosmetic, and measured against the plate rather than its anchor, which is the fix for
   * a real defect: the anchor was held 44 points in and the plate drawn centred on it, so a
   * two-line edge pointer 124 points wide hung 18 points off the side of the screen and its
   * date was sliced in half. On a phone the top strip is the status bar and the bottom is the
   * home indicator, so anything placed there is either clipped or under system chrome.
   */
  readonly edgeInsetPx?: number;
  readonly maximumLabels?: number;
  /**
   * Text metrics, as the shared guess both clients are drawn with.
   *
   * Neither a browser nor SwiftUI will tell this module how wide a string renders, and asking
   * either would make placement a client decision again, which is the thing this file exists
   * to prevent. An estimate that both clients share is wrong by a point or two everywhere and
   * wrong in the same direction, which is all the packing needs.
   */
  readonly charWidthPx?: number;
  /** Horizontal padding of the plate behind the text, both sides together. */
  readonly platePaddingPx?: number;
  readonly lineHeightPx?: number;
  /**
   * Width of the second line, which is a date and much the same length for every body.
   *
   * Measured off both clients rather than guessed. Jupiter's "day 23,711 · 01:49" draws 86
   * points wide on the phone; Earth's "2026-11-07 00:12 GMT+0", the longest line either client
   * produces, draws a 131 point plate in the browser, whose font is the wider of the two. The
   * default is that worst case with a few points over, because the costly direction is
   * underestimating: a plate wider than its reservation overlaps its neighbour, which is the
   * defect this module was rewritten to fix.
   */
  readonly detailWidthPx?: number;
  /**
   * How close two bodies may be on screen before the second is left unlabelled.
   *
   * From the system view Jupiter's four Galileans sit inside a pixel of Jupiter, and a label
   * placed off to one side of that pixel names any of the five equally. Moving it does not
   * disambiguate it, so the only honest answer is not to draw it.
   *
   * Deliberately tiny. This is a test for "the same pixel", not for "nearby": Mercury and the
   * Sun are eleven pixels apart in the default system view, and a threshold generous enough
   * to call that a collision takes the label off a planet anyone can plainly see.
   */
  readonly coincidencePx?: number;
}

const DEFAULTS = {
  edgeInsetPx: 44,
  maximumLabels: 12,
  charWidthPx: 6,
  platePaddingPx: 14,
  lineHeightPx: 15,
  detailWidthPx: 136,
  coincidencePx: 4,
};

/**
 * Where a label may sit relative to its body, in preference order.
 *
 * Up and to the right first, because that is where a reader looks for a caption and where
 * every label sat when there was only ever one way to place one. The rest exist because the
 * inner solar system puts four planets inside a hundred points of the Sun, and a label that
 * cannot go up-right is far better placed down-left than not placed at all.
 */
const DIRECTIONS: readonly (readonly [number, number])[] = [
  [Math.SQRT1_2, -Math.SQRT1_2],
  [-Math.SQRT1_2, -Math.SQRT1_2],
  [Math.SQRT1_2, Math.SQRT1_2],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [0, -1],
  [0, 1],
  [1, 0],
  [-1, 0],
];

interface Box {
  /** Centre. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function overlaps(a: Box, b: Box): boolean {
  return Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;
}

/**
 * Whether a plate would be drawn over some other body's disc, which reads as naming it.
 *
 * The disc counts for at most twenty pixels of it. A focused planet fills the screen, and
 * taking its full apparent radius here would mark every position on the viewport as blocked,
 * which is both useless and false: nobody reads a label at the edge as naming the planet
 * filling the frame. What this is guarding is the small bright dot that a nearby plate really
 * can be mistaken for belonging to.
 */
function covers(box: Box, pointX: number, pointY: number, radiusPx: number): boolean {
  const disc = Math.min(radiusPx, 20);
  return (
    Math.abs(box.x - pointX) < box.w / 2 + disc && Math.abs(box.y - pointY) < box.h / 2 + disc
  );
}

/**
 * Should this body be labelled at all?
 *
 * Everything in the registry at once is 32 labels over a black screen, which identifies
 * nothing. The focused body and its satellites are always worth naming, because they are what
 * the view is about and are the common case of "I cannot see it". Anything else is named only
 * while it is actually on screen.
 */
function worthLabelling(input: LabelInput): boolean {
  if (input.behindCamera) return input.relevance !== "other";
  if (input.relevance !== "other") return true;
  return Math.abs(input.ndcX) <= 1 && Math.abs(input.ndcY) <= 1;
}

/**
 * Which label wins when two sit on top of each other.
 *
 * Distance alone was the tie-break, and from the system view a moon is at its planet's
 * position to within a pixel, so whichever happened to be a few hundred thousand kilometres
 * nearer the camera took the label. The result was a solar system labelled Callisto, Iapetus
 * and Oberon with Jupiter, Saturn and Uranus unnamed, which is accurate about where things
 * are and useless as a map.
 *
 * Significance first, then distance. A planet outranks its own moons, and the focused body
 * and its satellites outrank everything, because those are what the view is about.
 */
function rank(input: LabelInput): number {
  if (input.relevance === "focus") return 0;
  if (input.relevance === "satellite-of-focus") return 1;
  switch (BODY_CONTRACTS[input.id].kind) {
    case "star":
      return 2;
    case "planet":
      return 3;
    default:
      return 4;
  }
}

function isOnScreen(input: LabelInput): boolean {
  return !input.behindCamera && Math.abs(input.ndcX) <= 1 && Math.abs(input.ndcY) <= 1;
}

/**
 * Turn projected bodies into label positions.
 *
 * Ordered by significance, then by what is actually visible, then nearest first; packed so
 * two plates never overlap; and capped. Clamped labels keep a bearing so a client can draw an
 * arrow; the bearing is measured in screen space with y downwards, which is the convention
 * both renderers draw in.
 */
export function placeLabels(
  inputs: readonly LabelInput[],
  options: LabelOptions,
): LabelPlacement[] {
  const edgeInset = options.edgeInsetPx ?? DEFAULTS.edgeInsetPx;
  const maximum = options.maximumLabels ?? DEFAULTS.maximumLabels;
  const charWidth = options.charWidthPx ?? DEFAULTS.charWidthPx;
  const platePadding = options.platePaddingPx ?? DEFAULTS.platePaddingPx;
  const lineHeight = options.lineHeightPx ?? DEFAULTS.lineHeightPx;
  const detailWidth = options.detailWidthPx ?? DEFAULTS.detailWidthPx;
  const coincidence = options.coincidencePx ?? DEFAULTS.coincidencePx;
  const width = options.viewportWidthPx;
  const height = options.viewportHeightPx;

  /**
   * Screen point of every body, labelled or not.
   *
   * Collected before anything is placed because a plate must not be dropped over a planet it
   * does not name, and the planet in the way is frequently one that is never labelled itself.
   */
  const points = new Map<BodyId, { x: number; y: number; radiusPx: number; onScreen: boolean }>();
  for (const input of inputs) {
    const ndcX = input.behindCamera ? -input.ndcX : input.ndcX;
    const ndcY = input.behindCamera ? -input.ndcY : input.ndcY;
    points.set(input.id, {
      x: ((ndcX + 1) / 2) * width,
      y: ((1 - ndcY) / 2) * height,
      radiusPx: input.radiusPx,
      onScreen: isOnScreen(input),
    });
  }

  const candidates = inputs
    .filter(worthLabelling)
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (isOnScreen(a) ? 0 : 1) - (isOnScreen(b) ? 0 : 1) ||
        a.distance - b.distance,
    );

  /** A label under construction: everything needed to re-place it at a different size. */
  interface Slot {
    readonly input: LabelInput;
    readonly point: { x: number; y: number; radiusPx: number; onScreen: boolean };
    readonly bearingRadians: number | null;
    readonly directions: readonly (readonly [number, number])[];
    readonly originX: number;
    readonly originY: number;
    readonly reach: (direction: readonly [number, number], w: number, h: number) => number;
    readonly sizes: readonly { w: number; h: number; detail: boolean }[];
    box: Box;
    detail: boolean;
  }

  /**
   * First box that neither covers another body nor collides with a label already taken.
   *
   * Two sweeps. The first refuses to drop a plate across another body; the second accepts that
   * rather than leave a visible planet unnamed, which is the worse of the two.
   */
  function fit(
    slot: Omit<Slot, "box" | "detail">,
    sizes: readonly { w: number; h: number; detail: boolean }[],
    taken: readonly Box[],
  ): { box: Box; detail: boolean } | null {
    for (const strict of [true, false]) {
      for (const direction of slot.directions) {
        for (const size of sizes) {
          const distance = slot.reach(direction, size.w, size.h);
          const box = clampBox(
            {
              x: slot.originX + direction[0] * distance,
              y: slot.originY + direction[1] * distance,
              w: size.w,
              h: size.h,
            },
            width,
            height,
            edgeInset,
          );
          if (taken.some((other) => overlaps(box, other))) continue;
          if (strict) {
            const blocked = inputs.some((other) => {
              if (other.id === slot.input.id) return false;
              const p = points.get(other.id)!;
              return p.onScreen && covers(box, p.x, p.y, p.radiusPx);
            });
            if (blocked) continue;
          }
          return { box, detail: size.detail };
        }
      }
    }
    return null;
  }

  /**
   * Two passes: every name first, then the dates that still fit.
   *
   * One greedy pass let an early body take a plate three times the width of its own name and
   * starve a later one of a label entirely. Measured in the default system view: Mercury took
   * a date and Earth, right next to it, came out unnamed. A name for every visible planet
   * beats a clock for one of them, so nothing claims the wider plate until every label that
   * can be placed has been.
   */
  const slots: Slot[] = [];
  const claimed: { x: number; y: number }[] = [];

  for (const input of candidates) {
    if (slots.length >= maximum) break;

    const point = points.get(input.id)!;

    // A second name on the same pixel names neither body. See `coincidencePx`.
    if (claimed.some((c) => Math.hypot(c.x - point.x, c.y - point.y) < coincidence)) continue;

    const nameWidth = BODY_CONTRACTS[input.id].displayName.length * charWidth + platePadding;
    const compact = { w: nameWidth, h: lineHeight + 6, detail: false };
    /**
     * A star never asks for the second line, because it has no local time to put there.
     *
     * The detail line is the body's own date read off its prime meridian, and `solarClock`
     * returns nothing for the Sun: a sub-solar point on the Sun is a division by zero, which
     * is what crashed the system view once already. Letting it reserve a plate three times
     * the width of "The Sun" and then draw nothing in the lower half held a hole open at the
     * busiest part of the screen and pushed a planet's clock out of it.
     */
    const sizes =
      BODY_CONTRACTS[input.id].kind === "star"
        ? [compact]
        : [{ w: Math.max(nameWidth, detailWidth), h: lineHeight * 2 + 6, detail: true }, compact];

    const onScreen = point.onScreen;
    let bearingRadians: number | null = null;
    let directions: readonly (readonly [number, number])[];
    let originX: number;
    let originY: number;
    let reach: (direction: readonly [number, number], w: number, h: number) => number;

    if (onScreen) {
      directions = DIRECTIONS;
      originX = point.x;
      originY = point.y;
      /**
       * Far enough out that the plate's near edge clears the disc, rather than its centre.
       *
       * The old rule offset the centre by a little more than the radius, so half the plate lay
       * back across the body it named and the name floated at a diagonal from it. Solving for
       * the plate's own extent along the chosen direction attaches its corner to the limb
       * instead, which is what was asked for.
       *
       * The body term is capped at 40 pixels, so a body larger than that is labelled across
       * its own disc. Deliberate: a focused planet fills most of the screen, there is no
       * outside to use, and a label flung to its limb would read as naming something else.
       */
      const bodyTerm = Math.min(40, Math.max(8, point.radiusPx + 8));
      reach = (direction, w, h) => bodyTerm + extentAlong(w, h, direction[0], direction[1]);
    } else {
      /**
       * Clamp to the edge the body lies beyond, along the line from the viewport centre.
       *
       * Scaling the whole direction vector rather than clamping each axis keeps the pointer on
       * the line of sight to the body. Clamping axes independently drags a label towards a
       * corner and points it at nothing.
       */
      const centreX = width / 2;
      const centreY = height / 2;
      const dx = point.x - centreX;
      const dy = point.y - centreY;
      const length = Math.hypot(dx, dy);
      bearingRadians = Math.atan2(dy, dx);
      originX = centreX;
      originY = centreY;
      directions = [length < 1e-9 ? [1, 0] : [dx / length, dy / length]];
      /**
       * Scale the whole vector down until the plate touches the safe area, rather than
       * clamping each axis. The band shrinks by the plate's own half-size, so a wide two-line
       * pointer stops with its edge on the inset instead of hanging off the screen.
       */
      reach = (_direction, w, h) => {
        const halfW = Math.max(1, centreX - edgeInset - w / 2);
        const halfH = Math.max(1, centreY - edgeInset - h / 2);
        const scale = Math.max(Math.abs(dx) / halfW, Math.abs(dy) / halfH, 1e-9);
        return length / scale;
      };
    }

    const partial = {
      input, point, bearingRadians, directions, originX, originY, reach, sizes,
    };
    const name = fit(partial, [compact], slots.map((s) => s.box));
    if (!name) continue;

    slots.push({ ...partial, box: name.box, detail: false });
    claimed.push({ x: point.x, y: point.y });
  }

  // Grow the ones with room, most significant first, against everything already settled.
  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i];
    const wider = slot.sizes.filter((size) => size.detail);
    if (wider.length === 0) continue;
    const others = slots.filter((_, j) => j !== i).map((s) => s.box);
    const grown = fit(slot, wider, others);
    if (!grown) continue;
    slot.box = grown.box;
    slot.detail = true;
  }

  return slots.map((slot) => ({
    id: slot.input.id,
    x: slot.box.x,
    y: slot.box.y,
    clamped: !slot.point.onScreen,
    bearingRadians: slot.bearingRadians,
    depth: slot.input.distance,
    detail: slot.detail,
  }));
}

/** How far the plate's own edge lies from its centre along a unit direction. */
function extentAlong(w: number, h: number, dx: number, dy: number): number {
  const horizontal = Math.abs(dx) < 1e-9 ? Infinity : w / 2 / Math.abs(dx);
  const vertical = Math.abs(dy) < 1e-9 ? Infinity : h / 2 / Math.abs(dy);
  return Math.min(horizontal, vertical);
}

/**
 * Hold the whole plate inside the safe area.
 *
 * A plate wider than the band is centred rather than pushed off one side, because half of a
 * date on the left reads no better than half of it on the right.
 */
function clampBox(box: Box, width: number, height: number, inset: number): Box {
  const clampAxis = (value: number, size: number, limit: number): number => {
    const low = inset + size / 2;
    const high = limit - inset - size / 2;
    if (low > high) return limit / 2;
    return Math.min(high, Math.max(low, value));
  };
  return {
    ...box,
    x: clampAxis(box.x, box.w, width),
    y: clampAxis(box.y, box.h, height),
  };
}
