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
  /** Pixels from the top left of the viewport. */
  readonly x: number;
  readonly y: number;
  /** True when the body itself is outside the viewport and this is an edge pointer. */
  readonly clamped: boolean;
  /** Direction from the label towards the body, radians, screen space. Only when clamped. */
  readonly bearingRadians: number | null;
  /** Front to back, so a client can draw nearer labels over further ones. */
  readonly depth: number;
}

export interface LabelOptions {
  readonly viewportWidthPx: number;
  readonly viewportHeightPx: number;
  /**
   * Keep an edge-clamped label this far inside the viewport.
   *
   * Not cosmetic. A label pinned exactly to the edge is half off it, and on a phone the top
   * strip is the status bar and the bottom is the home indicator, so a pointer placed there
   * is either clipped or sitting under system chrome.
   */
  readonly edgeInsetPx?: number;
  /** Labels closer together than this are thinned, nearest kept. */
  readonly minimumSeparationPx?: number;
  readonly maximumLabels?: number;
}

const DEFAULTS = {
  edgeInsetPx: 44,
  /**
   * How close two label anchors may be before the less significant one is dropped.
   *
   * Raised from 46 when labels gained a second line carrying the body's day and year. Forty
   * six was measured against a bare name: "Mars" is about fifty points wide, so anchors that
   * far apart barely touched. A label is now two lines and several times wider, and at the old
   * spacing they sprawled across each other and across neighbouring planets, which read as the
   * times being attached to the wrong bodies. Reported as exactly that.
   */
  minimumSeparationPx: 64,
  maximumLabels: 12,
};

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
 * Ordered nearest first, thinned so two labels never sit on top of each other, and capped.
 * Clamped labels keep a bearing so a client can draw an arrow; the bearing is measured in
 * screen space with y downwards, which is the convention both renderers draw in.
 */
export function placeLabels(
  inputs: readonly LabelInput[],
  options: LabelOptions,
): LabelPlacement[] {
  const edgeInset = options.edgeInsetPx ?? DEFAULTS.edgeInsetPx;
  const separation = options.minimumSeparationPx ?? DEFAULTS.minimumSeparationPx;
  const maximum = options.maximumLabels ?? DEFAULTS.maximumLabels;
  const width = options.viewportWidthPx;
  const height = options.viewportHeightPx;

  const candidates = inputs
    .filter(worthLabelling)
    .sort((a, b) => rank(a) - rank(b) || a.distance - b.distance);

  const placed: LabelPlacement[] = [];
  for (const input of candidates) {
    if (placed.length >= maximum) break;

    /**
     * A body behind the camera projects to a point that is mathematically correct and
     * visually a lie: the perspective divide by a negative depth mirrors it through the
     * origin, so something directly behind you appears dead ahead. Negating both axes puts
     * the pointer on the correct side, which is the side you would turn towards.
     */
    const ndcX = input.behindCamera ? -input.ndcX : input.ndcX;
    const ndcY = input.behindCamera ? -input.ndcY : input.ndcY;

    const screenX = ((ndcX + 1) / 2) * width;
    const screenY = ((1 - ndcY) / 2) * height;
    const onScreen = isOnScreen(input);

    let x: number;
    let y: number;
    let bearingRadians: number | null = null;

    if (onScreen) {
      /**
       * Up and to the right of the body's centre, by a little more than its radius.
       *
       * Capped at 40 pixels, which means a body larger than that is labelled across its own
       * disc rather than outside it. That is deliberate: a focused planet fills most of the
       * screen, so there is no outside to use, and a label flung to the edge would read as
       * belonging to something else. The plate behind the text is what keeps it legible over
       * a lit surface.
       */
      const offset = Math.min(40, Math.max(10, input.radiusPx + 10));
      x = screenX + offset * 0.7;
      y = screenY - offset * 0.7;
    } else {
      /**
       * Clamp to the edge the body lies beyond, along the line from the viewport centre.
       *
       * Scaling the whole direction vector rather than clamping each axis keeps the pointer
       * on the line of sight to the body. Clamping axes independently drags a label towards
       * a corner and points it at nothing.
       */
      const centreX = width / 2;
      const centreY = height / 2;
      const dx = screenX - centreX;
      const dy = screenY - centreY;
      const halfW = Math.max(1, centreX - edgeInset);
      const halfH = Math.max(1, centreY - edgeInset);
      const scale = Math.max(Math.abs(dx) / halfW, Math.abs(dy) / halfH, 1e-9);
      x = centreX + dx / scale;
      y = centreY + dy / scale;
      bearingRadians = Math.atan2(dy, dx);
    }

    x = Math.min(width - edgeInset, Math.max(edgeInset, x));
    y = Math.min(height - edgeInset, Math.max(edgeInset, y));

    // Thin out collisions, keeping whichever the sort already put first: the more significant
    // body, and between equals the nearer one.
    const collides = placed.some(
      (other) => Math.hypot(other.x - x, other.y - y) < separation,
    );
    if (collides) continue;

    placed.push({
      id: input.id,
      x,
      y,
      clamped: !onScreen,
      bearingRadians,
      depth: input.distance,
    });
  }

  return placed;
}
