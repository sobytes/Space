import Foundation

/**
 Orientation from the IAU rotational elements.

 A port of `engine/src/rotation.ts`. See `contracts/rotation-and-poles` for the rules,
 including the one that catches people out: the IAU defines north by the invariable plane of
 the solar system while fact sheets define it by the body's own spin, so for a retrograde body
 the two poles are exactly 180 degrees apart. Retrograde rotation shows up as a negative W1,
 not as a flipped pole.
 */

/// Obliquity of the ecliptic at J2000, degrees. IAU 2006.
public let obliquityJ2000Deg = Constants.obliquityJ2000Arcsec / 3600

public struct Orientation: Sendable {
    /// Unit vector along the body's north pole, in the J2000 ecliptic frame.
    public let poleEcliptic: Vec3
    /// Rotation of the prime meridian about the pole, radians, wrapped to [0, 2pi).
    public let spin: Double
    /// Angle between the pole and ecliptic north, radians. The axial tilt as drawn.
    public let tilt: Double
    /// Direction the pole leans, measured in the ecliptic plane, radians.
    public let poleAzimuth: Double
}

/// A unit vector from a right ascension and declination, in the frame they were given in.
private func direction(raRad: Double, decRad: Double) -> Vec3 {
    Vec3(cos(decRad) * cos(raRad), cos(decRad) * sin(raRad), sin(decRad))
}

/**
 Rotates an equatorial vector into the ecliptic.

 The IAU publishes poles in the J2000 **equatorial** frame and everything else here is
 ecliptic, so this is not optional. Skipping it tilts every body by 23.4 degrees, which looks
 almost right and is wrong for all of them.
 */
public func equatorialToEcliptic(_ v: Vec3) -> Vec3 {
    v.rotatedAboutX(-toRadians(deg(obliquityJ2000Deg)))
}

public func orientation(from elements: RotationalElements, at epoch: JdTdb) -> Orientation {
    let centuries = julianCenturiesSinceJ2000(epoch)
    let days = epoch.value - Epochs.j2000

    let raRad = toRadians(deg(elements.poleRaDeg + elements.poleRaRateDegPerCentury * centuries))
    let decRad = toRadians(deg(elements.poleDecDeg + elements.poleDecRateDegPerCentury * centuries))

    let pole = equatorialToEcliptic(direction(raRad: raRad, decRad: decRad))
    let spin = normaliseAngle(
        toRadians(deg(elements.primeMeridianDeg + elements.rotationRateDegPerDay * days))
    )

    return Orientation(
        poleEcliptic: pole,
        spin: spin,
        tilt: acos(min(1, max(-1, pole.z))),
        poleAzimuth: atan2(pole.y, pole.x)
    )
}

public func orientationOf(_ body: BodyId, at epoch: JdTdb) -> Orientation {
    orientation(from: bodyContracts[body]!.rotation, at: epoch)
}

/**
 Sidereal rotation period in days, signed, derived from W1 rather than stored.

 Derived so it cannot drift from the rate that actually turns the body. Negative is retrograde.
 */
public func rotationPeriodDays(_ body: BodyId) -> Double {
    360 / bodyContracts[body]!.rotation.rotationRateDegPerDay
}

/**
 Axial tilt in the convention the fact sheets use, degrees.

 `Orientation.tilt` is the angle between the IAU pole and ecliptic north. That is not what a
 fact sheet calls obliquity for a retrograde body, because the IAU picks the pole north of the
 invariable plane whatever direction the body spins while the fact sheet picks the one the
 right-hand rule gives for the actual rotation. The two differ by exactly 180 degrees.

 So Uranus's IAU pole sits 82.23 degrees from ecliptic north and its published obliquity is
 97.77; Venus is 2.6 against 177.4. Both are correct. Mixing them silently flips a planet
 upside down, which is why the conversion is written here rather than left to be rediscovered.
 */
public func obliquityToOrbitDeg(_ body: BodyId, at epoch: JdTdb) -> Double {
    let tiltDeg = orientationOf(body, at: epoch).tilt * 180 / Double.pi
    let retrograde = bodyContracts[body]!.rotation.rotationRateDegPerDay < 0
    return retrograde ? 180 - tiltDeg : tiltDeg
}
