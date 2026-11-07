import Foundation

/**
 How fast the clock may be told to run.

 Ported from `engine/src/rates.ts` and gated by the conformance suite, because the two clients
 had already drifted here: the website offered a century a second and this one stopped at ten
 years, so the same control on the same simulation had different ceilings and the rate that was
 asked for already existed on the other client.
 */
public struct ClockRate: Sendable, Identifiable {
    public let label: String
    /// Simulated seconds per real second.
    public let secondsPerSecond: Double
    public var id: String { label }

    public init(label: String, secondsPerSecond: Double) {
        self.label = label
        self.secondsPerSecond = secondsPerSecond
    }
}

/// A Julian year, 365.25 days, which is the unit the element tables are fitted in.
private let julianYearSeconds: Double = 31_557_600

public let ratePresets: [ClockRate] = [
    ClockRate(label: "real time", secondsPerSecond: 1),
    ClockRate(label: "1 min/s", secondsPerSecond: 60),
    ClockRate(label: "1 hour/s", secondsPerSecond: 3_600),
    ClockRate(label: "1 day/s", secondsPerSecond: 86_400),
    ClockRate(label: "1 week/s", secondsPerSecond: 604_800),
    /// One twelfth of a Julian year, 30.4375 days: the mean calendar month, not the synodic
    /// month of 29.53 days, which is the Moon's business rather than the calendar's.
    ClockRate(label: "1 month/s", secondsPerSecond: 2_629_800),
    ClockRate(label: "1 year/s", secondsPerSecond: julianYearSeconds),
    ClockRate(label: "10 years/s", secondsPerSecond: julianYearSeconds * 10),
    /**
     A hundred years a second, the fastest rate the ephemeris can honour for long.

     Named to continue the ladder rather than as "1 century/s", which is the same number and
     breaks a progression a reader is already following: one year, ten years, a hundred.

     The long-span tables are fitted for 3000 BC to 3000 AD. From now, holding this rate runs
     out of fitted table in about ten real seconds in either direction, and the clock stops at
     the edge rather than extrapolating a polynomial past its range.
     */
    ClockRate(label: "100 years/s", secondsPerSecond: julianYearSeconds * 100),
]
