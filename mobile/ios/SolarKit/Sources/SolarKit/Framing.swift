import Foundation

/**
 How far a camera must sit to hold something in frame.

 Ported from `engine/src/framing.ts` and gated by the conformance suite. Both clients used a
 constant distance, and a constant distance frames a different amount of sky on every screen:
 the system view held 1.80 au across the narrow axis in portrait, 3.90 in landscape and 2.73
 on an iPad, so rotating the phone changed how much of the solar system the solar system view
 contained. Stating the radius and solving for the distance fixes that; the radius is the
 decision and the distance is arithmetic.
 */

/**
 What the system view holds, as a radius: Mars's apoapsis with a fifth again for margin.

 It holds every terrestrial planet, which is every solid surface in the solar system, with
 enough room to tell them apart and to label them. The giants are named by edge pointers.

 Wider was tried and measured. At 3.3 au the inner four crowd inside a sixth of the frame and
 the focus probe reports `embary, venus UNNAMED`; Jupiter's apoapsis, which this camera's
 comment claimed for years while the code held 1.80 au, is worse again. A view that shows more
 of the system and can no longer say which planet is which has traded the wrong thing.
 */
public let systemViewRadiusM: Double = {
    let m = shortSpan.elements[.mars]!.atJ2000
    return m.semiMajorAxisAu * (1 + m.eccentricity) * 1.2 * Constants.auInMetres
}()

/**
 The narrow axis, which is the one that crops.

 Both renderers specify a vertical field of view, so on a landscape window the vertical axis is
 the short one and on a portrait window it is the horizontal. Solving against whichever is
 smaller is what makes the framing the same on a phone held either way.
 */
public func narrowHalfAngle(verticalFovRadians: Double, aspect: Double) -> Double {
    let vertical = verticalFovRadians / 2
    let horizontal = atan(tan(vertical) * Swift.max(aspect, 1e-6))
    return Swift.min(vertical, horizontal)
}

/// Distance at which `radiusM` fills `fill` of the half-frame on the narrow axis.
public func framingDistanceM(
    radiusM: Double, verticalFovRadians: Double, aspect: Double, fill: Double
) -> Double {
    let half = narrowHalfAngle(verticalFovRadians: verticalFovRadians, aspect: aspect) * fill
    return radiusM / tan(Swift.max(half, 1e-6))
}
