import Foundation

/**
 Four time scales, kept apart by the type system.

 UTC is civil time and has leap seconds. TT is smooth and is what the IAU rotation elements are
 measured in. TDB adds periodic relativistic terms and is what the ephemerides and the
 integrator use. Mixing them is an error of tens of seconds, which moves Mercury about 2,000 km
 and moves nothing else enough to notice, so it hides. See `contracts/time-scales`.

 Separate structs rather than typealiases, so the compiler rejects the mix rather than
 accepting it silently.
 */

public struct JdUtc: Comparable, Sendable {
    public let value: Double
    public init(_ v: Double) { value = v }
    public static func < (a: JdUtc, b: JdUtc) -> Bool { a.value < b.value }
    public static func == (a: JdUtc, b: JdUtc) -> Bool { a.value == b.value }
}

public struct JdTt: Comparable, Sendable {
    public let value: Double
    public init(_ v: Double) { value = v }
    public static func < (a: JdTt, b: JdTt) -> Bool { a.value < b.value }
    public static func == (a: JdTt, b: JdTt) -> Bool { a.value == b.value }
}

public struct JdTdb: Comparable, Sendable {
    public let value: Double
    public init(_ v: Double) { value = v }
    public static func < (a: JdTdb, b: JdTdb) -> Bool { a.value < b.value }
    public static func == (a: JdTdb, b: JdTdb) -> Bool { a.value == b.value }
}

public enum Epochs {
    public static let j2000: Double = 2_451_545.0
    public static let unixEpochJd: Double = 2_440_587.5
    public static let ttMinusTaiSeconds: Double = 32.184
}

public func julianCenturiesSinceJ2000(_ jd: JdTdb) -> Double {
    (jd.value - Epochs.j2000) / Constants.daysPerJulianCentury
}

public func julianYearForModelSelection(_ jd: JdTdb) -> Double {
    2000 + (jd.value - Epochs.j2000) / Constants.daysPerJulianYear
}

public func jdUtcFromUnixMilliseconds(_ ms: Double) -> JdUtc {
    JdUtc(Epochs.unixEpochJd + ms / (Constants.secondsPerDay * 1_000))
}

public func unixMillisecondsFromJdUtc(_ jd: JdUtc) -> Double {
    (jd.value - Epochs.unixEpochJd) * Constants.secondsPerDay * 1_000
}

/**
 TAI minus UTC at an instant, in seconds.

 Before 1972 UTC had no integer offset at all: it ran on "rubber seconds", a set of per-interval
 rate and offset formulas, so no single number is right there. Earlier instants get the 1972
 value, and code needing a pre-1972 instant should carry TT or TDB directly.
 */
public func taiMinusUtcSeconds(_ jd: JdUtc) -> Double {
    var offset = leapSecondSteps[0].taiMinusUtcSeconds
    for step in leapSecondSteps {
        if jd.value < step.fromJdUtc { break }
        offset = step.taiMinusUtcSeconds
    }
    return offset
}

private func ttMinusUtcDays(_ taiMinusUtc: Double) -> Double {
    (taiMinusUtc + Epochs.ttMinusTaiSeconds) / Constants.secondsPerDay
}

public func ttFromUtc(_ jd: JdUtc) -> JdTt {
    JdTt(jd.value + ttMinusUtcDays(taiMinusUtcSeconds(jd)))
}

public func utcFromTt(_ jd: JdTt) -> JdUtc {
    for step in leapSecondSteps.reversed() {
        let candidate = JdUtc(jd.value - ttMinusUtcDays(step.taiMinusUtcSeconds))
        if candidate.value >= step.fromJdUtc { return candidate }
    }
    return JdUtc(jd.value - ttMinusUtcDays(leapSecondSteps[0].taiMinusUtcSeconds))
}

/**
 TDB minus TT in seconds: the annual term from Earth's eccentric orbit plus its first harmonic,
 the first-order form from the Astronomical Almanac. Its 1.66 ms peak is 50 m of Earth's orbital
 motion, well under anything this engine claims, but it is here so the conversion is real rather
 than an identity wearing a different type.
 */
public func tdbMinusTtSeconds(daysSinceJ2000: Double) -> Double {
    let anomaly = toRadians(deg(357.53 + 0.985_600_28 * daysSinceJ2000))
    return 0.001_658 * sin(anomaly) + 0.000_014 * sin(2 * anomaly)
}

public func tdbFromTt(_ jd: JdTt) -> JdTdb {
    let days = jd.value - Epochs.j2000
    return JdTdb(jd.value + tdbMinusTtSeconds(daysSinceJ2000: days) / Constants.secondsPerDay)
}

public func tdbFromUtc(_ jd: JdUtc) -> JdTdb { tdbFromTt(ttFromUtc(jd)) }
