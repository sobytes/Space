import Foundation

/**
 What time it is at another world's Greenwich.

 Ported from `engine/src/solar-time.ts` and gated by the `solar-time` conformance domain.

 There are two questions inside "what time is it on Mars" and conflating them is how every
 confident wrong answer starts. Coordinate time is solved and already running: the IAU defines
 TDB, every JPL ephemeris is published in it, and this simulation's clock has been a TDB value
 since it was written. Civil time has no universal answer, because a civil clock exists to say
 where the Sun is and the Sun is somewhere different, moving at a different rate, at every body.

 What generalises is the construction rather than the clock. Greenwich is a chosen meridian and
 GMT was the Sun's hour angle from it, and the IAU already fixes a prime meridian for every body
 here through the W angle this engine draws with. Mars's is the crater Airy-0, chosen for the
 same reason Greenwich was. So the time at a body's own Greenwich is a real question for all 32,
 answered from geometry rather than a table of offsets, which could not exist: the offset drifts
 continuously because the days are different lengths.
 */

private let degrees = Double.pi / 180
private let obliquityRad = obliquityJ2000Deg * degrees

private func normalise(_ v: Vec3) -> Vec3 {
    let m = (v.x * v.x + v.y * v.y + v.z * v.z).squareRoot()
    return Vec3(v.x / m, v.y / m, v.z / m)
}

/// The inverse of `equatorialToEcliptic`: a rotation about the shared x axis by +obliquity.
private func eclipticToEquatorial(_ v: Vec3) -> Vec3 {
    let c = cos(obliquityRad)
    let s = sin(obliquityRad)
    return Vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c)
}

private func dot(_ a: Vec3, _ b: Vec3) -> Double { a.x * b.x + a.y * b.y + a.z * b.z }

private func crossProduct(_ a: Vec3, _ b: Vec3) -> Vec3 {
    Vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
}

/**
 The body's own axes at this epoch, in the J2000 equatorial frame.

 The standard IAU construction. The pole comes from the published right ascension and
 declination. The node, where the body's equator crosses the ICRF equator, is 90 degrees of
 right ascension ahead of the pole. The prime meridian is that node carried round the pole by W.
 */
private func bodyFrame(_ body: BodyId, _ epoch: JdTdb) -> (pole: Vec3, primeMeridian: Vec3, east: Vec3) {
    let rotation = bodyContracts[body]!.rotation
    let days = epoch.value - Epochs.j2000
    let centuries = days / Constants.daysPerJulianCentury

    let ra = (rotation.poleRaDeg + rotation.poleRaRateDegPerCentury * centuries) * degrees
    let dec = (rotation.poleDecDeg + rotation.poleDecRateDegPerCentury * centuries) * degrees
    let w = (rotation.primeMeridianDeg + rotation.rotationRateDegPerDay * days) * degrees

    let pole = Vec3(cos(dec) * cos(ra), cos(dec) * sin(ra), sin(dec))
    let node = Vec3(-sin(ra), cos(ra), 0)
    let nodeCrossPole = crossProduct(pole, node)

    let cw = cos(w)
    let sw = sin(w)
    let primeMeridian = Vec3(
        node.x * cw + nodeCrossPole.x * sw,
        node.y * cw + nodeCrossPole.y * sw,
        node.z * cw + nodeCrossPole.z * sw
    )
    return (pole, primeMeridian, crossProduct(pole, primeMeridian))
}

public struct SubSolarPoint: Sendable {
    /// Planetocentric east longitude of the point the Sun is overhead, degrees, -180 to 180.
    public let longitudeDeg: Double
    /// Planetocentric latitude of that point. The Sun's declination for this body.
    public let latitudeDeg: Double
}

/// Where on the body the Sun is directly overhead, right now.
public func subSolarPoint(_ body: BodyId, at epoch: JdTdb) -> SubSolarPoint {
    // The Sun sits at the heliocentric origin, so the direction to it is minus the body's own
    // position. Light time is ignored: it shifts the sub-solar longitude by under an arcsecond.
    let p = heliocentricPositionOf(body, at: epoch)
    let toSun = normalise(eclipticToEquatorial(Vec3(-p.x, -p.y, -p.z)))
    let frame = bodyFrame(body, epoch)

    return SubSolarPoint(
        longitudeDeg: atan2(dot(toSun, frame.east), dot(toSun, frame.primeMeridian)) / degrees,
        latitudeDeg: asin(max(-1, min(1, dot(toSun, frame.pole)))) / degrees
    )
}

public struct SolarClock: Sendable {
    public let body: BodyId
    /// Apparent solar time at the IAU prime meridian, in hours of this body's own day.
    public let hours: Double
    public let formatted: String
    public let subSolar: SubSolarPoint
    /// Sunrise to sunrise here, in Earth days.
    public let solLengthDays: Double
    /// One hour of this body's clock, in Earth seconds. Earth's is 3600 by construction.
    public let hourInEarthSeconds: Double
    /// Whole solar days elapsed at the prime meridian since J2000.
    public let dayNumber: Int
    public let sunRisesInTheWest: Bool
}

/**
 The time at this body's Greenwich.

 Apparent solar time: twelve hours plus the Sun's hour angle from the prime meridian, the same
 definition Greenwich Mean Time had before an atomic standard replaced it. At local apparent
 noon the Sun is over the prime meridian and the clock reads 12.

 The sign flips for a retrograde body, and that is not a tidy-up. On Venus the Sun rises in the
 west, so the sub-solar longitude moves the other way, and without the flip the clock would run
 backwards. A clock that counts down is not a clock.
 */
public func solarClock(_ body: BodyId, at epoch: JdTdb) -> SolarClock {
    let subSolar = subSolarPoint(body, at: epoch)
    let retrograde = bodyContracts[body]!.rotation.rotationRateDegPerDay < 0
    let sense: Double = retrograde ? -1 : 1

    let raw = 12 - (sense * subSolar.longitudeDeg * 24) / 360
    let hours = raw.truncatingRemainder(dividingBy: 24) < 0
        ? raw.truncatingRemainder(dividingBy: 24) + 24
        : raw.truncatingRemainder(dividingBy: 24)

    let solLengthDays = timeSense(body).dayInEarthDays

    // The day count takes its fraction from the clock itself rather than from dividing the
    // elapsed Earth days, which disagrees with the clock by a whole day whenever the two
    // fractional parts straddle midnight, which is exactly when someone would notice.
    let elapsedSols = (epoch.value - Epochs.j2000) / solLengthDays
    let dayNumber = Int((elapsedSols - hours / 24).rounded())

    let whole = Int(hours.rounded(.down))
    let minutes = Int(((hours - Double(whole)) * 60).rounded(.down))
    let seconds = Int((((hours - Double(whole)) * 60 - Double(minutes)) * 60).rounded(.down))

    return SolarClock(
        body: body,
        hours: hours,
        formatted: String(format: "%02d:%02d:%02d", whole, minutes, seconds),
        subSolar: subSolar,
        solLengthDays: solLengthDays,
        hourInEarthSeconds: solLengthDays * 86_400 / 24,
        dayNumber: dayNumber,
        sunRisesInTheWest: retrograde
    )
}
