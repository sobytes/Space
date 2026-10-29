import Foundation

/**
 Osculating orbital elements from a state vector.

 "Osculating" means the elements of the Keplerian orbit the body would follow from here if
 every perturbation switched off. Under perturbation they drift, and that drift is the signal:
 an apsidal precession rate is the secular trend in `longitudeOfPericentre`.

 A port of `engine/src/elements.ts`. The distinction that matters, from
 `contracts/physics-and-mathematics`: `longitudeOfPericentre` is varpi = Omega + omega, with
 omega measured in the body's own orbital plane. It is **not** the ecliptic longitude of the
 eccentricity vector. For a coplanar orbit they agree; for an inclined one their secular rates
 differ, and for Mercury at 7 degrees that is 2.6 arcsec/century in a quantity whose whole
 significance is a 43 arcsec/century residual.
 */

/// e = ((v.v - mu/r) r - (r.v) v) / mu. Points from the focus to pericentre.
public func eccentricityVector(gm: Double, position: Vec3, velocity: Vec3) -> Vec3 {
    let r = position.length
    return (position * (velocity.dot(velocity) - gm / r) - velocity * position.dot(velocity)) / gm
}

public struct OsculatingElements: Sendable {
    public let semiMajorAxisM: Double
    public let eccentricity: Double
    public let inclinationRad: Double
    public let longitudeOfAscendingNodeRad: Double
    public let argumentOfPericentreRad: Double
    /// varpi = Omega + omega. The quantity apsidal precession rates are quoted for.
    public let longitudeOfPericentreRad: Double
    /// Ecliptic longitude of the eccentricity vector. Equals varpi only when coplanar.
    public let projectedPericentreLongitudeRad: Double
}

public func osculatingElements(gm: Double, position: Vec3, velocity: Vec3) -> OsculatingElements {
    let h = position.cross(velocity)
    let hLength = h.length
    precondition(hLength > 0, "radial trajectory: the orbital plane is undefined")
    let hHat = h / hLength

    let e = eccentricityVector(gm: gm, position: position, velocity: velocity)
    let eccentricity = e.length

    // The node line is where the orbital plane meets the reference plane. For a non-inclined
    // orbit it is undefined, so fall back to the reference x axis, which keeps varpi
    // continuous as the inclination passes through zero.
    let equatorial = (h.x * h.x + h.y * h.y) == 0
    let node = equatorial ? Vec3(1, 0, 0) : Vec3(-h.y, h.x, 0).normalised
    let ascendingNode = equatorial ? 0 : atan2(h.x, -h.y)

    // Signed in-plane angle from the node to pericentre, with the orbit normal fixing the sign.
    let argument = eccentricity == 0
        ? 0
        : atan2(hHat.dot(node.cross(e)), node.dot(e))

    let r = position.length
    return OsculatingElements(
        semiMajorAxisM: 1 / (2 / r - velocity.dot(velocity) / gm),
        eccentricity: eccentricity,
        inclinationRad: acos(min(1, max(-1, hHat.z))),
        longitudeOfAscendingNodeRad: ascendingNode,
        argumentOfPericentreRad: argument,
        longitudeOfPericentreRad: ascendingNode + argument,
        projectedPericentreLongitudeRad: atan2(e.y, e.x)
    )
}

/// Specific orbital energy about the central body, J/kg. Negative is bound.
public func specificEnergy(centralGm: Double, position: Vec3, velocity: Vec3) -> Double {
    velocity.dot(velocity) / 2 - centralGm / position.length
}

/// Orbital eccentricity from a state vector. At or above one the orbit is unbound.
public func eccentricityOf(centralGm: Double, position: Vec3, velocity: Vec3) -> Double {
    eccentricityVector(gm: centralGm, position: position, velocity: velocity).length
}
