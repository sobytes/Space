import SwiftUI
import SolarKit

/**
 What it costs to reach an orbit, and what a real vehicle can lift there.

 The delta-v budget is a Hohmann transfer from the surface plus the published loss terms,
 minus whatever Earth's rotation is worth on the chosen azimuth. The payload comes from
 bisecting the rocket equation over the vehicle's published masses.

 The caveat at the bottom is not boilerplate. This model is gated in the inverse direction,
 because predicting payload directly needs the loss budget to about 310 m/s and the published
 loss terms disagree by over a kilometre per second.
 */
struct LaunchView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var vehicleId = vehicles.first?.id ?? ""
    @State private var siteId = "ksc-lc39a"
    @State private var altitude: Double = 200
    @State private var inclination: Double = 28.5

    private var chosenVehicle: Vehicle? { vehicle(id: vehicleId) }
    private var chosenSite: LaunchSite? { launchSite(id: siteId) }

    private var result: Result<AscentResult, Error>? {
        guard let chosenVehicle, let chosenSite else { return nil }
        let target = AscentTarget(
            altitudeKm: altitude, inclinationDeg: inclination, site: chosenSite
        )
        return Result { try maximumPayload(chosenVehicle, target: target) }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Vehicle and pad") {
                    Picker("Vehicle", selection: $vehicleId) {
                        ForEach(vehicles, id: \.id) { Text($0.name).tag($0.id) }
                    }
                    Picker("Site", selection: $siteId) {
                        ForEach(launchSites, id: \.id) {
                            Text("\($0.name)  \(String(format: "%.1f\u{00b0}", $0.latitudeDeg))")
                                .tag($0.id)
                        }
                    }
                }

                Section("Target orbit") {
                    slider("Altitude", $altitude, 150 ... 2_000, 10, "%.0f km")
                    slider("Inclination", $inclination, 0 ... 145, 0.5, "%.1f\u{00b0}")
                    if let site = chosenSite {
                        Text(String(
                            format: "Azimuth %.1f\u{00b0} from north. Inclinations below the "
                                + "site's own latitude of %.1f\u{00b0} are not reachable directly.",
                            azimuthFor(site: site, inclinationDeg: inclination),
                            site.latitudeDeg
                        ))
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                    }
                }

                switch result {
                case let .success(ascent):
                    Section("Delta-v budget") {
                        row("Circular speed", ascent.budget.circularSpeedMS)
                        row("Climb and circularise", ascent.budget.potentialMS)
                        row("Gravity loss", ascent.budget.gravityLossMS)
                        row("Drag loss", ascent.budget.dragLossMS)
                        row("Earth's rotation", -ascent.budget.earthRotationMS)
                        Divider()
                        row("Required", ascent.budget.requiredMS, bold: true)
                    }

                    Section("What \(ascent.vehicle) delivers") {
                        ForEach(ascent.perStage, id: \.name) { stage in
                            row(stage.name, stage.deltaVMS)
                        }
                        Divider()
                        row("Delivered", ascent.deliveredMS, bold: true)
                        LabeledContent("Payload to this orbit") {
                            Text("\(Int(ascent.payloadKg).formatted()) kg")
                                .font(.callout.monospacedDigit().bold())
                                .foregroundStyle(.orange)
                        }
                        LabeledContent("Liftoff thrust to weight") {
                            Text(String(format: "%.2f", ascent.launchTWR))
                                .font(.caption.monospacedDigit())
                        }
                    }

                    Section {
                        Text("""
                            This model is gated in the inverse direction. Predicting payload \
                            directly needs the loss budget to about 310 m/s, and the published \
                            loss terms disagree by over a kilometre per second, so such a gate \
                            would fail on the literature rather than on the model. Fed ULA's \
                            masses and ULA's published payload, the implied losses come out at \
                            2,654 and 2,772 m/s, both inside the 2 to 3 km/s band real vehicles \
                            need. Payload predicted from the published losses runs 14 to 19% \
                            high, which is reported rather than gated.
                            """)
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                    }

                case let .failure(error):
                    Section {
                        Text(String(describing: error))
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }

                case nil:
                    EmptyView()
                }
            }
            .navigationTitle("Launch a rocket")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }

    @ViewBuilder
    private func row(_ name: String, _ value: Double, bold: Bool = false) -> some View {
        LabeledContent(name) {
            Text(String(format: "%.0f m/s", value))
                .font(bold ? .caption.monospacedDigit().bold() : .caption.monospacedDigit())
        }
    }

    @ViewBuilder
    private func slider(
        _ name: String, _ value: Binding<Double>,
        _ range: ClosedRange<Double>, _ step: Double, _ format: String
    ) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(name).font(.caption)
                Spacer()
                Text(String(format: format, value.wrappedValue))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            Slider(value: value, in: range, step: step)
        }
    }
}
