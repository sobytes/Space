import Foundation

/**
 The shapes the generated Standish tables are expressed in.

 `embary` is the Earth-Moon barycentre, which is what the table actually models, and its mass
 parameter is Earth plus Moon. The two differ by about 4,670 km, inside the Earth, which
 matters for an eclipse and not for a wide shot. See `contracts/units-and-frames`.
 */
public enum Planet: String, CaseIterable, Sendable {
    case mercury, venus, embary, mars, jupiter, saturn, uranus, neptune
}

public struct ElementSet: Sendable {
    public let semiMajorAxisAu: Double
    public let eccentricity: Double
    public let inclinationDeg: Double
    public let meanLongitudeDeg: Double
    public let longitudeOfPerihelionDeg: Double
    public let longitudeOfAscendingNodeDeg: Double
}

/// Jupiter through Neptune carry extra terms in the long-span table.
public struct LongPeriodTerms: Sendable {
    public let b: Double
    public let c: Double
    public let s: Double
    public let f: Double
}

public struct PlanetElements: Sendable {
    public let atJ2000: ElementSet
    public let ratePerCentury: ElementSet
    public let longPeriodTerms: LongPeriodTerms?
}

/// JPL's own published nominal error. The gate's tolerance comes from here, not from a figure
/// chosen to make a test pass. These are nominal, not bounds; see `contracts/ephemeris-accuracy`.
public struct QuotedError: Sendable {
    public let longitudeArcsec: Double
    public let latitudeArcsec: Double
    public let distanceKm: Double
}

public struct EphemerisModel: Sendable {
    public let id: String
    public let validFromYear: Int
    public let validToYear: Int
    public let elements: [Planet: PlanetElements]
    public let quotedError: [Planet: QuotedError]
}

/// The two tables disagree at the seam, so a span crossing 1800 or 2050 must pass one model
/// explicitly rather than letting the year choose per sample.
public func modelForYear(_ year: Double) -> EphemerisModel {
    year >= Double(shortSpan.validFromYear) && year <= Double(shortSpan.validToYear)
        ? shortSpan
        : longSpan
}
