import SwiftUI
import SceneKit
import SolarKit

/**
 The app shell: the scene, a body panel, and the time controls.

 Deliberately the same information architecture as the website, because the two are meant to
 be the same product. Every figure on screen comes from SolarKit, and the ones that depend on
 the clock say what they mean at the current rate, which is the lesson from someone reading
 Earth spinning once a second as a bug.
 */
struct ContentView: View {
    @State private var clock = Clock()
    @State private var scene = SolarScene()
    @State private var selected: Planet? = .embary
    @State private var lastTick = Date()

    private let tick = Timer.publish(every: 1.0 / 60.0, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack(alignment: .bottom) {
            SceneView(
                scene: scene.scene,
                pointOfView: scene.cameraNode,
                // No autoenablesDefaultLighting: it adds an omni light at the camera, which
                // lights the night side of every planet and destroys the terminator.
                options: [.allowsCameraControl]
            )
            .ignoresSafeArea()

            VStack(spacing: 10) {
                if let selected, let display = bodyDisplay[selected] {
                    BodyPanel(planet: selected, display: display, clock: clock)
                }
                TimeBar(clock: clock)
            }
            .padding(14)
        }
        .overlay(alignment: .top) { BodyPicker(selected: $selected).padding(.top, 8) }
        .onReceive(tick) { now in
            let delta = now.timeIntervalSince(lastTick)
            lastTick = now
            clock.advance(realSeconds: delta)
            scene.update(to: clock.epoch)
        }
    }
}

private struct BodyPicker: View {
    @Binding var selected: Planet?

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(Planet.allCases, id: \.self) { planet in
                    Button(bodyDisplay[planet]?.name ?? planet.rawValue) {
                        selected = planet
                    }
                    .font(.caption)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(selected == planet ? Color.orange.opacity(0.9) : Color.white.opacity(0.08))
                    .foregroundStyle(selected == planet ? Color.black : Color.white.opacity(0.85))
                    .clipShape(Capsule())
                }
            }
            .padding(.horizontal, 14)
        }
    }
}

private struct BodyPanel: View {
    let planet: Planet
    let display: BodyDisplay
    let clock: Clock

    /// Orbital period from the element table's mean-longitude rate, not a stored constant, so
    /// it cannot drift from the elements that position the planet.
    private var orbitDays: Double? {
        guard let elements = shortSpan.elements[planet] else { return nil }
        return 360 / elements.ratePerCentury.meanLongitudeDeg * Constants.daysPerJulianCentury
    }

    private var distanceFromSun: Double? {
        try? heliocentricPosition(planet, at: clock.epoch).length
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(display.name).font(.headline)
            Text(display.oneLine)
                .font(.caption)
                .foregroundStyle(.orange.opacity(0.9))

            Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 4) {
                if let distance = distanceFromSun {
                    row("From the Sun", String(format: "%.3f au", distance / Constants.auInMetres),
                        onScreen: orbitDays.map { $0 * Constants.secondsPerDay }, label: "one orbit")
                }
                row("Equatorial radius",
                    "\(Int(display.equatorialRadiusM / 1_000).formatted()) km")
                row("Rotation", rotationText,
                    onScreen: abs(display.siderealRotationDays) * Constants.secondsPerDay,
                    label: "one turn")
            }

            Text("Positions from the JPL Standish element tables; rotation from the IAU WGCCRE report.")
                .font(.system(size: 10))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(.black.opacity(0.65), in: RoundedRectangle(cornerRadius: 12))
    }

    private var rotationText: String {
        let hours = abs(display.siderealRotationDays) * 24
        let base = hours < 24
            ? String(format: "%.2f h", hours)
            : String(format: "%.4f d", abs(display.siderealRotationDays))
        return display.siderealRotationDays < 0 ? base + " retrograde" : base
    }

    @ViewBuilder
    private func row(
        _ name: String, _ value: String, onScreen simulatedSeconds: Double? = nil,
        label: String = ""
    ) -> some View {
        GridRow {
            Text(name).font(.caption).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 1) {
                Text(value).font(.caption.monospacedDigit())
                if let simulatedSeconds {
                    Text(onScreenText(simulatedSeconds, label))
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private func onScreenText(_ simulatedSeconds: Double, _ label: String) -> String {
        guard let real = clock.onScreenSeconds(forSimulated: simulatedSeconds) else {
            return "\(label) is too fast to see at this speed"
        }
        let formatted: String
        switch real {
        case ..<1: formatted = String(format: "%.2f s", real)
        case ..<90: formatted = String(format: "%.1f s", real)
        case ..<5_400: formatted = String(format: "%.1f min", real / 60)
        case ..<172_800: formatted = String(format: "%.1f h", real / 3_600)
        case ..<63_115_200: formatted = String(format: "%.1f days", real / 86_400)
        default: formatted = String(format: "%.1f years", real / 31_557_600)
        }
        return "\(label) every \(formatted) on screen at this speed"
    }
}

private struct TimeBar: View {
    @Bindable var clock: Clock

    var body: some View {
        VStack(spacing: 8) {
            Text(clock.formattedEpoch)
                .font(.system(.caption, design: .monospaced))

            HStack(spacing: 8) {
                Button(clock.running ? "Pause" : "Play") { clock.running.toggle() }
                Button("Reverse") { clock.direction *= -1 }
                Button("Now") { clock.resetToNow() }
            }
            .buttonStyle(.bordered)
            .controlSize(.small)

            HStack {
                Slider(
                    value: Binding(
                        get: { Double(clock.rateIndex) },
                        set: { clock.rateIndex = Int($0.rounded()) }
                    ),
                    in: 0 ... Double(Clock.presets.count - 1),
                    step: 1
                )
                Text(clock.direction < 0 ? "\(clock.rate.label), reversed" : clock.rate.label)
                    .font(.caption2.monospacedDigit())
                    .frame(width: 110, alignment: .trailing)
            }
        }
        .padding(12)
        .background(.black.opacity(0.65), in: RoundedRectangle(cornerRadius: 12))
    }
}
