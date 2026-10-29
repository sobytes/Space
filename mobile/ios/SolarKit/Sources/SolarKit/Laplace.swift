import Foundation

/**
 The Laplace surface, the warped plane a distant satellite actually orbits in.

 Close to a planet its oblateness dominates and a moon follows the equatorial plane. Far out
 the Sun dominates and it follows the planet's orbital plane. The Laplace surface is the
 transition. Treating everything as equatorial puts Iapetus and Phoebe visibly wrong.

 A port of `engine/src/bodies/laplace.ts`. See `contracts/satellite-reference-planes`.

 > Tremaine, Touma & Namouni, "Satellite Dynamics on the Laplace Surface",
 > The Astronomical Journal 137 (2009), 3706.
 */

/// Second zonal harmonic. Oblateness, which is what makes a close orbit follow the equator.
public let j2: [BodyId: Double] = [
    .embary: 1.08263e-3,
    .mars: 1.96045e-3,
    .jupiter: 1.4736e-2,
    .saturn: 1.6298e-2,
    .uranus: 3.34343e-3,
    .neptune: 3.411e-3,
]

/**
 The Laplace radius: where the Sun's torque on a satellite's orbit equals the planet's
 oblateness torque.

     r_L^5 = 2 J2 R_p^2 a_p^3 (M_p / M_sun)

 The leading 2 is not decorative. Dropping it shrinks r_L by 2^(1/5), about 15%, which shifts
 every Laplace-plane satellite's orbital plane and moved Phoebe 16,393,484 km in this port
 before the cross-language gate caught it.
 */
public func laplaceRadiusM(_ planet: BodyId) -> Double? {
    guard let j2Value = j2[planet], let contract = bodyContracts[planet] else { return nil }
    guard case let .standishElements(standishPlanet) = contract.ephemeris else { return nil }
    guard let elements = shortSpan.elements[standishPlanet] else { return nil }

    let planetOrbitM = toMetres(au(elements.atJ2000.semiMajorAxisAu))
    let massRatio = contract.gm / Constants.gmSun
    let fifth = 2 * j2Value
        * contract.equatorialRadiusM * contract.equatorialRadiusM
        * planetOrbitM * planetOrbitM * planetOrbitM
        * massRatio
    return pow(fifth, 1.0 / 5.0)
}

/**
 Tilt of the Laplace plane away from the planet's orbital plane, radians.

     tan(2 i_L) = sin(2 eps) / ( cos(2 eps) + (a / r_L)^5 )

 with eps the planet's obliquity. Close in the ratio vanishes and i_L tends to eps, so the
 plane coincides with the equator. Far out the ratio dominates and i_L tends to zero, so the
 plane coincides with the planet's orbit.
 */
public func laplaceTiltFromOrbit(
    obliquityRad: Double,
    semiMajorAxisM: Double,
    laplaceRadiusM r: Double
) -> Double {
    let ratio = pow(semiMajorAxisM / r, 5)
    return 0.5 * atan2(sin(2 * obliquityRad), cos(2 * obliquityRad) + ratio)
}

public struct PlaneOrientation: Sendable {
    /// Unit normal of the orbital plane, in the J2000 ecliptic frame.
    public let pole: Vec3
    /// How far the plane sits from the planet's equator, degrees. Zero means equatorial.
    public let tiltFromEquatorDeg: Double
}

/**
 The Laplace plane's pole for one satellite, in ecliptic coordinates.

 The pole lies on the arc between the planet's spin pole and its orbit pole, and for
 everything here the orbit pole is close enough to the ecliptic pole to use directly: the
 planets' orbital inclinations are a couple of degrees, far below the tens of degrees this is
 resolving between. So the construction is simply the ecliptic pole tilted by the plane's
 angle from the orbit, swung round to the spin pole's own longitude.
 */
public func laplacePlaneFor(
    planet: BodyId,
    semiMajorAxisM: Double,
    at epoch: JdTdb
) -> PlaneOrientation {
    let spinPole = orientationOf(planet, at: epoch).poleEcliptic
    guard let radius = laplaceRadiusM(planet) else {
        // No oblateness figure means no transition to compute; fall back to the equator.
        return PlaneOrientation(pole: spinPole, tiltFromEquatorDeg: 0)
    }

    // The absolute value matters: a retrograde planet's IAU pole points south, and the
    // obliquity this formula wants is the angle to the orbit plane, not to ecliptic north.
    let obliquity = acos(min(1, max(-1, abs(spinPole.z))))
    let tiltFromOrbit = laplaceTiltFromOrbit(
        obliquityRad: obliquity, semiMajorAxisM: semiMajorAxisM, laplaceRadiusM: radius
    )
    let azimuth = atan2(spinPole.y, spinPole.x)
    let pole = Vec3(0, 0, 1).rotatedAboutX(tiltFromOrbit).rotatedAboutZ(azimuth).normalised

    return PlaneOrientation(
        pole: pole,
        tiltFromEquatorDeg: (obliquity - tiltFromOrbit) * 180 / Double.pi
    )
}

/// Rotation taking a plane's local frame into the ecliptic, given that plane's pole.
public func intoPlane(_ local: Vec3, pole: Vec3) -> Vec3 {
    let tilt = acos(min(1, max(-1, pole.z)))
    let azimuth = atan2(pole.y, pole.x)
    return local.rotatedAboutX(tilt).rotatedAboutZ(azimuth)
}
