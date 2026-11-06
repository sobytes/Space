import Foundation

/**
 How long it takes to get anywhere on a drawn orbit.

 Ported from `engine/src/orbit-time.ts` and gated by the `orbit-time` conformance domain, so a
 mark means the same number of days on a phone as it does in a browser.

 An orbit line says where a body goes and says nothing at all about when, which is half the
 point of watching one. Marks placed at equal intervals of time, counted from the current
 epoch, make three things readable at once: where the body is now, where it will be in a stated
 number of days, and how much faster it moves near periapsis, because marks equally spaced in
 time are unequally spaced along the path. That last one is Kepler's second law measured rather
 than illustrated.

 Only the shared decision lives here, which is the interval and what to call it. Each client
 samples its own ephemeris at the epochs this returns, so the marks sit on the path that client
 actually drew.
 */

private let hour: Double = 3_600
private let day = Constants.secondsPerDay
private let year = Constants.daysPerJulianYear * Constants.secondsPerDay

public struct MarkIntervalOption: Sendable {
    public let seconds: Double
    public let label: String
}

/**
 The intervals a mark is allowed to represent, shortest first.

 Round numbers of familiar units, not a computed subdivision of the period. "One mark every
 2.276 days" is technically derived from the orbit and useless to read; "every 2 days" is
 countable. The cost is that marks do not divide the orbit a whole number of times, which is
 correct anyway: the Moon's month is 27.32 days and not 28, and this does not hide that.
 */
public let markIntervals: [MarkIntervalOption] = [
    MarkIntervalOption(seconds: hour, label: "1 hour"),
    MarkIntervalOption(seconds: 3 * hour, label: "3 hours"),
    MarkIntervalOption(seconds: 6 * hour, label: "6 hours"),
    MarkIntervalOption(seconds: 12 * hour, label: "12 hours"),
    MarkIntervalOption(seconds: day, label: "1 day"),
    MarkIntervalOption(seconds: 2 * day, label: "2 days"),
    MarkIntervalOption(seconds: 5 * day, label: "5 days"),
    MarkIntervalOption(seconds: 10 * day, label: "10 days"),
    MarkIntervalOption(seconds: 15 * day, label: "15 days"),
    MarkIntervalOption(seconds: 30 * day, label: "30 days"),
    MarkIntervalOption(seconds: 90 * day, label: "90 days"),
    MarkIntervalOption(seconds: 180 * day, label: "180 days"),
    MarkIntervalOption(seconds: year, label: "1 year"),
    MarkIntervalOption(seconds: 2 * year, label: "2 years"),
    MarkIntervalOption(seconds: 5 * year, label: "5 years"),
    MarkIntervalOption(seconds: 10 * year, label: "10 years"),
    MarkIntervalOption(seconds: 25 * year, label: "25 years"),
    MarkIntervalOption(seconds: 50 * year, label: "50 years"),
    MarkIntervalOption(seconds: 100 * year, label: "100 years"),
]

/**
 The most marks an orbit may carry.

 Above roughly this many they stop being countable and become a dotted line, which conveys
 less than the plain line did. Phobos at 7.65 hours gets eight and Neptune at 165 years gets
 seventeen, so one rule covers five orders of magnitude of period.
 */
public let maxOrbitMarks = 24

public struct MarkInterval: Sendable {
    public let seconds: Double
    /// For a legend: "one mark every 2 days". Never a derived fraction of the period.
    public let label: String
    /// How many marks fit in one orbit. Fractional, because periods are not whole units.
    public let marksPerOrbit: Double
}

/**
 The finest round interval that does not exceed `maxOrbitMarks` marks in one orbit.

 Finest rather than nearest to a target, so the answer only ever moves one rung as a period
 changes and two bodies with similar periods cannot land on wildly different spacings.
 */
public func markIntervalFor(periodDays: Double) -> MarkInterval {
    let periodSeconds = abs(periodDays) * Constants.secondsPerDay
    let chosen = markIntervals.first { periodSeconds / $0.seconds <= Double(maxOrbitMarks) }
        // A period longer than a century of marks still has to render something, and the
        // coarsest interval with too many marks beats no marks at all.
        ?? markIntervals[markIntervals.count - 1]

    return MarkInterval(
        seconds: chosen.seconds,
        label: chosen.label,
        marksPerOrbit: periodSeconds / chosen.seconds
    )
}

public struct OrbitTimeMark: Sendable {
    /// The epoch to sample the body at.
    public let epoch: JdTdb
    /// Whole intervals ahead of now. 0 is the body's current position.
    public let index: Int
    public let secondsFromNow: Double
}

public struct OrbitTimeMarks: Sendable {
    public let interval: MarkInterval
    public let marks: [OrbitTimeMark]
}

/**
 The epochs to put marks at, starting from now and going one full orbit forward.

 Anchored to the current epoch rather than to a fixed reference, so mark zero is always the
 body itself and every other mark answers "and where will it be in n of these". The set slides
 along the path as the clock runs, which is what makes it a clock rather than a ruler.

 Forward only. A mark behind the body is where it has already been, and drawing the past and
 the future identically makes the direction of travel unreadable.
 */
public func orbitTimeMarks(periodDays: Double, now: JdTdb) -> OrbitTimeMarks {
    let interval = markIntervalFor(periodDays: periodDays)
    let periodSeconds = abs(periodDays) * Constants.secondsPerDay
    let count = min(
        maxOrbitMarks,
        max(1, Int((periodSeconds / interval.seconds).rounded(.up)))
    )

    var marks: [OrbitTimeMark] = []
    for index in 0 ..< count {
        let secondsFromNow = Double(index) * interval.seconds
        // Strictly inside one period: a mark at exactly one period sits on top of mark zero.
        if index > 0 && secondsFromNow >= periodSeconds { break }
        marks.append(OrbitTimeMark(
            epoch: JdTdb(now.value + secondsFromNow / Constants.secondsPerDay),
            index: index,
            secondsFromNow: secondsFromNow
        ))
    }
    return OrbitTimeMarks(interval: interval, marks: marks)
}
