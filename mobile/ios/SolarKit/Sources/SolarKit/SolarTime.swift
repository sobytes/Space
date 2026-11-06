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

/**
 Where on the body the Sun is directly overhead, right now, or nil if the question is empty.

 Nil for the Sun itself, and that is the honest answer rather than a guard clause. The Sun sits
 at the heliocentric origin, so the direction from it to itself is zero over zero: there is no
 sub-solar point on the Sun because there is no sunrise there to measure from.

 Returning NaN instead, which is what the arithmetic does unaided, crashed this app. Swift traps
 on converting a non-finite Double to Int, so the clock's `Int(hours)` killed it the moment
 anyone pressed Solar system. The website carried the same NaN to the screen and only printed
 nonsense, and the conformance missed it entirely because the generator skipped the Sun.
 */
public func subSolarPoint(_ body: BodyId, at epoch: JdTdb) -> SubSolarPoint? {
    let p = heliocentricPositionOf(body, at: epoch)
    guard (p.x * p.x + p.y * p.y + p.z * p.z).squareRoot() != 0 else { return nil }

    // Light time is ignored: it shifts the sub-solar longitude by under an arcsecond.
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
public func solarClock(_ body: BodyId, at epoch: JdTdb) -> SolarClock? {
    guard let subSolar = subSolarPoint(body, at: epoch) else { return nil }
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
    let sols = (elapsedSols - hours / 24).rounded()

    /**
     Checked before every conversion to Int, because in Swift that is a trap and not a value.

     This is the line that crashed the app. A NaN clock reached `Int(...)` and took the process
     down, which is a far worse failure than any wrong number could be, so nothing non-finite
     is converted here even though the guard above should already have made it impossible.
     `Int.max` is also checked: a date far enough out would overflow before it ever went NaN.
     */
    guard hours.isFinite, sols.isFinite, abs(sols) < 9e15 else { return nil }

    let dayNumber = Int(sols)
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

/**
 The date and time where that body is, now, as a label can carry it.

 Ported from `engine/src/solar-time.ts` and gated by the `solar-time` conformance domain.

 Earth gets the calendar, because Earth has one and nowhere else does. A date is a count of
 days into a year with names agreed by people who live there, and the only body with people on
 it has already agreed them; inventing Martian months would be making something up and printing
 it beside measured figures. What every body does have is a count of its own days and a time of
 day at its prime meridian, which is exactly what Mars missions run on: sols since a fixed
 epoch and the clock at Airy-0. That generalises honestly to all 32.

 Nil for the Sun, which has no sunrise to count from.
 */
public func localTimeLabel(
    _ body: BodyId,
    at epoch: JdTdb,
    zone: EarthZone = EarthZone(offsetMinutes: 0, label: "UTC")
) -> String? {
    guard let clock = solarClock(body, at: epoch) else { return nil }

    if body == .embary {
        /**
         Snapped to the second before truncating to the minute.

         The round trip through TDB is good to about four microseconds, and truncation turns
         four microseconds short of a minute into a whole minute lost: an exact 00:01:00 came
         back as 00:00:59.999996 and displayed as 00:00.
         */
        let ms = (unixMillisecondsFromJdUtc(utcFromTdb(epoch)) / 1000).rounded() * 1000
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.locale = Locale(identifier: "en_US_POSIX")
        // Shift the instant and read it back as UTC, which is how you format in another zone
        // without a timezone database: move the instant, not the formatter.
        let shifted = Date(timeIntervalSince1970: ms / 1_000 + zone.offsetMinutes * 60)
        return formatter.string(from: shifted) + " " + zone.label
    }

    let hhmm = String(clock.formatted.prefix(5))
    return "day \(clock.dayNumber.formatted()) · \(hhmm)"
}

/**
 The zone an Earth time is quoted in.

 A time with no zone on it is not a time, it is a number that looks like one. SolarKit cannot
 read the device clock and stay a pure function the conformance can gate, so the client passes
 the zone in and the arithmetic lives here. `offsetMinutes` is for the instant being shown and
 not for now, which is what makes a date in July come out right when it is read in January.
 */
public struct EarthZone: Sendable {
    public let offsetMinutes: Double
    /// As a person writes it: "UTC", "GMT", "EST", "+05:30".
    public let label: String

    public init(offsetMinutes: Double, label: String) {
        self.offsetMinutes = offsetMinutes
        self.label = label
    }
}

public let utcZone = EarthZone(offsetMinutes: 0, label: "UTC")

/// The device's own zone, for the instant being shown rather than for now, so a summer date
/// read in winter still carries the offset that was actually in force.
public func deviceZone(at epoch: JdTdb) -> EarthZone {
    let date = Date(timeIntervalSince1970: unixSecondsFromEpoch(epoch))
    let zone = TimeZone.current
    return EarthZone(
        offsetMinutes: Double(zone.secondsFromGMT(for: date)) / 60,
        label: zone.abbreviation(for: date) ?? "UTC"
    )
}
