import Foundation
import Observation
import SolarKit

/**
 The simulation clock.

 Mirrors the website's: it opens at real time, because opening at a day per second makes Earth
 spin once a real second and reads as a bug rather than as an 86,400x clock. Rate presets match
 the website's so the two clients describe the same thing the same way.
 */
@Observable
final class Clock {
    struct Rate: Identifiable, Sendable {
        let label: String
        let secondsPerSecond: Double
        var id: String { label }
    }

    static let presets: [Rate] = [
        Rate(label: "real time", secondsPerSecond: 1),
        Rate(label: "1 min/s", secondsPerSecond: 60),
        Rate(label: "1 hour/s", secondsPerSecond: 3_600),
        Rate(label: "1 day/s", secondsPerSecond: 86_400),
        Rate(label: "1 week/s", secondsPerSecond: 604_800),
        Rate(label: "1 month/s", secondsPerSecond: 2_629_800),
        Rate(label: "1 year/s", secondsPerSecond: 31_557_600),
        Rate(label: "10 years/s", secondsPerSecond: 315_576_000),
    ]

    private(set) var epoch: JdTdb
    var rateIndex: Int = 0
    var running: Bool = true

    var rate: Rate { Self.presets[rateIndex] }
    var secondsPerSecond: Double { running ? rate.secondsPerSecond * direction : 0 }
    var direction: Double = 1

    init() {
        epoch = tdbFromUtc(jdUtcFromUnixMilliseconds(Date().timeIntervalSince1970 * 1_000))
    }

    func advance(realSeconds: Double) {
        guard running else { return }
        let days = realSeconds * rate.secondsPerSecond * direction / Constants.secondsPerDay
        epoch = JdTdb(epoch.value + days)
    }

    func resetToNow() {
        epoch = tdbFromUtc(jdUtcFromUnixMilliseconds(Date().timeIntervalSince1970 * 1_000))
    }

    /// What one simulated duration takes in real seconds at the current rate, or nil if that is
    /// too fast to mean anything on a display. The website says the same thing for the same
    /// reason: "1 day/s" is accurate and tells a viewer nothing about what they will see.
    func onScreenSeconds(forSimulated seconds: Double) -> Double? {
        let rate = abs(self.rate.secondsPerSecond)
        guard rate > 0 else { return nil }
        let real = seconds / rate
        return real < 0.05 ? nil : real
    }

    var formattedEpoch: String {
        let ms = unixMillisecondsFromJdUtc(utcFromTt(JdTt(epoch.value)))
        let date = Date(timeIntervalSince1970: ms / 1_000)
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        formatter.timeZone = TimeZone(identifier: "UTC")
        return formatter.string(from: date) + " UTC"
    }
}
