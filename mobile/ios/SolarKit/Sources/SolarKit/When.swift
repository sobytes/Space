import Foundation

/**
 Going to a date, and saying how much to trust what you see when you get there.

 Ported from `engine/src/when.ts` and gated by the `when` conformance domain.

 The simulation is already a pure function of one epoch, so the arithmetic was never the hard
 part. What was missing was a way in, and the honesty that has to come with it: the element
 tables are fits over a stated window. The short-span table is fitted for 1800 to 2050 and the
 long-span one for 3000 BC to 3000 AD with far wider errors, and `modelForYear` already swaps
 between them. Step outside both and the positions are an extrapolation of a polynomial nobody
 fitted there. A simulator that silently draws the planets for the year 9000 is lying with a
 straight face, so this returns the standing of an epoch alongside it.
 */

/**
 Above this magnitude a bare number is read as milliseconds rather than seconds.

 1e11 seconds is the year 5138 and 1e11 milliseconds is 1973, so nothing anybody would type is
 ambiguous: a present-day timestamp is 1.7e9 in seconds or 1.7e12 in milliseconds, three orders
 of magnitude either side of the line. The resolved date is always shown back, so a wrong guess
 is visible rather than silent.
 */
public let millisecondThreshold: Double = 1e11

/// Seconds or milliseconds since 1970-01-01 UTC, to the epoch the simulation runs on.
public func epochFromUnixTimestamp(_ value: Double) -> JdTdb {
    let ms = abs(value) >= millisecondThreshold ? value : value * 1000
    return tdbFromUtc(jdUtcFromUnixMilliseconds(ms))
}

/// The same, backwards. Seconds, because that is what "a unix timestamp" means unqualified.
public func unixSecondsFromEpoch(_ epoch: JdTdb) -> Double {
    unixMillisecondsFromJdUtc(utcFromTdb(epoch)) / 1000
}

public struct EphemerisStanding: Sendable {
    /// Which fitted table answers for this epoch.
    public let model: String
    /// Whether that table's published validity window actually covers it.
    public let inside: Bool
    public let year: Int
    /// One line a client can print verbatim.
    public let note: String
}

/**
 Which table answers for this epoch, and whether it was fitted to.

 `modelForYear` picks the table; this says what that choice means. Inside the short span the
 quoted errors are the ones on the accuracy panel. Inside the long span they are wider, and the
 note says so rather than letting a figure keep an error bar it has not earned.
 */
public func ephemerisStandingAt(_ epoch: JdTdb) -> EphemerisStanding {
    let year = Int(julianYearForModelSelection(epoch).rounded(.down))
    let inShort = year >= shortSpan.validFromYear && year <= shortSpan.validToYear
    let inLong = year >= longSpan.validFromYear && year <= longSpan.validToYear

    if inShort {
        return EphemerisStanding(
            model: "short-span", inside: true, year: year,
            note: "Positions from the \(shortSpan.validFromYear) to \(shortSpan.validToYear) "
                + "element table, which is the one these accuracy figures were measured against."
        )
    }
    if inLong {
        return EphemerisStanding(
            model: "long-span", inside: true, year: year,
            note: "Outside 1800 to 2050, so positions come from the long-span table. It is fitted "
                + "for 3000 BC to 3000 AD and its quoted errors are far wider, by about an order of "
                + "magnitude for the outer planets."
        )
    }
    return EphemerisStanding(
        model: "long-span", inside: false, year: year,
        note: "Beyond 3000 BC to 3000 AD, which no table here was fitted for. The planets are "
            + "still drawn, by extrapolating a polynomial past its range, and where they are shown "
            + "is not where they were."
    )
}

/// The furthest out a date may be set while still being answered by a fitted table.
public let supportedYears = (from: longSpan.validFromYear, to: longSpan.validToYear)

/// Clamp into the fitted range, for a control that should not offer a meaningless answer.
public func clampToSupported(_ epoch: JdTdb) -> JdTdb {
    let year = julianYearForModelSelection(epoch)
    if year >= Double(supportedYears.from) && year <= Double(supportedYears.to) { return epoch }
    // One Julian year is 365.25 days and J2000 is at year 2000.0, which is all the inverse needs.
    let target = year < Double(supportedYears.from) ? supportedYears.from : supportedYears.to
    return JdTdb(2_451_545.0 + (Double(target) - 2_000) * 365.25)
}

/**
 Is the clock sitting on the edge of the fitted range, which is where it stops?

 Separate from `ephemerisStandingAt`, which reports the epoch as inside the long span here,
 because it is: the edge is the last instant any table was fitted for. What a viewer needs to
 know is different and more immediate, that the clock has stopped and why. Reported as "it
 stopped at the year 3000", which is a question about the app rather than about the tables, and
 the app was answering it only inside a panel that is the first thing anyone hides.

 A day of tolerance, so a date deliberately set to 2999 does not claim the clock has stopped.
 */
public func atSupportedEdge(_ epoch: JdTdb) -> Bool {
    let year = julianYearForModelSelection(epoch)
    let day = 1 / Constants.daysPerJulianYear
    return year <= Double(supportedYears.from) + day || year >= Double(supportedYears.to) - day
}
