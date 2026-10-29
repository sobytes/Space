import SwiftUI
import SceneKit
import SolarKit

/**
 The app shell: the scene, the body panel, the view controls and the clock.

 Deliberately the same information architecture as the website, because the two are meant to
 be the same product and `contracts/feature-parity` says a feature on one platform is tracked
 on all of them. Every figure comes from SolarKit, and the ones that depend on the clock say
 what they mean at the current rate.
 */
struct ContentView: View {
    @State private var clock = Clock()
    @State private var scene = SolarScene()
    @State private var gravity = Gravity()
    @State private var focus: BodyId = .embary
    @State private var lastTick = Date()
    @State private var showingDemonstrations = false
    @State private var showingAsk = false
    @State private var showingAsteroid = false
    @State private var showingLaunch = false
    /**
     Hides every panel so the scene is unobstructed.

     The panels are the point right up until you want to look at the planet, at which moment
     they are covering it. One small control stays visible, because an overlay with no way
     back is a trap rather than a decluttered view.
     */
    @State private var overlayHidden = CommandLine.arguments.contains("-startHidden")

    private let tick = Timer.publish(every: 1.0 / 60.0, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack(alignment: .bottom) {
            SceneView(
                scene: scene.scene,
                pointOfView: scene.cameraNode,
                // No autoenablesDefaultLighting: it puts an omni light at the camera, which
                // lights the night side of every body and destroys the terminator.
                options: [.allowsCameraControl]
            )
            .ignoresSafeArea()

            if !overlayHidden {
                VStack(spacing: 10) {
                    BodyPanel(id: focus, clock: clock)
                    ViewControls(focus: focus, scene: scene, clock: clock)
                    GravityBar(gravity: gravity, clock: clock)
                    TimeBar(clock: clock)
                }
                .padding(14)
                .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
        }
        .overlay(alignment: .top) {
            if !overlayHidden {
                BodyPicker(focus: $focus)
                    .padding(.top, 6)
                    .transition(.opacity)
            }
        }
        .overlay(alignment: .topTrailing) {
            /**
             The tool rail sits above the body panel in z-order and the panel used to grow up
             underneath it, so an expanded panel's own control ended up behind the launch
             button. The panel is height-capped now and the rail keeps its own row, so neither
             can reach the other.
             */
            VStack(spacing: 6) {
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) { overlayHidden.toggle() }
                } label: {
                    Image(systemName: overlayHidden ? "eye" : "eye.slash")
                }
                .tint(overlayHidden ? .orange : .gray)

                if !overlayHidden {
                    Button { showingDemonstrations = true } label: {
                        Image(systemName: "function")
                    }
                    Button { showingAsk = true } label: {
                        Image(systemName: "sparkles")
                    }
                    Button { showingAsteroid = true } label: {
                        Image(systemName: "circle.dotted.and.circle")
                    }
                    Button { showingLaunch = true } label: {
                        Image(systemName: "paperplane")
                    }
                }
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .padding(.trailing, 10)
            .padding(.top, overlayHidden ? 8 : 54)
        }
        .sheet(isPresented: $showingDemonstrations) { DemonstrationsView() }
        .sheet(isPresented: $showingAsk) { AskView() }
        .sheet(isPresented: $showingAsteroid) {
            AsteroidView(scene: scene, epoch: clock.epoch)
        }
        .sheet(isPresented: $showingLaunch) { LaunchView() }
        .onChange(of: focus) { _, body in
            scene.setFocus(body, at: clock.epoch)
            scene.update(to: clock.epoch, gravity: gravity)
        }
        .onReceive(tick) { now in
            let delta = now.timeIntervalSince(lastTick)
            lastTick = now
            clock.advance(realSeconds: delta)
            gravity.seek(to: clock.epoch)
            scene.update(to: clock.epoch, gravity: gravity)
        }
    }
}

/// Every body, with moons indented under their planet so 32 entries read as a system.
private struct BodyPicker: View {
    @Binding var focus: BodyId

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 5) {
                ForEach(bodyIds, id: \.self) { id in
                    let contract = bodyContracts[id]!
                    Button {
                        focus = id
                    } label: {
                        Text((contract.kind == .moon ? "\u{21b3} " : "") + contract.displayName)
                            .font(contract.kind == .moon ? .caption2 : .caption)
                    }
                    .padding(.horizontal, 9)
                    .padding(.vertical, 5)
                    .background(focus == id ? Color.orange.opacity(0.9) : Color.white.opacity(0.08))
                    .foregroundStyle(focus == id ? Color.black : Color.white.opacity(0.85))
                    .clipShape(Capsule())
                }
            }
            .padding(.horizontal, 14)
        }
    }
}

/**
 Everything the contract is willing to assert about a body, with its provenance.

 The same fields as the website's panel, including the declared discrepancies, because a
 conflict between sources is documentation rather than something to hide.
 */
private struct BodyPanel: View {
    /// Named `id`, not `body`: SwiftUI's View protocol already owns `body`.
    let id: BodyId
    let clock: Clock
    @State private var expanded = false

    private var contract: BodyContract { bodyContracts[id]! }

    private var orbitDays: Double? {
        switch contract.ephemeris {
        case .fixedAtBarycentre: return nil
        case let .standishElements(planet):
            guard let e = shortSpan.elements[planet] else { return nil }
            return 360 / e.ratePerCentury.meanLongitudeDeg * Constants.daysPerJulianCentury
        case let .meanElementsAboutParent(source): return source.periodDays
        }
    }

    private var fromSun: Double { heliocentricPositionOf(id, at: clock.epoch).length }

    private var fromEarth: Double {
        (heliocentricPositionOf(id, at: clock.epoch)
            - heliocentricPositionOf(.embary, at: clock.epoch)).length
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(contract.displayName).font(.headline)
                Spacer()
                Button(expanded ? "Less" : "More") { expanded.toggle() }
                    .font(.caption2)
            }
            Text(contract.education.oneLine)
                .font(.caption)
                .foregroundStyle(.orange.opacity(0.9))

            /**
             Three rows collapsed. The panel used to show everything always and covered most
             of the planet, which is a poor trade in an app whose whole point is looking at
             the planet. The rest is one tap away and scrolls, so it can never grow past half
             the screen however much a contract has to say.
             */
            Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 4) {
                row("From the Sun", distance(fromSun),
                    simulated: orbitDays.map { $0 * Constants.secondsPerDay }, label: "one orbit")
                row("Equatorial radius", "\(Int(contract.equatorialRadiusM / 1_000).formatted()) km")
                row("Rotation", rotationText,
                    simulated: abs(contract.siderealRotationDays) * Constants.secondsPerDay,
                    label: "one turn")
            }

            if expanded {
                ScrollView {
                    VStack(alignment: .leading, spacing: 6) {
                        Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 4) {
                            if id != .embary {
                                row("From Earth",
                                    "\(distance(fromEarth))  (\(lightTime(fromEarth)) of light)")
                            }
                            row("Axial tilt", String(
                                format: "%.2f\u{00b0}", obliquityToOrbitDeg(id, at: clock.epoch)
                            ))
                            row("Mean temperature",
                                "\(Int(contract.meanTemperatureK)) K  "
                                    + "(\(Int(contract.meanTemperatureK - 273.15)) \u{00b0}C)")
                            if contract.confirmedMoons > 0 {
                                row("Confirmed moons", "\(contract.confirmedMoons)")
                            }
                            if let atmosphere = contract.atmosphere {
                                row("Atmosphere", atmosphere.composition
                                    .map { "\($0.0) \(String(format: "%.1f", $0.1 * 100))%" }
                                    .joined(separator: ", "))
                            }
                        }

                        Text(contract.education.whyItMatters).font(.caption).padding(.top, 2)

                        ForEach(contract.education.facts, id: \.self) { fact in
                            Text("\u{2014}  " + fact)
                                .font(.system(size: 11))
                                .foregroundStyle(.secondary)
                        }

                        if !contract.knownDiscrepancies.isEmpty {
                            VStack(alignment: .leading, spacing: 3) {
                                Text("SOURCES DISAGREE")
                                    .font(.system(size: 10, weight: .medium))
                                    .foregroundStyle(.orange.opacity(0.8))
                                ForEach(contract.knownDiscrepancies, id: \.field) { d in
                                    Text(d.summary).font(.system(size: 11))
                                    Text("Using: " + d.preferred)
                                        .font(.system(size: 10))
                                        .foregroundStyle(.orange.opacity(0.7))
                                }
                            }
                            .padding(8)
                            .background(.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                        }

                        Text(provenance)
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                    }
                }
                // Capped so a body with a lot to say cannot push the panel up into the tool
                // rail. Jupiter's contract alone runs past the top of the screen uncapped.
                .frame(maxHeight: 240)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(.black.opacity(0.68), in: RoundedRectangle(cornerRadius: 12))
    }

    private var provenance: String {
        switch contract.ephemeris {
        case .fixedAtBarycentre:
            return "Rotation from the IAU WGCCRE report."
        case .standishElements:
            return "Position from the JPL Standish element tables, rotation from the IAU WGCCRE report."
        case .meanElementsAboutParent:
            return "Position from JPL mean elements, good to roughly a degree, not an "
                + "eclipse-grade theory. Rotation from the IAU WGCCRE report."
        }
    }

    private var rotationText: String {
        let hours = abs(contract.siderealRotationDays) * 24
        let base = hours < 48
            ? String(format: "%.2f h", hours)
            : String(format: "%.4f d", abs(contract.siderealRotationDays))
        return contract.siderealRotationDays < 0 ? base + " retrograde" : base
    }

    private func distance(_ metres: Double) -> String {
        if metres < 1_000 { return String(format: "%.0f m", metres) }
        if metres < 1e9 { return "\(Int(metres / 1_000).formatted()) km" }
        return String(format: "%.3f au", metres / Constants.auInMetres)
    }

    private func lightTime(_ metres: Double) -> String {
        let seconds = metres / 299_792_458
        if seconds < 60 { return String(format: "%.1f s", seconds) }
        if seconds < 3_600 { return "\(Int(seconds / 60)) m \(Int(seconds.truncatingRemainder(dividingBy: 60))) s" }
        return "\(Int(seconds / 3_600)) h \(Int(seconds.truncatingRemainder(dividingBy: 3_600) / 60)) m"
    }

    @ViewBuilder
    private func row(
        _ name: String, _ value: String, simulated: Double? = nil, label: String = ""
    ) -> some View {
        GridRow {
            Text(name).font(.caption).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 1) {
                Text(value).font(.caption.monospacedDigit())
                if let simulated {
                    Text(onScreen(simulated, label))
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private func onScreen(_ simulatedSeconds: Double, _ label: String) -> String {
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

/**
 Where to stand relative to the Sun, and how far back.

 The lighting angles exist because the thing worth seeing on a body is usually the line
 between its day and its night, and arriving over the lit face hides it. "Fit moons" exists
 because framing a planet against its own radius crops its moons out entirely: Earth's Moon
 sits 60 Earth radii away, which is why the planet shrinks to a dot the moment the Moon fits
 on screen. That emptiness is the lesson, not a framing problem.
 */
private struct ViewControls: View {
    let focus: BodyId
    let scene: SolarScene
    let clock: Clock

    var body: some View {
        HStack(spacing: 6) {
            Text("VIEW")
                .font(.system(size: 10))
                .foregroundStyle(.secondary)

            if focus != .sun {
                ForEach([("Day", 0.0), ("Terminator", 90.0), ("Night", 180.0)], id: \.0) { item in
                    Button(item.0) { scene.setSunAngle(item.1, at: clock.epoch) }
                        .font(.system(size: 11))
                        .buttonStyle(.bordered)
                        .controlSize(.mini)
                }
            }

            if scene.focusHasMoons {
                Button("Fit moons") { scene.frameMoons() }
                    .font(.system(size: 11))
                    .buttonStyle(.bordered)
                    .controlSize(.mini)
                    .tint(.cyan)
            }
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.black.opacity(0.68), in: RoundedRectangle(cornerRadius: 12))
    }
}

/**
 The gravity switch, with the integration's own health on screen.

 A viewer who cannot tell which mode they are in cannot trust either, so the numbers for all
 three failure modes from `contracts/gravity-modes` are shown rather than hidden: how far the
 integration has run, how much energy it has lost, and how far behind the clock it is.
 */
private struct GravityBar: View {
    @Bindable var gravity: Gravity
    let clock: Clock

    private var mutual: Bool { gravity.mode == .mutual }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Button("On rails") { gravity.setMode(.analytic, at: clock.epoch) }
                    .buttonStyle(.bordered)
                    .controlSize(.mini)
                    .tint(mutual ? .gray : .orange)
                Button("Mutual gravity") { gravity.setMode(.mutual, at: clock.epoch) }
                    .buttonStyle(.bordered)
                    .controlSize(.mini)
                    .tint(mutual ? .orange : .gray)

                if mutual {
                    Toggle("Moons", isOn: Binding(
                        get: { gravity.includeMoons },
                        set: { gravity.setMode(.mutual, at: clock.epoch, includeMoons: $0) }
                    ))
                    .toggleStyle(.button)
                    .controlSize(.mini)
                    .font(.system(size: 10))
                }
                Spacer()
            }

            if mutual {
                HStack(spacing: 12) {
                    label("Integrated", gravity.integratedDays < 365
                        ? String(format: "%.0f d", gravity.integratedDays)
                        : String(format: "%.1f yr", gravity.integratedDays / 365.25))
                    label("Bodies", "\(gravity.bodyCount)")
                    label("Energy drift", String(format: "%.1e", gravity.energyDrift))
                    if abs(gravity.lagDays) > 1 {
                        label("Behind by", String(format: "%.0f d", abs(gravity.lagDays)))
                            .foregroundStyle(.orange)
                    }
                }
            } else {
                Text("Planets follow the JPL Standish fits. Accurate and reversible, "
                     + "but a mass you add cannot move them.")
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.black.opacity(0.68), in: RoundedRectangle(cornerRadius: 12))
    }

    private func label(_ name: String, _ value: String) -> some View {
        HStack(spacing: 4) {
            Text(name).font(.system(size: 10)).foregroundStyle(.secondary)
            Text(value).font(.system(size: 10).monospacedDigit())
        }
    }
}

private struct TimeBar: View {
    @Bindable var clock: Clock

    var body: some View {
        VStack(spacing: 8) {
            Text(clock.formattedEpoch).font(.system(.caption, design: .monospaced))

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
                    .frame(width: 112, alignment: .trailing)
            }
        }
        .padding(12)
        .background(.black.opacity(0.68), in: RoundedRectangle(cornerRadius: 12))
    }
}
