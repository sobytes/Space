import Foundation

/**
 How long a day, a month and a year are here, and how they compare to the ones you know.

 Ported from `engine/src/time-sense.ts` and gated by the `time-sense` conformance domain, down
 to the exact wording of the headline, because that sentence is the part a child actually reads
 and two clients telling them different things about the same planet is worse than either
 saying nothing.

 Everything is derived rather than listed. One formula does most of the work:

     1 / solar day = 1 / sidereal spin - 1 / orbit about the Sun

 A spin is measured against the stars and a day against the Sun, and they differ because the
 body also moves along its orbit while it turns. That is the whole of why Earth's day is 24
 hours and its spin 23h 56m, and the four minutes are not a rounding error: they add up to
 exactly one extra spin per year.
 */

/// The planet whose heliocentric orbit this body shares. A moon rides its planet's.
private func planetAncestor(_ id: BodyId) -> BodyId? {
    var current: BodyId? = id
    while let body = current {
        if case .standishElements = bodyContracts[body]!.ephemeris { return body }
        current = bodyContracts[body]!.parent
    }
    return nil
}

/**
 How long this body takes to go once round the Sun, in days.

 A moon returns its planet's, which is not a convenience: the Moon does orbit the Sun, once a
 year, on a path always concave towards it. Its monthly trip round Earth is a wobble on that.
 */
public func heliocentricPeriodDays(_ id: BodyId) -> Double {
    guard let planet = planetAncestor(id),
          case let .standishElements(name) = bodyContracts[planet]!.ephemeris,
          let elements = shortSpan.elements[name] else {
        return Constants.daysPerJulianYear
    }
    return 360 / elements.ratePerCentury.meanLongitudeDeg * Constants.daysPerJulianCentury
}

/**
 Sunrise to sunrise, from the spin against the stars and the trip around the Sun.

 Signed input, because a retrograde spin is a negative sidereal period and the subtraction
 handles it with no special case: Venus comes out at -116.75, whose magnitude is the right
 answer and whose sign says the Sun rises in the west.

 The singular case is real rather than defensive. A body whose spin equals its year never
 brings the Sun back overhead at all: one side faces it forever, and infinity is correct.
 */
public func solarDayDays(siderealDays: Double, heliocentricDays: Double) -> Double {
    let inverse = 1 / siderealDays - 1 / heliocentricDays
    return inverse == 0 ? .infinity : 1 / inverse
}

/// Full phase to full phase, longer than one trip round the planet because the planet has
/// carried the moon further round the Sun and it has to catch up.
private func synodicDays(orbitDays: Double, heliocentricDays: Double) -> Double {
    let inverse = 1 / orbitDays - 1 / heliocentricDays
    return inverse == 0 ? .infinity : 1 / inverse
}

public struct TimeSense: Sendable {
    public let id: BodyId
    /// One turn against the stars, days. Negative means it turns backwards.
    public let siderealSpinDays: Double
    /// Sunrise to sunrise, days. Negative means the Sun rises in the west.
    public let solarDayDays: Double
    /// Once round the Sun, days. A moon shares its planet's.
    public let yearDays: Double
    /// Its own days in its own year. Earth's 365.26 is this number, not a definition.
    public let solarDaysPerYear: Double
    /// Spins against the stars in one year. Always exactly one more than the days, prograde.
    public let spinsPerYear: Double
    public let spinsBackwards: Bool
    /// Spin and orbit equal, so one face is held towards whatever it orbits.
    public let tidallyLocked: Bool
    /// For a moon: once round its planet against the stars, days.
    public let monthDays: Double?
    /// For a moon: full phase to full phase as seen from its planet, days.
    public let synodicMonthDays: Double?
    /// Trips round its planet per Earth year. One more than the phase cycles, for the same
    /// reason a year holds one more spin than it holds days.
    public let orbitsPerEarthYear: Double?
    /// Full moon to full moon per Earth year. 12.37, which is the number people count.
    public let phaseCyclesPerEarthYear: Double?
    public let dayInEarthDays: Double
    public let yearInEarthYears: Double
}

/// Within this fraction, a spin and an orbit are called equal.
private let lockTolerance = 0.02

/**
 Earth's own orbital period, which is what "an Earth year" is compared against.

 Not the Julian year of 365.25 days: that is a unit defined for convenience and is 0.006 days
 short of Earth's actual trip, and mixing the two breaks the identity that orbits per year
 minus phase cycles per year is exactly one.
 */
private func earthYearDays() -> Double { heliocentricPeriodDays(.embary) }

public func timeSense(_ id: BodyId) -> TimeSense {
    let contract = bodyContracts[id]!
    let siderealSpinDays = contract.siderealRotationDays
    let yearDays = heliocentricPeriodDays(id)
    let solarDay = solarDayDays(siderealDays: siderealSpinDays, heliocentricDays: yearDays)

    var monthDays: Double?
    if case let .meanElementsAboutParent(source) = contract.ephemeris {
        monthDays = source.periodDays
    }

    // Locked to whatever it goes round: its planet for a moon, the Sun for a planet.
    let against = monthDays ?? yearDays
    let tidallyLocked = abs(abs(siderealSpinDays) - against) / against < lockTolerance

    let synodic = monthDays.map { synodicDays(orbitDays: $0, heliocentricDays: yearDays) }

    return TimeSense(
        id: id,
        siderealSpinDays: siderealSpinDays,
        solarDayDays: solarDay,
        yearDays: yearDays,
        solarDaysPerYear: solarDay.isFinite ? yearDays / abs(solarDay) : 0,
        spinsPerYear: yearDays / abs(siderealSpinDays),
        spinsBackwards: siderealSpinDays < 0,
        tidallyLocked: tidallyLocked,
        monthDays: monthDays,
        synodicMonthDays: synodic,
        orbitsPerEarthYear: monthDays.map { earthYearDays() / $0 },
        phaseCyclesPerEarthYear: synodic.map { earthYearDays() / $0 },
        dayInEarthDays: abs(solarDay),
        yearInEarthYears: yearDays / earthYearDays()
    )
}

/// Hours below two days, then days, then years. Whatever a person would actually say.
public func formatDuration(days: Double) -> String {
    let magnitude = abs(days)
    if magnitude < 2 {
        let hours = magnitude * 24
        let whole = Int(hours.rounded(.down))
        let minutes = Int(((hours - Double(whole)) * 60).rounded())
        // 23h 60m is not a thing anyone writes.
        if minutes == 60 { return "\(whole + 1)h 00m" }
        return "\(whole)h \(String(format: "%02d", minutes))m"
    }
    if magnitude < 700 { return String(format: "%.1f Earth days", magnitude) }
    return String(format: "%.1f Earth years", magnitude / heliocentricPeriodDays(.embary))
}

/// Thousands separators, matching JavaScript's `toLocaleString` for the en-US default the
/// conformance expectations were generated with.
private func grouped(_ value: Int) -> String {
    let formatter = NumberFormatter()
    formatter.numberStyle = .decimal
    formatter.locale = Locale(identifier: "en_US")
    formatter.groupingSeparator = ","
    formatter.groupingSize = 3
    // Explicit, because `en_US_POSIX` switches grouping off and the conformance caught this
    // as "10476" against the website's "10,476" on the first run.
    formatter.usesGroupingSeparator = true
    return formatter.string(from: NSNumber(value: value)) ?? String(value)
}

/**
 The single most surprising true thing about time on this body, in one paragraph.

 The branches are not stylistic. Each is a genuinely different relationship between spin and
 orbit, and picking the wrong sentence would state something false: a locked moon has no
 separate day and month to compare, a retrograde body's Sun rises in the west, and a body whose
 day exceeds its year has to be described the other way up.
 */
public func timeHeadline(_ id: BodyId) -> String {
    let t = timeSense(id)
    let day = formatDuration(days: t.dayInEarthDays)

    if t.id == .sun {
        return "The Sun turns once every \(formatDuration(days: abs(t.siderealSpinDays))), but not "
            + "as one piece: it is a ball of gas, so its equator laps its poles. Nothing here has a "
            + "day, because there is no sunrise to count from."
    }

    if t.tidallyLocked, t.monthDays != nil {
        let parent = bodyContracts[bodyContracts[t.id]!.parent ?? .embary]!.displayName
        return "Locked to \(parent): it turns exactly once each time it goes round, so the same "
            + "face is always pointed at \(parent) and the other side was never seen until a "
            + "spacecraft went to look. One day here lasts \(day), which is about half that in "
            + "sunlight and then the same again in darkness."
    }

    if t.solarDaysPerYear < 1 {
        return "A day here is longer than a year. One sunrise to the next takes \(day), while a "
            + "full trip round the Sun takes only \(formatDuration(days: t.yearDays)), so it goes round "
            + "the Sun \(String(format: "%.1f", 1 / t.solarDaysPerYear)) times between one sunrise and the next."
    }

    if t.spinsBackwards {
        return "It spins backwards, so the Sun rises in the west. A day here lasts \(day) and a "
            + "year \(formatDuration(days: t.yearDays)), which means the whole year is only "
            + "\(String(format: "%.1f", t.solarDaysPerYear)) of its own days long."
    }

    if t.solarDaysPerYear > 1000 {
        return "It turns in \(day), faster than any rocky planet, so even though a year here "
            + "lasts \(formatDuration(days: t.yearDays)) it holds about "
            + "\(grouped(Int(t.solarDaysPerYear.rounded()))) of its own days."
    }

    return "A day here is \(day), but one full spin takes "
        + "\(formatDuration(days: abs(t.siderealSpinDays))). The difference is that it also moves "
        + "along its orbit while it turns, so it has to turn a little further to bring the Sun "
        + "back round. Those slivers add up: a year holds \(String(format: "%.2f", t.solarDaysPerYear)) days "
        + "but \(String(format: "%.2f", t.spinsPerYear)) spins, exactly one more."
}

/// The shortest honest form: hours under two days, then days, then years.
public func shortDuration(days: Double) -> String {
    let magnitude = abs(days)
    if magnitude < 2 {
        let hours = magnitude * 24
        let whole = Int(hours.rounded(.down))
        let minutes = Int(((hours - Double(whole)) * 60).rounded())
        if minutes == 60 { return "\(whole + 1)h 00m" }
        return "\(whole)h \(String(format: "%02d", minutes))m"
    }
    if magnitude < 700 { return String(format: "%.1f d", magnitude) }
    return String(format: "%.1f y", magnitude / heliocentricPeriodDays(.embary))
}

/**
 A body's day and its orbit, short enough to sit under its name in the scene.

 This exists because the panel was the wrong place for it. All of the timing was put in the
 body panel, and the panel is the first thing anyone hides to actually look at the planets:
 reported twice, from a screenshot with the overlay hidden, as still not being able to see any
 times. A number only counts as visible where the person is looking.

 Under a label it also does what the panel could not. The panel describes one body, and the
 question was how the Moon's month compares to Earth's day and year. On screen the labels are
 side by side, so the comparison is there to be read rather than remembered.

 A moon is given its month rather than its year, because its year is its planet's and saying
 so under a moon's name invites exactly the wrong reading.
 */
public func timeBadge(_ id: BodyId) -> String {
    let t = timeSense(id)
    if id == .sun { return "turns every \(shortDuration(days: abs(t.siderealSpinDays)))" }
    let day = "day \(shortDuration(days: t.dayInEarthDays))"
    if let month = t.monthDays {
        return "\(day) · month \(shortDuration(days: month))"
    }
    return "\(day) · year \(shortDuration(days: t.yearDays))"
}

/**
 The same badge, cut to one figure, for a label pinned to the edge of the screen.

 The clamp keeps a label's anchor 44 points inside the viewport, and that was sized for a name.
 A label is centred on its anchor, so a second line wider than the name overhangs by half its
 own width and the full badge ran off the edge: "month 27.3" with the unit cut away, on the
 Moon, which is precisely the label most often clamped because it is framed just outside the
 view. One figure fits inside the existing inset, and an edge pointer is a summary anyway.
 */
public func timeBadgeShort(_ id: BodyId) -> String {
    let t = timeSense(id)
    if id == .sun { return "turns every \(shortDuration(days: abs(t.siderealSpinDays)))" }
    if let month = t.monthDays { return "month \(shortDuration(days: month))" }
    return "year \(shortDuration(days: t.yearDays))"
}
