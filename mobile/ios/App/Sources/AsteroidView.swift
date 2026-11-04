import SwiftUI
import SolarKit

/**
 Launch an asteroid and see where it ends up.

 Every planet and moon in the registry pulls the trajectory, so the answer is a propagation
 under real gravity rather than a drawn curve. The impact energy is gated against Chelyabinsk,
 Tunguska and Chicxulub, which span eight orders of magnitude.
 */
struct AsteroidView: View {
    @Environment(\.dismiss) private var dismiss
    let scene: SolarScene
    /**
     The clock itself, not the epoch it currently reads.

     Passing `clock.epoch` handed this sheet a value that changes sixty times a second, so
     SwiftUI rebuilt the whole form on every frame of the simulation. The form looked perfect
     and no control worked: an opened picker menu was redrawn between the touch landing and
     the menu resolving it, which XCUITest reports as a button that exists, has a frame, and
     is not hittable. Reported from the phone as "you cant click these".

     The reference is stable, so the sheet is rebuilt only when something in it actually
     changes. The epoch is read once, inside `launch()`, which is the only place it was ever
     needed and is outside the view body, so it creates no observation dependency either.
     */
    let clock: Clock

    @State private var origin: BodyId = .mars
    @State private var speed: Double = 6_000
    @State private var heading: Double = 180
    @State private var inclination: Double = 0
    @State private var diameter: Double = 300
    @State private var density: Double = 3_000
    @State private var years: Double = 50

    @State private var outcome: AsteroidOutcome?
    @State private var running = false

    private var launchBodies: [BodyId] {
        bodyIds.filter { bodyContracts[$0]!.kind != .star }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Release") {
                    Picker("From", selection: $origin) {
                        ForEach(launchBodies, id: \.self) { id in
                            Text(bodyContracts[id]!.displayName).tag(id)
                                .accessibilityIdentifier("origin.\(id.rawValue)")
                        }
                    }
                    .accessibilityIdentifier("asteroid.origin")
                    slider("Speed", $speed, 0 ... 30_000, 500, "%.0f m/s")
                    slider("Heading", $heading, 0 ... 360, 5, "%.0f\u{00b0}")
                    slider("Out of plane", $inclination, -90 ... 90, 5, "%.0f\u{00b0}")
                    Text("Heading is measured in the ecliptic plane, zero along the body's own "
                         + "orbital motion. The asteroid inherits that motion, so zero relative "
                         + "speed means it keeps pace rather than falling.")
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                }

                Section("The rock") {
                    slider("Diameter", $diameter, 10 ... 10_000, 10, "%.0f m")
                    slider("Density", $density, 1_000 ... 8_000, 100, "%.0f kg/m\u{00b3}")
                    Text("3,000 is typical for stone, 8,000 for iron.")
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                }

                Section("Integration") {
                    slider("Span", $years, 1 ... 200, 1, "%.0f years")
                }

                Section {
                    Button(running ? "Propagating\u{2026}" : "Launch") { launch() }
                        .disabled(running)
                    if outcome != nil {
                        Button("Clear trajectory", role: .destructive) {
                            scene.clearTrajectory()
                            outcome = nil
                        }
                    }
                }

                if let outcome {
                    Section("Outcome") {
                        Text(outcome.summary).font(.callout)

                        if let impact = outcome.impact {
                            LabeledContent("Mass") {
                                Text(String(format: "%.3g kg", impact.massKg))
                                    .font(.caption.monospacedDigit())
                            }
                            LabeledContent("Impact speed") {
                                Text(String(format: "%.1f km/s", impact.speedMS / 1_000))
                                    .font(.caption.monospacedDigit())
                            }
                            LabeledContent("Energy") {
                                Text(String(format: "%.3g Mt TNT", impact.energyMegatonsTnt))
                                    .font(.caption.monospacedDigit())
                            }
                            Text(impact.comparison)
                                .font(.caption)
                                .foregroundStyle(.orange)
                        }

                        LabeledContent("Integration steps") {
                            Text("\(outcome.result.steps) taken, "
                                 + "\(outcome.result.rejectedSteps) rejected")
                                .font(.caption.monospacedDigit())
                        }

                        ForEach(
                            outcome.result.closeApproaches.sorted { $0.distanceM < $1.distanceM }
                                .prefix(5),
                            id: \.body
                        ) { approach in
                            LabeledContent(
                                BodyId(rawValue: approach.body)
                                    .flatMap { bodyContracts[$0]?.displayName } ?? approach.body
                            ) {
                                Text(String(format: "%.3g km at %.1f yr",
                                            approach.distanceM / 1_000,
                                            approach.atSeconds / Constants.secondsPerJulianYear))
                                    .font(.caption.monospacedDigit())
                            }
                        }
                    }
                }
            }
            .navigationTitle("Launch an asteroid")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
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

    private func launch() {
        running = true
        let request = AsteroidLaunch(
            originBody: origin,
            altitudeM: bodyContracts[origin]!.equatorialRadiusM * 50,
            speedMS: speed,
            headingDeg: heading,
            inclinationDeg: inclination,
            startEpoch: clock.epoch,
            durationYears: years,
            diameterM: diameter,
            densityKgM3: density
        )
        let releaseEpoch = clock.epoch
        // Off the main thread: a 200-year propagation with 31 perturbers is not instant.
        Task.detached(priority: .userInitiated) {
            let result = runAsteroid(request)
            await MainActor.run {
                outcome = result
                scene.showTrajectory(result.result.samples, from: releaseEpoch)
                /**
                 Go to the body it left from, and ride it.

                 Launching used to leave the camera wherever it already was, so the most
                 interesting moment in the feature, the rock departing a planet you can see,
                 happened off screen unless you happened to be pointed at the right place.
                 Focus first, then ride, then dismiss, so the sheet comes away onto the
                 departure rather than onto whatever was behind it.
                 */
                scene.setFocus(request.originBody, at: releaseEpoch)
                scene.setRiding(true, at: releaseEpoch)
                running = false
                dismiss()
            }
        }
    }
}
