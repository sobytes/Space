import Foundation

/**
 Units, constants and the boundary conversions.

 The rule from `contracts/units-and-frames`: SI inside, branded at the boundary, float64
 throughout. Swift has no branded primitives, so each unit is a `Double`-backed struct. That
 costs nothing at runtime and makes `toMetres(km(384_400))` the only way to get metres from a
 kilometre figure, rather than a bare multiply someone can forget.

 Every constant here is a definition or a current best estimate, quoted to full precision. A
 client that carries its own rounded copy drifts from the rest.
 */

public struct Kilometres: Sendable { public let value: Double; public init(_ v: Double) { value = v } }
public struct AstronomicalUnits: Sendable { public let value: Double; public init(_ v: Double) { value = v } }
public struct Degrees: Sendable { public let value: Double; public init(_ v: Double) { value = v } }
public struct Arcseconds: Sendable { public let value: Double; public init(_ v: Double) { value = v } }
public struct Days: Sendable { public let value: Double; public init(_ v: Double) { value = v } }

public func km(_ v: Double) -> Kilometres { Kilometres(v) }
public func au(_ v: Double) -> AstronomicalUnits { AstronomicalUnits(v) }
public func deg(_ v: Double) -> Degrees { Degrees(v) }
public func arcsec(_ v: Double) -> Arcseconds { Arcseconds(v) }
public func days(_ v: Double) -> Days { Days(v) }

public enum Constants {
    /// IAU 2012, exact by definition.
    public static let auInMetres: Double = 149_597_870_700
    public static let gmSun: Double = 1.327_124_400_41e20
    public static let secondsPerDay: Double = 86_400
    /// The Julian year, exactly. Not the tropical year of 365.2422 days.
    public static let daysPerJulianYear: Double = 365.25
    public static let daysPerJulianCentury: Double = 36_525
    public static let secondsPerJulianYear = daysPerJulianYear * secondsPerDay
    public static let secondsPerJulianCentury = daysPerJulianCentury * secondsPerDay
    /// Obliquity of the ecliptic at J2000, in arcseconds.
    public static let obliquityJ2000Arcsec: Double = 84_381.406
    public static let arcsecPerRadian: Double = 648_000 / Double.pi
    public static let solarRadiusM: Double = 6.957e8
}

public func toMetres(_ v: Kilometres) -> Double { v.value * 1_000 }
public func toMetres(_ v: AstronomicalUnits) -> Double { v.value * Constants.auInMetres }
public func toKilometres(_ metres: Double) -> Double { metres / 1_000 }
public func toRadians(_ v: Degrees) -> Double { v.value * Double.pi / 180 }
public func toRadians(_ v: Arcseconds) -> Double { v.value / Constants.arcsecPerRadian }
public func toSeconds(_ v: Days) -> Double { v.value * Constants.secondsPerDay }

/// Wraps to [0, 2pi).
public func normaliseAngle(_ radians: Double) -> Double {
    let wrapped = radians.truncatingRemainder(dividingBy: 2 * Double.pi)
    return wrapped < 0 ? wrapped + 2 * Double.pi : wrapped
}

/// Wraps to (-pi, pi]. Use this before differencing two angles.
public func normaliseAngleSigned(_ radians: Double) -> Double {
    var wrapped = normaliseAngle(radians)
    if wrapped > Double.pi { wrapped -= 2 * Double.pi }
    return wrapped
}
