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

    /**
     The simulation instant, written sixty times a second and deliberately not observed.

     `@Observable` invalidates every view that reads a property when it changes, so an epoch
     read anywhere in a view body rebuilt the whole overlay at 60 Hz: the body picker's 32
     buttons, the panel, the view controls, the gravity bar and the time bar, every frame.
     Dragging the rate slider then competed with a view being recreated under the gesture, and
     one drag took two seconds to take effect. Reported as the app looking like it had crashed.

     The scene reads this from the tick closure, which observation does not track, so it still
     moves at 60 Hz. Anything on screen that displays the time reads `displayEpoch` instead.
     */
    @ObservationIgnored private(set) var epoch: JdTdb

    /**
     The same instant, republished at 10 Hz for the overlay.

     The website's viewport has published on this same throttle since it was written, for this
     same reason: a date label has no business forcing sixty renders a second. Ten is faster
     than anyone can read and slow enough that a gesture is never fighting a rebuild.
     */
    private(set) var displayEpoch: JdTdb

    /// Real seconds since the last publish. Not observed: it changes every tick.
    @ObservationIgnored private var sincePublish: Double = 0
    private static let publishInterval: Double = 0.1

    var rateIndex: Int = 0
    var running: Bool = true

    var rate: Rate { Self.presets[rateIndex] }
    var secondsPerSecond: Double { running ? rate.secondsPerSecond * direction : 0 }
    var direction: Double = 1

    init() {
        let now = tdbFromUtc(jdUtcFromUnixMilliseconds(Date().timeIntervalSince1970 * 1_000))
        epoch = now
        displayEpoch = now
    }

    func advance(realSeconds: Double) {
        guard running else { return }
        let days = realSeconds * rate.secondsPerSecond * direction / Constants.secondsPerDay
        epoch = JdTdb(epoch.value + days)

        sincePublish += realSeconds
        if sincePublish >= Self.publishInterval {
            sincePublish = 0
            displayEpoch = epoch
        }
    }

    func resetToNow() {
        epoch = tdbFromUtc(jdUtcFromUnixMilliseconds(Date().timeIntervalSince1970 * 1_000))
        // Published immediately rather than on the next throttle tick. "Now" is a direct
        // request to move the clock, and a tenth of a second of the old date reads as a
        // button that did nothing. The same applies while paused, where nothing else publishes.
        displayEpoch = epoch
        sincePublish = 0
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

    /// Built once. Creating a `DateFormatter` is expensive enough to matter when the thing
    /// being formatted is a clock, and this one was allocated on every read.
    private static let utcFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter
    }()

    /// Reads `displayEpoch`, not `epoch`, so showing the date costs ten renders a second.
    var formattedEpoch: String {
        let ms = unixMillisecondsFromJdUtc(utcFromTt(JdTt(displayEpoch.value)))
        let date = Date(timeIntervalSince1970: ms / 1_000)
        return Self.utcFormatter.string(from: date) + " UTC"
    }
}
