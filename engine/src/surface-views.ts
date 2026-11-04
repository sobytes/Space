/**
 * Standing on another world, with real photographs.
 *
 * The data is in `data/surface-imagery.ts`; this decides what a client should say for a body
 * that has none, which is most of them. Saying nothing would be the easy option and the wrong
 * one: the reason there is no photograph of Mercury's surface is itself the interesting fact,
 * and it differs from the reason there is none of Jupiter's.
 *
 * Five worlds have ever been photographed from their own surface: Earth, the Moon, Mars,
 * Venus and Titan. Seventy years of spaceflight, five surfaces. A feature that quietly filled
 * the gaps with orbital views or artwork would teach the opposite of that.
 */

import { contractFor } from "./bodies/registry";
import type { BodyId } from "./bodies/contract";
import { SURFACE_IMAGERY, type SurfaceImage, type SurfaceImagery } from "./data/surface-imagery";
import { environmentFor } from "./habitability";

export type { SurfaceImage, SurfaceImagery };

export interface SurfaceView {
  readonly body: BodyId;
  readonly displayName: string;
  readonly images: readonly SurfaceImage[];
  /** Why there is nothing to show, where there is nothing. Always worth reading. */
  readonly statement: string;
  readonly caveat?: string;
  /** Where to see images this project links to rather than hosts. */
  readonly seeAlso?: { readonly label: string; readonly url: string };
}

/**
 * Why has nobody photographed the surface of this body?
 *
 * Derived rather than written out per body, because the answers fall into a few kinds and the
 * kind is already known from the contracts. A gas giant has no surface to stand on at any
 * depth; a moon of Saturn has simply never been visited by anything that landed.
 */
function absenceStatement(id: BodyId): string {
  const contract = contractFor(id);
  const name = contract.displayName;

  if (contract.kind === "star") {
    return (
      `${name} has no surface. The photosphere is the depth at which its plasma stops being `
      + "opaque, not a boundary, and it is above the boiling point of every element. Nothing "
      + "has photographed it from close range and nothing could."
    );
  }

  if (!environmentFor(id).environment.hasSolidSurface) {
    return (
      `${name} has no surface to photograph. Pressure and temperature rise continuously with `
      + "depth until the hydrogen turns metallic, so there is no level at which a camera could "
      + "stand. The Galileo probe fell into Jupiter in 1995 and returned data for 58 minutes, "
      + "but it carried no camera."
    );
  }

  if (contract.kind === "moon") {
    return (
      `Nothing has ever landed on ${name}. Two moons have been photographed from their own `
      + "surface: Earth's Moon, by Apollo and by the Soviet Luna landers, and Titan, by Huygens "
      + "for 72 minutes in 2005. Everything known about this one's surface comes from flybys "
      + "and orbiters."
    );
  }

  return (
    `Nothing has ever photographed the surface of ${name} from the ground. Of the eight `
    + "planets, only Venus, Earth and Mars have been landed on with a working camera."
  );
}

export function surfaceViewFor(id: BodyId): SurfaceView {
  const contract = contractFor(id);
  const entry = SURFACE_IMAGERY[id];

  if (!entry) {
    return {
      body: id,
      displayName: contract.displayName,
      images: [],
      statement: absenceStatement(id),
    };
  }

  /**
   * A world can have been photographed and still have nothing to show.
   *
   * Venus is the case, and the first version of this contradicted itself over it: zero images
   * fell through to the absence statement, which said nothing had ever photographed Venus
   * from the ground, directly above a caveat explaining that Venera did it four times. The
   * question of whether it happened and the question of whether the pictures can be shown
   * here are different questions, and only the first one is about Venus.
   */
  const statement = entry.photographedFromSurface
    ? entry.images.length > 0
      ? `Photographed from the surface of ${contract.displayName}.`
      : `${contract.displayName} has been photographed from its surface, but not by anything `
        + "whose images can be shown here."
    : absenceStatement(id);

  return {
    body: id,
    displayName: contract.displayName,
    images: entry.images,
    statement,
    caveat: entry.caveat,
    seeAlso: entry.seeAlso,
  };
}

/** Everything that has ever been photographed from its own surface. Five worlds. */
export function worldsPhotographedFromTheirSurface(): BodyId[] {
  return (Object.keys(SURFACE_IMAGERY) as BodyId[]).filter(
    (id) => SURFACE_IMAGERY[id]?.photographedFromSurface,
  );
}
