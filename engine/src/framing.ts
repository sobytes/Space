/**
 * How far a camera must sit to hold something in frame.
 *
 * Here rather than in either client because both were doing it with a constant distance, and a
 * constant distance frames a different amount of sky on every screen. Measured on the system
 * view before this existed: the iPhone held 1.80 au across the narrow axis in portrait, 3.90
 * in landscape and 2.73 on an iPad, so rotating the phone changed how much of the solar system
 * the solar system view contained. The browser had the same arrangement with a different
 * number, which is the other half of the same defect: the two clients disagreed about what
 * "the whole system" meant and neither of them said what it meant.
 *
 * Stating the radius and solving for the distance fixes both at once. The radius is the
 * decision; the distance is arithmetic.
 */

import { SHORT_SPAN } from "./data/planets";
import { AU_IN_METRES } from "./units";

/**
 * What the system view holds, as a radius: Mars's apoapsis with a fifth again for margin.
 *
 * A judgement, and the only one in this file. It holds every terrestrial planet, which is
 * every solid surface in the solar system, with enough room between them to tell them apart
 * and to label them. The giants are named by edge pointers, which is what those exist for.
 *
 * Wider was tried and measured, not argued away. At 3.3 au, the outer edge of the asteroid
 * belt, the inner four crowd inside a sixth of the frame and the probe that gates this reports
 * `embary, venus UNNAMED`: there is no arrangement of five plates in that space. Jupiter's
 * apoapsis, which the iOS camera comment claimed for years while the code held 1.80 au, is
 * worse again. A view that shows more of the system and can no longer say which planet is
 * which has traded the wrong thing, and labels were what was asked for.
 *
 * Written once because the two clients had drifted and neither said what it was framing: the
 * iPhone held 1.80 au across the narrow axis in portrait, 3.90 in landscape and 2.73 on an
 * iPad, so rotating the phone changed what "Solar system" contained. The radius is the
 * decision; `framingDistanceM` is the arithmetic.
 */
export const SYSTEM_VIEW_RADIUS_M =
  SHORT_SPAN.elements.mars.atJ2000.semiMajorAxisAu
  * (1 + SHORT_SPAN.elements.mars.atJ2000.eccentricity)
  * 1.2
  * AU_IN_METRES;

/**
 * The narrow axis, which is the one that crops.
 *
 * Both renderers specify a vertical field of view, so on a landscape window the vertical axis
 * is the short one and on a portrait window it is the horizontal. Solving against whichever is
 * smaller is what makes the framing the same on a phone held either way.
 */
export function narrowHalfAngle(verticalFovRadians: number, aspect: number): number {
  const vertical = verticalFovRadians / 2;
  const horizontal = Math.atan(Math.tan(vertical) * Math.max(aspect, 1e-6));
  return Math.min(vertical, horizontal);
}

/**
 * Distance at which `radiusM` fills `fill` of the half-frame on the narrow axis.
 *
 * `fill` is applied to the angle rather than to the radius, which is the convention the moon
 * framing already used: at 0.72 the thing being framed subtends 72% of the half-angle and the
 * rest is margin.
 */
export function framingDistanceM(
  radiusM: number,
  verticalFovRadians: number,
  aspect: number,
  fill: number,
): number {
  const half = narrowHalfAngle(verticalFovRadians, aspect) * fill;
  return radiusM / Math.tan(Math.max(half, 1e-6));
}
