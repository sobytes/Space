import Foundation

/**
 The first post-Newtonian correction, and the number that earned general relativity belief.

 A port of `engine/src/relativity.ts`. See `contracts/physics-and-mathematics` section 6.
 */

public let speedOfLight: Double = 299_792_458
private let c2 = speedOfLight * speedOfLight

/**
 Einstein-Infeld-Hoffmann acceleration for a test body about a central mass, to order 1/c^2.

     a = (GM / c^2 r^3) [ (4GM/r - v^2) r + 4 (r . v) v ]

 Integrated over one orbit this reproduces the closed form below, which is the check that the
 gauge and the factors are right.

 > Einstein, Infeld & Hoffmann, "The Gravitational Equations and the Problem of Motion",
 > Annals of Mathematics 39 (1938), 65-100.
 */
public func postNewtonianAcceleration(gm: Double, position: Vec3, velocity: Vec3) -> Vec3 {
    let r2 = position.lengthSquared
    let r = r2.squareRoot()
    let v2 = velocity.lengthSquared
    let rDotV = position.dot(velocity)

    let prefactor = gm / (c2 * r2 * r)
    let radial = 4 * (gm / r) - v2
    return (position * radial + velocity * (4 * rDotV)) * prefactor
}

/**
 The closed-form relativistic advance of perihelion per orbit, in radians.

     dvarpi = 6 pi GM / (c^2 a (1 - e^2))

 > Einstein, "Erklarung der Perihelbewegung des Merkur aus der allgemeinen
 > Relativitatstheorie", Sitzungsberichte der Preussischen Akademie der Wissenschaften,
 > 18 November 1915. This is the analytic value a numerical integration must recover.
 */
public func perihelionAdvancePerOrbit(
    gm: Double, semiMajorAxisM a: Double, eccentricity e: Double
) -> Double {
    6 * Double.pi * gm / (c2 * a * (1 - e * e))
}

public func perihelionAdvanceArcsecPerCentury(
    gm: Double, semiMajorAxisM a: Double, eccentricity e: Double, orbitalPeriodDays period: Double
) -> Double {
    let perOrbit = perihelionAdvancePerOrbit(gm: gm, semiMajorAxisM: a, eccentricity: e)
    let orbitsPerCentury = Constants.daysPerJulianCentury / period
    return perOrbit * orbitsPerCentury * Constants.arcsecPerRadian
}

/// Mercury, as the demonstration uses it.
public enum Mercury {
    public static let semiMajorAxisM = 0.387_098_93 * Constants.auInMetres
    public static let eccentricity = 0.205_635_93
    public static let orbitalPeriodDays = 87.969_1
}

/// The residual general relativity accounts for, arcsec per century.
public let mercuryGrPrecessionArcsecPerCentury: Double = 42.98
