import SwiftUI
import SolarKit

/**
 Every time zone on Earth, against what the Sun is actually doing there.

 Asked for as a learning tool: spin the Earth, see which countries are in night, then open this
 and check the zone against the country. So the two halves have to be side by side, and they
 come from different places on purpose.

 The clock is civil time, resolved by the platform's IANA database at the simulated instant,
 which is the only honest source for a rule that is political: summer time starts when a
 government says it does, and the table that records those decisions is updated by decree
 several times a year. The Sun is the engine's, from the sub-solar point.

 Putting them in one row is the lesson. Madrid and Warsaw keep the same clock and sit nineteen
 degrees apart, so Madrid's Sun runs well over an hour behind its own noon. Kathmandu is three
 quarters of an hour off every neighbour it has. A child who notices either of those has
 noticed that a time zone is a decision rather than a measurement.
 */
struct TimeZonesView: View {
    let clock: Clock

    @Environment(\.dismiss) private var dismiss

    /**
     One place, as the row needs it.

     Resolved per frame rather than stored, because every figure here moves with the clock and
     the clock is the point: scrubbing the date walks the terminator across the list.
     */
    private struct Reading: Identifiable {
        let place: EarthPlace
        let offsetSeconds: Int
        let civil: String
        let solarHours: Double?
        let altitudeDeg: Double?
        var id: String { place.id }
        var daylight: Bool { (altitudeDeg ?? -1) > 0 }
    }

    /// Built once per redraw, which is ten times a second at most. `displayEpoch`, not the
    /// live one: this is a list of clocks showing minutes.
    private var readings: [Reading] {
        let epoch = clock.displayEpoch
        let date = Date(
            timeIntervalSince1970: unixMillisecondsFromJdUtc(utcFromTdb(epoch)) / 1_000
        )
        return earthPlaces.map { place in
            let zone = TimeZone(identifier: place.zone)
            let offset = zone?.secondsFromGMT(for: date) ?? 0
            return Reading(
                place: place,
                offsetSeconds: offset,
                civil: Self.clockFace(date: date, zone: zone),
                solarHours: solarTimeHoursAt(.embary, at: epoch, longitudeDeg: place.longitudeDeg),
                altitudeDeg: solarAltitudeDeg(
                    .embary, at: epoch,
                    latitudeDeg: place.latitudeDeg, longitudeDeg: place.longitudeDeg
                )
            )
        }
        .sorted { ($0.offsetSeconds, $0.place.city) < ($1.offsetSeconds, $1.place.city) }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    // The map first, because it is the thing that makes the list mean
                    // something: every row below has a dot on it.
                    ZoneMap(epoch: clock.displayEpoch, places: earthPlaces)
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }

                Section {
                    Text("The clock in each place is set by its government. The Sun takes no "
                         + "notice. Where the two disagree is where a time zone shows itself "
                         + "to be a decision rather than a measurement.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    HStack {
                        Text("In daylight now")
                        Spacer()
                        // The identifier belongs on the text that carries the number, not on
                        // the row: on the row both of its labels inherit it and a query for
                        // one element finds two.
                        Text("\(readings.filter(\.daylight).count) of \(readings.count)")
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                            .accessibilityIdentifier("zones.daylightCount")
                    }
                    .font(.footnote)
                }

                ForEach(groups, id: \.offset) { group in
                    Section(offsetLabel(group.offset)) {
                        ForEach(group.readings) { reading in row(reading) }
                    }
                }
            }
            .navigationTitle("Time zones")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private var groups: [(offset: Int, readings: [Reading])] {
        var byOffset: [Int: [Reading]] = [:]
        for reading in readings { byOffset[reading.offsetSeconds, default: []].append(reading) }
        return byOffset.keys.sorted().map { ($0, byOffset[$0]!) }
    }

    private func row(_ reading: Reading) -> some View {
        HStack(spacing: 10) {
            /**
             Day or night, as a filled or empty circle rather than a word.

             Scannable down a column of fifty, which a word is not, and it is the thing being
             looked for: the child is matching this against the lit half of the planet behind.
             */
            Image(systemName: reading.daylight ? "sun.max.fill" : "moon.fill")
                .font(.system(size: 12))
                .foregroundStyle(reading.daylight ? .orange : .indigo)
                .frame(width: 18)

            VStack(alignment: .leading, spacing: 1) {
                Text(reading.place.city).font(.subheadline)
                Text(reading.place.country)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 6)
            VStack(alignment: .trailing, spacing: 1) {
                Text(reading.civil)
                    .font(.subheadline.monospacedDigit())
                // What the Sun says, next to what the clock says. The gap between them is the
                // whole reason this screen exists.
                if let solar = reading.solarHours {
                    Text("sun \(Self.hoursFace(solar))")
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    /**
     The offset as a heading, written the way a clock is read.

     Minutes included only where there are any, because "UTC+5:45" is the interesting row and
     "UTC+1:00" is noise.
     */
    private func offsetLabel(_ seconds: Int) -> String {
        let sign = seconds < 0 ? "-" : "+"
        let total = abs(seconds) / 60
        let minutes = total % 60
        let text = minutes == 0 ? "\(total / 60)" : String(format: "%d:%02d", total / 60, minutes)
        return "UTC\(sign)\(text)"
    }

    private static func hoursFace(_ hours: Double) -> String {
        let whole = Int(hours.rounded(.down))
        let minutes = Int(((hours - Double(whole)) * 60).rounded())
        // Rounding 59.6 minutes up has to carry into the hour, or the list shows 14:60.
        let carried = minutes == 60 ? (whole + 1, 0) : (whole, minutes)
        return String(format: "%02d:%02d", carried.0 % 24, carried.1)
    }

    /// One formatter, reconfigured per zone. Creating one per row of fifty, ten times a
    /// second, is the kind of cost that only shows up as the list stuttering under a finger.
    private static let face: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter
    }()

    private static func clockFace(date: Date, zone: TimeZone?) -> String {
        face.timeZone = zone ?? TimeZone(identifier: "UTC")
        return face.string(from: date)
    }
}
